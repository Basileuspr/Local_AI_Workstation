"""Routes for local Diffusers image models and generated output files."""

from __future__ import annotations

from services import storage_libraries as storage

import base64
import asyncio
import logging
import hashlib
import json
import uuid
from contextlib import suppress
from fastapi import Request
from services.conditional_status import conditional_status
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Query, UploadFile, File
from typing import Literal
from starlette.concurrency import run_in_threadpool
from services.request_queue import queue, QueueCancelled, prepare_runtime
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator

from services import image_store
from services.image_tasks import image_tasks
from services.image_generation_limits import MAX_IMAGE_STEPS, MAX_IMAGE_GUIDANCE, validate_dimensions
from services.image_generation import (
    OUTPUT_DIR,
    ImageGenerationCancelled,
    discover_models,
    manager,
    prompt_token_status,
)


router = APIRouter(prefix="/image-generation", tags=["image-generation"])
logger = logging.getLogger(__name__)


class ImageGenerationRequest(BaseModel):
    session_id: str | None = Field(default=None, max_length=100)
    request_id: str | None = Field(default=None, max_length=100)
    request_label: str | None = Field(default=None, max_length=160)
    model_id: str
    prompt: str = Field(min_length=1, max_length=12000)
    negative_prompt: str | None = Field(default=None, max_length=12000)
    width: int = 1024
    height: int = 1024
    steps: int = Field(default=24, ge=1, le=MAX_IMAGE_STEPS)
    guidance_scale: float = Field(default=5.5, ge=1, le=MAX_IMAGE_GUIDANCE)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    lora_id: str | None = None
    lora_scale: float = Field(default=1.0, ge=0, le=2)
    long_prompt: bool = True
    output_dir: str | None = Field(default=None, max_length=32767)
    allow_long_wait: bool = False
    source_image_ref: str | None = Field(default=None, pattern=r"^blob:[0-9a-f]{64}$")
    strength: float = Field(default=0.3, ge=0.05, le=1, allow_inf_nan=False)
    source_fit: Literal["contain", "crop", "edge"] = "contain"

    @model_validator(mode="after")
    def supported_dimensions(self):
        validate_dimensions(self.width, self.height, self.allow_long_wait)
        if self.source_image_ref and int(self.steps * self.strength) < 1:
            raise ValueError("Increase Steps or Change amount to allow at least one image-to-image step.")
        return self


@router.post("/references")
async def upload_generation_reference(file: UploadFile = File(...)):
    from services.generation_reference import MAX_UPLOAD_BYTES, store_reference
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Reference image exceeds the 20 MiB limit.")
        return await run_in_threadpool(store_reference, file.filename or "Reference image", content)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    finally:
        await file.close()


@router.get("/models")
def list_image_models():
    from services.lora_store import list_adapters
    # Optional adapter discovery must not prevent base-model generation.
    lora_error = None
    try:
        loras = list_adapters()
    except (OSError, ValueError, TypeError, AttributeError):
        logger.warning("Could not list optional image LoRAs", exc_info=True)
        loras = []
        lora_error = "Optional LoRAs could not be loaded. You can still generate with None (base model only)."
    return {"models": discover_models(), "loras": loras, "lora_error": lora_error, "runtime": manager.runtime_status()}


class SavedImageRequest(ImageGenerationRequest):
    session_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    request_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


class ImageTaskSubmission(BaseModel):
    client_id: str = Field(min_length=1, max_length=100)
    batch_id: str | None = Field(default=None, max_length=100)
    chat_model: str | None = Field(default=None, max_length=200)
    requests: list[SavedImageRequest] = Field(min_length=1, max_length=32)


class BackendImageClient:
    async def is_disconnected(self):
        # The backend owns this task; a refreshed page is only a new observer.
        return False


async def execute_saved_image(values):
    return await generate_image(ImageGenerationRequest(**values), BackendImageClient())


@router.post("/tasks")
async def submit_image_tasks(submission: ImageTaskSubmission):
    if len(submission.requests) > 1 and not submission.batch_id:
        raise HTTPException(400, "Batch requests require a batch ID")
    try:
        from services.generation_reference import reference_bytes
        for reference in {request.source_image_ref for request in submission.requests if request.source_image_ref}:
            await run_in_threadpool(reference_bytes, reference)
        await image_tasks.submit(submission.client_id, [request.model_dump() for request in submission.requests],
                                 submission.batch_id, submission.chat_model, execute_saved_image)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    return await image_task_snapshot(submission.client_id)


@router.get("/tasks")
async def image_task_snapshot(client_id: str = Query(min_length=1, max_length=100), request: Request = None):
    tasks = image_tasks.snapshot(client_id)
    for task in tasks:
        job = queue.find(kind="image", request_id=task["request_id"], include_finished=True)
        if job and task["status"] == "running":
            # Queue completion precedes persistence to the source chat. Only
            # ImageTasks may report a completed task with its saved result.
            task["status"] = ("saving" if job.stage == "saving" or job.status == "completed"
                              else job.status if job.status in {"queued", "running", "cancelling"} else "running")
        task["progress"] = image_progress_snapshot(task["request_id"])
    return conditional_status(request, {"tasks": tasks})


@router.post("/generate")
async def generate_image(request: ImageGenerationRequest, client_request: Request):
    if request.source_image_ref:
        from services.generation_reference import reference_bytes
        try:
            await run_in_threadpool(reference_bytes, request.source_image_ref)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
    request.request_id = request.request_id or uuid.uuid4().hex
    job = queue.enqueue("image", f"{request.request_label} \u00b7 {request.prompt}" if request.request_label else request.prompt, request.request_id,
                        timing_profile=hashlib.sha256(json.dumps([
                            request.model_id, request.width, request.height, request.steps,
                            request.lora_id, request.long_prompt, request.allow_long_wait,
                            bool(request.source_image_ref), request.strength if request.source_image_ref else None,
                        ]).encode()).hexdigest(),
                        session_id=request.session_id,
                        owner=f"image-generation:{request.request_id}",
                        cancel=lambda: manager.cancel(request.request_id))
    worker = None
    monitor = None
    finished = asyncio.Event()
    error = None
    async def watch_disconnect():
        while not finished.is_set():
            if await client_request.is_disconnected() and not finished.is_set():
                await queue.cancel(job)
                return
            try:
                await asyncio.wait_for(finished.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass
    try:
        await queue.wait(job, client_request)
        monitor = asyncio.create_task(watch_disconnect())
        await prepare_runtime("image")
        if job.cancel_event.is_set():
            raise QueueCancelled()
        worker = asyncio.create_task(run_in_threadpool(_generate_image, request, job.cancel_event))
        result = await asyncio.shield(worker)
        if job.cancel_event.is_set():
            raise QueueCancelled()
        return result
    except (QueueCancelled, asyncio.CancelledError):
        job.cancel_event.set()
        manager.cancel(request.request_id)
        if worker:
            with suppress(Exception):
                await asyncio.shield(worker)
        raise HTTPException(499, "Image request cancelled")
    except Exception as exc:
        error = getattr(exc, "detail", str(exc))
        raise
    finally:
        # Request.is_disconnected() uses its own cancellation scope. A task
        # cancellation can be consumed by that probe, leaving an infinite
        # watcher and withholding an already saved image's HTTP response.
        finished.set()
        try:
            if monitor:
                with suppress(asyncio.CancelledError):
                    await monitor
        finally:
            queue.finish(job, error)


def _generate_image(request: ImageGenerationRequest, cancellation_event=None):
    try:
        destination = None
        if request.output_dir:
            destination = Path(request.output_dir)
            if not destination.is_absolute() or not destination.is_dir():
                raise HTTPException(400, "Output folder is unavailable. Choose another folder or clear Point output.")
            destination = destination.resolve()
        # The session identifies the queue's chat destination, not a pipeline option.
        job = queue.find(kind="image", request_id=request.request_id) if request.request_id else None
        result = manager.generate(**request.model_dump(exclude={"session_id", "output_dir", "request_label"}),
                                  cancellation_event=cancellation_event,
                                  on_gpu_complete=(lambda: queue.release_gpu_for_output(job)) if job else None)
        output_path = storage.resolve(OUTPUT_DIR / result["filename"])
        data = output_path.read_bytes()

        # Registered in the blob store so the chat can reference it instead of
        # carrying a base64 copy inside the session JSON. The PNG under
        # data/generated_images stays as the browsable output.
        reference = image_store.put_bytes(data)

        # Keep the managed original for chat/gallery and export an unchanged PNG.
        # Never overwrite an existing file in the user-selected folder.
        if destination:
            target = destination / result["filename"]
            try:
                if target.resolve() != output_path.resolve():
                    with target.open("xb") as stream:
                        try:
                            stream.write(data)
                            stream.flush()
                        except OSError:
                            stream.close()
                            target.unlink(missing_ok=True)
                            raise
                result["output_path"] = str(target)
            except OSError as exc:
                result["output_warning"] = f"Image saved in the app, but could not save to the selected output folder: {exc}"

        encoded = base64.b64encode(data).decode("ascii")
        return {
            **result,
            "image_ref": reference,
            # Retained so the studio can show the result immediately without a
            # second request; it is not what gets persisted.
            "data_url": f"data:image/png;base64,{encoded}",
        }
    except HTTPException:
        raise
    except ImageGenerationCancelled as exc:
        raise HTTPException(status_code=499, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("Image generation failed (request %s)", request.request_id)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Image generation failed: {exc}") from exc


@router.post("/stop/{request_id}")
async def stop_image_generation(request_id: str):
    """Interrupt the matching Diffusers pipeline at its next denoising step."""
    job = queue.find(kind="image", request_id=request_id)
    retained = image_tasks.cancel(request_id)
    stopped = await queue.cancel(job) if job else manager.cancel(request_id)
    return {"stopped": retained or stopped}


@router.get("/progress/{request_id}")
async def image_generation_progress(request_id: str):
    return {"progress": image_progress_snapshot(request_id)}


def image_progress_snapshot(request_id: str):
    job = queue.find(kind="image", request_id=request_id, include_finished=True)
    progress = manager.generation_progress(request_id)
    if progress is None and job:
        started = datetime.fromisoformat(job.started_at or job.created_at)
        phase = ("Waiting in Prompt Queue" if job.status == "queued" else "Stopping" if job.status == "cancelling"
                 else "Saving image" if job.stage == "saving" else "Image complete" if job.status == "completed"
                 else "Stopped" if job.status == "cancelled" else "Failed" if job.status == "failed" else "Preparing runtime")
        end = datetime.fromisoformat(job.finished_at) if job.finished_at else datetime.now(timezone.utc)
        progress = {"phase": phase, "step": 0, "total_steps": 0,
                    "elapsed_seconds": round(max(0, (end - started).total_seconds()), 1)}
    return progress


class PromptTokenRequest(BaseModel):
    model_id: str
    prompt: str = Field(default="", max_length=12000)
    negative_prompt: str | None = Field(default=None, max_length=12000)


@router.post("/prompt-tokens")
def get_prompt_tokens(request: PromptTokenRequest):
    try:
        return prompt_token_status(request.model_id, request.prompt, request.negative_prompt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/outputs/{filename}")
def get_generated_image(filename: str):
    safe_name = Path(filename).name
    path = storage.resolve(OUTPUT_DIR / safe_name)
    if not path.is_file() or path.suffix.lower() != ".png":
        raise HTTPException(status_code=404, detail="Generated image not found")
    from services.image_vault import guard_path
    guard_path(path)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})
