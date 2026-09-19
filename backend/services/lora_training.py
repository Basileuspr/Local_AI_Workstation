"""Process manager for one local LoRA training job at a time."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import threading
import uuid
from pathlib import Path

from services import lora_store
from services.app_logging import get_logger
from services.gpu_coordination import gpu_coordinator

logger = get_logger("backend.lora_training")


class LoRATrainingManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._process: subprocess.Popen | None = None
        self._project_id: str | None = None
        self._run_id: str | None = None
        self._gpu_owner: str | None = None
        self._cancelled_run_ids: set[str] = set()

    def is_active(self) -> bool:
        with self._lock:
            return bool(self._process and self._process.poll() is None)

    def active_project_id(self) -> str | None:
        with self._lock:
            return self._project_id if self._process and self._process.poll() is None else None

    def is_run_pending(self, run_id: str) -> bool:
        with self._lock:
            return self._run_id == run_id

    def start(self, project_id: str, models: list[dict], run_id: str | None = None, cancellation_event=None) -> dict:
        with self._lock:
            if self._process and self._process.poll() is None:
                raise ValueError("Another LoRA training run is already using the GPU")
            project = lora_store.get_project(project_id)
            preflight = lora_store.validate_project(project, models)
            if not preflight["valid"]:
                raise ValueError("; ".join(preflight["errors"]))
            if lora_store.TRAINING_LOCK_PATH.exists():
                raise ValueError("The GPU is reserved by a previous training process; restart the backend if it is no longer running")

            if cancellation_event is not None and cancellation_event.is_set():
                raise ValueError("Training request cancelled")
            run_id = run_id or uuid.uuid4().hex
            gpu_owner = f"lora:{run_id}"
            if not gpu_coordinator.acquire(gpu_owner):
                owner = gpu_coordinator.current_owner() or "another local task"
                raise ValueError(f"The GPU is currently being used by {owner}")
            lock_written = False
            process = None
            try:
                # A CPU-offloaded generation pipeline still reserves VRAM. It is
                # safe to unload now because the shared lease excludes a live
                # generation call until this training process exits.
                from services.image_generation import manager as image_manager
                image_manager.unload_for_training()
                lora_store.TRAINING_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
                lora_store.TRAINING_LOCK_PATH.write_text(json.dumps({"project_id": project_id, "run_id": run_id}), encoding="utf-8")
                lock_written = True
                training = {
                    "status": "starting",
                    "error": None,
                    "phase": "Preparing images and captions",
                    "memory": None,
                    "prepared": 0,
                    "run_id": run_id,
                    "epoch": 0,
                    "epochs": int(project["settings"].get("epochs", 0)),
                    "step": 0,
                    "total_steps": preflight["estimated_steps"],
                    "percent": 0,
                    "loss": None,
                    "elapsed_seconds": 0,
                    "logs": ["Preparing local LoRA training process..."],
                    "warnings": preflight["warnings"],
                    "started_at": lora_store._now(),
                    "timings": {},
                    "cpu_assistance": {},
                }
                lora_store.update_training(project_id, training)
                # Module launch keeps backend on the child process import path.
                process = subprocess.Popen(
                    [sys.executable, "-m", "services.lora_worker", "--project", str(lora_store._project_path(project_id)), "--run-id", run_id],
                    cwd=str(Path(__file__).parents[1]),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                )
                self._process, self._project_id, self._run_id, self._gpu_owner = process, project_id, run_id, gpu_owner
                if cancellation_event is not None and cancellation_event.is_set():
                    self._cancelled_run_ids.add(run_id)
                    process.terminate()
                threading.Thread(target=self._watch, args=(process, project_id, run_id), daemon=True).start()
                return lora_store.get_project(project_id)["training"]
            except Exception as exc:
                if process and process.poll() is None:
                    process.terminate()
                if lock_written:
                    lora_store.TRAINING_LOCK_PATH.unlink(missing_ok=True)
                gpu_coordinator.release(gpu_owner)
                try:
                    lora_store.update_training(project_id, {
                        "status": "failed",
                        "error": f"Could not start LoRA training: {exc}",
                        "logs": [f"Could not start LoRA training: {exc}"],
                    })
                except Exception:
                    logger.exception("Could not persist LoRA startup failure for %s", project_id)
                if isinstance(exc, ValueError):
                    raise exc
                raise ValueError(f"Could not start LoRA training: {exc}") from exc

    def _append_log(self, project_id: str, message: str) -> None:
        project = lora_store.get_project(project_id)
        training = project.get("training") or {}
        logs = list(training.get("logs") or [])
        logs.append(message)
        lora_store.update_training(project_id, {"logs": logs[-120:]})

    def _watch(self, process: subprocess.Popen, project_id: str, run_id: str) -> None:
        completed = False
        try:
            for raw_line in process.stdout or []:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    self._append_log(project_id, line)
                    continue
                kind = event.pop("type", "log")
                if kind == "progress":
                    lora_store.update_training(project_id, event)
                elif kind == "log":
                    self._append_log(project_id, event.get("message", ""))
                elif kind == "completed":
                    adapter = event.get("adapter") or {}
                    lora_store.register_adapter(project_id, adapter)
                    lora_store.update_training(project_id, {"elapsed_seconds": event.get("elapsed_seconds", 0), "timings": event.get("timings") or {}, "cpu_assistance": event.get("cpu_assistance") or {}, "logs": ["Training completed successfully."]})
                    completed = True
                elif kind == "cancelled":
                    lora_store.update_training(project_id, {"status": "cancelled", "logs": [event.get("message", "Training cancelled")]})
                    completed = True
                elif kind == "failed":
                    lora_store.update_training(project_id, {"status": "failed", "error": event.get("error", "Training failed"), "logs": [event.get("error", "Training failed")]})
                    completed = True
            return_code = process.wait()
            if not completed:
                with self._lock:
                    cancelled = run_id in self._cancelled_run_ids
                status = "cancelled" if cancelled or return_code in {130, -15} else "failed"
                lora_store.update_training(project_id, {"status": status, "error": None if status == "cancelled" else f"Training process exited with code {return_code}"})
        except Exception:
            logger.exception("Could not monitor LoRA training run %s", run_id)
            try:
                lora_store.update_training(project_id, {"status": "failed", "error": "The training monitor stopped unexpectedly"})
            except Exception:
                pass
        finally:
            # A broken stdout/monitor path must not release a live training GPU.
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            # Termination bypasses the worker's TemporaryDirectory context.
            # Only remove caches belonging to this finished child process.
            if process.poll() is not None:
                run_dir = (lora_store.RUNS_DIR / project_id / run_id).resolve()
                if run_dir.is_relative_to(lora_store.RUNS_DIR.resolve()):
                    for cache in run_dir.glob("input-cache-*"):
                        if cache.is_dir() and not cache.is_symlink():
                            shutil.rmtree(cache, ignore_errors=True)
            try:
                lora_store.TRAINING_LOCK_PATH.unlink(missing_ok=True)
            except OSError:
                logger.warning("Could not remove LoRA training lock")
            with self._lock:
                if self._run_id == run_id:
                    gpu_owner = self._gpu_owner
                    self._process = self._project_id = self._run_id = None
                    self._gpu_owner = None
                else:
                    gpu_owner = None
                self._cancelled_run_ids.discard(run_id)
            if gpu_owner:
                gpu_coordinator.release(gpu_owner)

    def cancel(self, project_id: str) -> dict:
        with self._lock:
            if not self._process or self._project_id != project_id or self._process.poll() is not None:
                raise ValueError("No active training run for this project")
            self._cancelled_run_ids.add(self._run_id or "")
            self._process.terminate()
            lora_store.update_training(project_id, {"status": "cancelling", "logs": ["Stopping training safely; completed adapters are preserved."]})
            return lora_store.get_project(project_id)["training"]


manager = LoRATrainingManager()
