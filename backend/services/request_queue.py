"""FIFO admission for local inference, with cancellable waits and GPU handoff.

Request bodies remain with their submitting handlers; this queue never writes
prompts to disk. History is limited to the current backend run.
"""
from __future__ import annotations

import asyncio
import inspect
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from services.gpu_coordination import gpu_coordinator

TERMINAL = {"completed", "failed", "cancelled"}


def now():
    return datetime.now(timezone.utc).isoformat()


class QueueCancelled(Exception):
    pass


@dataclass
class Job:
    kind: str
    label: str
    request_id: str
    owner: str
    project_id: str | None = None
    session_id: str | None = None
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "queued"
    created_at: str = field(default_factory=now)
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    cancel_callback: object = None
    stage: str | None = None


class RequestQueue:
    def __init__(self, coordinator=None):
        self.coordinator = coordinator or gpu_coordinator
        self._lock = threading.RLock()
        self.jobs: list[Job] = []
        self.active: Job | None = None
        self.paused = False

    def enqueue(self, kind, label, request_id=None, *, owner=None, project_id=None, session_id=None, cancel=None):
        request_id = request_id or uuid.uuid4().hex
        with self._lock:
            if any(job.kind == kind and job.request_id == request_id and job.status not in TERMINAL for job in self.jobs):
                raise ValueError("This request is already in the queue")
            job = Job(kind, str(label)[:160], request_id, owner or f"{kind}:{request_id}", project_id, session_id)
            job.cancel_callback = cancel
            finished = [entry for entry in self.jobs if entry.status in TERMINAL]
            remove = {entry.id for entry in finished[:-99]}
            self.jobs = [entry for entry in self.jobs if entry.id not in remove]
            self.jobs.append(job)
            return job

    def find(self, *, job_id=None, kind=None, request_id=None, project_id=None):
        with self._lock:
            return next((job for job in reversed(self.jobs) if
                         (job_id is None or job.id == job_id) and
                         (kind is None or job.kind == kind) and
                         (request_id is None or job.request_id == request_id) and
                         (project_id is None or job.project_id == project_id) and
                         (job_id is not None or job.status not in TERMINAL)), None)

    def try_start(self, job):
        with self._lock:
            if job.cancel_event.is_set():
                raise QueueCancelled("Request cancelled")
            if self.active is job:
                return True
            waiting = next((entry for entry in self.jobs if entry.status == "queued"), None)
            if self.paused or self.active is not None or waiting is not job:
                return False
            if not self.coordinator.reserve(job.owner):
                return False
            self.active = job
            job.status = "running"
            job.started_at = now()
            return True

    async def wait(self, job, client_request=None):
        while True:
            if client_request is not None and await client_request.is_disconnected():
                await self.cancel(job)
                raise QueueCancelled("Submitting window disconnected")
            if self.try_start(job):
                return
            await asyncio.sleep(0.15)

    async def handoff(self, job, owner):
        """Change providers after the previous provider exits, retaining FIFO admission."""
        while True:
            with self._lock:
                if job.cancel_event.is_set():
                    raise QueueCancelled("Request cancelled between stages")
                if self.active is not job:
                    raise ValueError("Only the running request can change providers")
                self.coordinator.release(job.owner)
                if self.coordinator.reserve(owner):
                    job.owner = owner
                    return
            # An external GPU task may have claimed the lease after analysis.
            await asyncio.sleep(0.15)

    async def cancel(self, job):
        with self._lock:
            if job.status in TERMINAL or job.cancel_event.is_set():
                return False
            job.cancel_event.set()
            running = self.active is job
            job.status = "cancelling" if running else "cancelled"
            if not running:
                job.finished_at = now()
            callback = job.cancel_callback if running else None
        if callback:
            result = callback()
            if inspect.isawaitable(result):
                await result
        return True

    def finish(self, job, error=None):
        with self._lock:
            job.status = "cancelled" if job.cancel_event.is_set() else "failed" if error else "completed"
            job.error = str(error) if error else None
            job.finished_at = now()
            job.cancel_callback = None
            if self.active is job:
                # Never release on cancellation alone: the provider must exit.
                self.coordinator.release(job.owner)
                self.active = None

    def snapshot(self):
        with self._lock:
            position = 0
            entries = []
            for job in self.jobs:
                if job.status == "queued":
                    position += 1
                entries.append({key: getattr(job, key) for key in (
                    "id", "kind", "label", "request_id", "project_id", "session_id",
                    "status", "created_at", "started_at", "finished_at", "error", "stage")})
                entries[-1]["position"] = position if job.status == "queued" else None
            return {"jobs": entries, "paused": self.paused, "gpu_owner": self.coordinator.current_owner()}


queue = RequestQueue()


async def prepare_runtime(kind):
    """Free idle allocations from the other provider before starting a job."""
    from config import settings
    from starlette.concurrency import run_in_threadpool
    from services.image_generation import manager as image_manager
    if kind in {"chat", "compact", "analysis"}:
        await run_in_threadpool(image_manager.unload_for_training)
    else:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.get(f"{settings.ollama_base_url}/api/ps")
                response.raise_for_status()
                for model in response.json().get("models", []):
                    name = model.get("name") or model.get("model")
                    if name:
                        result = await client.post(f"{settings.ollama_base_url}/api/generate", json={"model": name, "keep_alive": 0})
                        result.raise_for_status()
        except httpx.ConnectError:
            # Image inference and training do not require a running Ollama.
            pass
