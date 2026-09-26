"""Background face extraction. One run at a time, through the shared queue.

GPU detection joins the existing FIFO queue like chat, image generation and
LoRA, so it waits its turn. The GPU lease is only claimed when
the provider would actually run on CUDA; on a CPU-only ONNX build face work
never blocks image generation.
"""
from __future__ import annotations

import asyncio
import io
import json
import uuid
import zipfile
import threading
from datetime import datetime, timezone

import numpy as np
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from services.faces import crops, store
from services.faces.providers import get_provider
from services.image_library import atomic, identity, inspect, source_bytes
from services.request_queue import QueueCancelled, queue


class FaceRun:
    def __init__(self, dataset_id, total, name=""):
        self.id = uuid.uuid4().hex
        self.dataset_id = dataset_id
        self.status = "queued"
        self.message = "Waiting for other local model work"
        self.processed = 0
        self.total = total
        self.faces = 0
        self.errors: list[dict] = []
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.name = name.strip() or f"Face scan {self.started_at[:19].replace('T', ' ')}"
        self.cancel_event = threading.Event()

    def snapshot(self):
        return {"id": self.id, "name": self.name, "dataset_id": self.dataset_id, "status": self.status,
                "message": self.message, "processed": self.processed, "total": self.total,
                "faces": self.faces, "errors": self.errors[:50], "error_count": len(self.errors), "started_at": self.started_at}


class FaceExtractor:
    def __init__(self):
        self.run: FaceRun | None = None
        self.task: asyncio.Task | None = None
        self.job = None

    def active(self):
        return self.run if self.task and not self.task.done() else None

    def status(self, dataset_id=None):
        current = self.run
        if current and (dataset_id is None or current.dataset_id == dataset_id):
            return current.snapshot()
        return None

    def start(self, dataset_id, sources, name=""):
        if self.active():
            raise ValueError("A face extraction is already running. Wait for it or stop it first.")
        store.get_dataset(dataset_id)
        if not sources:
            raise ValueError("Choose at least one image to scan")
        if len(name.strip()) > 120:
            raise ValueError("Run names need at most 120 characters")
        self.run = FaceRun(dataset_id, len(sources), name)
        store.save_run(self.run.snapshot())
        self.job = None
        self.task = asyncio.create_task(self._execute(self.run, sources))
        return self.run.snapshot()

    async def stop(self, dataset_id=None, run_id=None):
        run = self.run
        if not run:
            return None
        if (dataset_id and run.dataset_id != dataset_id) or (run_id and run.id != run_id):
            raise ValueError("That face scan is no longer active")
        if not self.active():
            return run.snapshot()
        run.cancel_event.set()
        if self.job:
            self.job.cancel_event.set()
        try:
            # Let the provider observe cancellation and finish its current call
            # before another batch or extraction may start using it.
            await asyncio.shield(self.task)
        except asyncio.CancelledError:
            pass
        run.status = "cancelled"
        run.message = "Stopped. Faces found before stopping were kept."
        return run.snapshot()

    async def _execute(self, run, sources):
        job = None
        error = None
        try:
            provider = get_provider()
            # Only take the GPU lease when the provider would really use CUDA.
            owner = f"faces:{run.id}" if provider.uses_gpu() else None
            job = queue.enqueue("faces", f"{run.name} ({run.total} images)", run.id,
                                owner=owner or f"faces-cpu:{run.id}", cancel=self.stop,
                                requires_gpu=bool(owner))
            self.job = job
            if run.cancel_event.is_set():
                job.cancel_event.set()
            await queue.wait(job)
            run.status = "running"
            run.message = "Detecting faces"
            for index, source in enumerate(sources, start=1):
                if job.cancel_event.is_set() or run.cancel_event.is_set():
                    raise QueueCancelled()
                try:
                    await self._one_source(run, source, provider, job)
                except (ValueError, OSError, UnidentifiedImageError) as exc:
                    run.errors.append({"source": source.get("name") or source.get("kind", "image"),
                                       "error": str(exc)[:300]})
                run.processed = index
                run.message = f"Scanned {index} of {run.total} images, {run.faces} faces found"
            await run_in_threadpool(store.mark_duplicates, run.dataset_id)
            if job.cancel_event.is_set() or run.cancel_event.is_set():
                raise QueueCancelled()
            await run_in_threadpool(store.cluster, run.dataset_id)
            if job.cancel_event.is_set() or run.cancel_event.is_set():
                raise QueueCancelled()
            run.status = "complete"
            run.message = f"{run.faces} faces from {run.processed} images"
        except QueueCancelled:
            run.status = "cancelled"
            run.message = "Stopped. Faces found before stopping were kept."
        except asyncio.CancelledError:
            run.cancel_event.set()
            if job:
                job.cancel_event.set()
            run.status = "cancelled"
            run.message = "Stopped. Faces found before stopping were kept."
            raise
        except Exception as exc:
            error = str(exc)
            run.status = "error"
            run.message = f"Face extraction failed: {exc}"
        finally:
            if job:
                queue.finish(job, error)
            await run_in_threadpool(store.save_run, run.snapshot())

    async def _one_source(self, run, source, provider, job):
        data, meta = await run_in_threadpool(self._load, source)
        dataset = store.get_dataset(run.dataset_id)
        options = dataset["settings"]
        faces = await run_in_threadpool(
            provider.detect, Image.open(io.BytesIO(data)), lambda: job.cancel_event.is_set() or run.cancel_event.is_set(),
            float(options["detect_threshold"]))
        if job.cancel_event.is_set() or run.cancel_event.is_set():
            raise QueueCancelled()
        if not faces:
            return
        if source.get("kind") == "inline":
            source = await run_in_threadpool(store.save_source, run.dataset_id, data, meta["name"])
        records, embeddings = await run_in_threadpool(
            self._build, run.dataset_id, data, meta, source, faces, options)
        if records:
            await run_in_threadpool(store.add_faces, run.dataset_id, records, embeddings,
                                    {"sha256": meta["sha256"], "name": meta["name"],
                                     "width": meta["width"], "height": meta["height"],
                                     "source": source, "added_at": store.now()})
            run.faces += len(records)

    @staticmethod
    def _load(source):
        """Resolve a typed source. Source images are read, never written."""
        if source.get("kind") == "inline":
            import base64
            data = base64.b64decode(source["data"], validate=True)
            return data, inspect(data, source.get("name") or "Upload")
        if source.get("kind") == "face-upload":
            data = store.source_path(source.get("dataset_id"), source.get("id")).read_bytes()
            return data, inspect(data, source.get("name") or "Upload")
        if source.get("kind") == "invalid-upload":
            raise ValueError(source.get("error") or "Could not read this image")
        data, item = source_bytes(source)
        return data, {**inspect(data, item.get("name") or "Image"), "name": item.get("name") or "Image"}

    @staticmethod
    def _build(dataset_id, data, meta, source, faces, options):
        image = Image.open(io.BytesIO(data)).convert("RGB")
        records, embeddings = [], []
        for index, face in enumerate(faces):
            try:
                crop, rect = crops.render(image, face.box, options["crop_mode"],
                                          float(options["padding"]), int(options["size"]))
            except ValueError:
                continue
            metrics = crops.measure(crop, face, rect)
            face_id = uuid.uuid4().hex
            atomic(store.dataset_dir(dataset_id) / "crops" / f"{face_id}.png", crops.encode(crop))
            records.append({
                "id": face_id, "source": source, "source_name": meta["name"],
                "source_sha256": meta["sha256"], "source_width": meta["width"],
                "source_height": meta["height"], "face_index": index,
                "box": [round(value, 2) for value in face.box],
                "landmarks": [[round(x, 2), round(y, 2)] for x, y in face.landmarks],
                "crop_rect": list(rect), "crop_mode": options["crop_mode"],
                "padding": float(options["padding"]), "size": int(options["size"]),
                "metrics": metrics, "flags": crops.flags(metrics, options),
                "state": "pending", "cluster": None, "outlier": False,
                "duplicate_of": None, "created_at": store.now(),
            })
            embeddings.append(np.asarray(face.embedding, dtype=np.float32))
        return records, embeddings


extractor = FaceExtractor()


def recrop(dataset_id, face_ids=None):
    """Re-render crops after a settings change, without detecting again."""
    dataset = store.get_dataset(dataset_id)
    options = dataset["settings"]
    wanted = set(face_ids) if face_ids else None
    changed = 0
    for face in dataset["faces"]:
        if wanted is not None and face["id"] not in wanted:
            continue
        try:
            data, _ = FaceExtractor._load(face["source"])
            image = Image.open(io.BytesIO(data)).convert("RGB")
        except (ValueError, OSError, UnidentifiedImageError):
            continue
        from services.faces.providers import DetectedFace
        stand_in = DetectedFace(tuple(face["box"]), face["metrics"]["confidence"],
                                tuple((x, y) for x, y in face["landmarks"]))
        crop, rect = crops.render(image, stand_in.box, options["crop_mode"],
                                  float(options["padding"]), int(options["size"]))
        atomic(store.dataset_dir(dataset_id) / "crops" / f"{face['id']}.png", crops.encode(crop))
        face["metrics"] = crops.measure(crop, stand_in, rect)
        face["flags"] = crops.flags(face["metrics"], options)
        face["crop_rect"] = list(rect)
        face["crop_mode"] = options["crop_mode"]
        face["padding"] = float(options["padding"])
        face["size"] = int(options["size"])
        changed += 1
    with store.LOCK:
        store._write(dataset)
    return {"recropped": changed}


def export_archive(dataset_id, states=("accepted",), include_rejected=False):
    """A ZIP of chosen crops and a CSV summary; JSON stays in the dataset store."""
    dataset = store.get_dataset(dataset_id)
    wanted = set(states) | ({"rejected"} if include_rejected else set())
    chosen = [face for face in dataset["faces"] if face["state"] in wanted]
    if not chosen:
        raise ValueError("No faces are selected for export. Accept some faces first.")
    buffer = io.BytesIO()
    rows = ["face_file,source_image,source_sha256,face_index,state,confidence,face_width,face_height,sharpness,cluster,duplicate_of"]
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for face in chosen:
            name = f"faces/{face['id']}.png"
            try:
                archive.write(store.crop_path(dataset_id, face["id"]), name)
            except ValueError:
                continue
            metrics = face["metrics"]
            rows.append(",".join(str(value) for value in (
                name, json.dumps(face["source_name"]), face["source_sha256"], face["face_index"],
                face["state"], metrics["confidence"], metrics["face_width"], metrics["face_height"],
                metrics["sharpness"], face.get("cluster"), face.get("duplicate_of") or "")))
        # Detailed provenance remains in the internal dataset store.
        archive.writestr("faces.csv", "\n".join(rows))
    return buffer.getvalue(), len(chosen)
