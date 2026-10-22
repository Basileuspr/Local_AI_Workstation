"""Durable phone submissions using the existing desktop routes and GPU queue.

No listener is created here. Browser streams observe jobs, never own execution.
BridgeStore supplies durable receipts, bounded history and restart semantics in
a separate directory; existing PC-bridge jobs and credentials are untouched.
"""
import asyncio
import json
import logging
import time
import uuid
from contextlib import suppress
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool

from services import session_store
from services.bridge_store import BridgeStore, TERMINAL
from services.image_generation_limits import MAX_IMAGE_GUIDANCE, MAX_IMAGE_STEPS, validate_dimensions

logger = logging.getLogger(__name__)


class MobileSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["chat", "image"]
    session_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    expected_revision: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=12000)
    negative_prompt: str = Field(default="", max_length=12000)
    width: int = Field(default=1024, strict=True)
    height: int = Field(default=1024, strict=True)
    steps: int = Field(default=24, ge=1, le=MAX_IMAGE_STEPS, strict=True)
    guidance_scale: float = Field(default=5.5, ge=1, le=MAX_IMAGE_GUIDANCE, allow_inf_nan=False)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647, strict=True)
    lora_id: str | None = Field(default=None, min_length=1, max_length=200)
    lora_scale: float = Field(default=1, ge=0, le=2, allow_inf_nan=False)
    long_prompt: bool = Field(default=True, strict=True)
    allow_long_wait: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def valid(self):
        if not self.prompt.strip() or not self.model.strip():
            raise ValueError("Choose a model and enter a prompt.")
        validate_dimensions(self.width, self.height, self.allow_long_wait)
        return self


class MobileJobs:
    def __init__(self, root, local_url, local_token, *, transport=None):
        self.store = BridgeStore(root)
        self.local_url, self.local_token = local_url, local_token
        self.transport = transport
        self.tasks = {}
        self.submit_lock = asyncio.Lock()
        self.snapshot_id = uuid.uuid4().hex

    def image_snapshot(self):
        """Desktop observation uses the existing image-task shape and saved results."""
        tasks = []
        for job in reversed(self.store.jobs("incoming")):
            spec = job.get("payload") or {}
            if spec.get("kind") != "image":
                continue
            result = None
            if job["status"] == "completed":
                result = (self.store.job("incoming", job["id"]).get("result") or {}).get("image")
            tasks.append(dict(request_id="mobile-" + job["id"], session_id=spec["session_id"],
                prompt=spec["prompt"], label="Phone", batch_id=None, batch_index=0, batch_count=1,
                status="failed" if job["status"] == "interrupted" else job["status"],
                result=result, error=job.get("error"), progress=job.get("desktop_progress")))
        return {"tasks": tasks, "backend_id": self.snapshot_id, "snapshot_sequence": time.monotonic_ns() // 1000}

    def client(self):
        return httpx.AsyncClient(base_url=self.local_url, transport=self.transport,
                                 headers={"X-LAW-Session": self.local_token}, trust_env=False,
                                 timeout=httpx.Timeout(3600, connect=5))

    def changed(self):
        self.store.set_setting("activity", str(time.time_ns()))

    async def local(self, path, method="GET", body=None):
        async with self.client() as client:
            response = await client.request(method, path, **({"json": body} if body is not None else {}))
            response.raise_for_status()
            return response.json()

    def owned(self, device_id, job_id):
        job = self.store.job("incoming", job_id)
        if not job or job["peer_id"] != device_id:
            raise KeyError("Job not found")
        return job

    @staticmethod
    def public(job, *, detail=False):
        spec = job.get("payload") or {}
        value = {key: job.get(key) for key in ("id", "status", "created", "updated", "error", "progress")}
        value.update({key: spec.get(key) for key in ("kind", "session_id", "model", "prompt")})
        if detail:
            value["text"] = (job.get("result") or {}).get("text", "")
        return value

    def list(self, device_id):
        return [self.public(job) for job in self.store.jobs("incoming") if job["peer_id"] == device_id]

    async def submit(self, device_id, job_id, spec):
        payload = spec.model_dump()
        if spec.kind == "chat":
            payload = {key: payload[key] for key in ("kind", "session_id", "expected_revision", "model", "prompt")}
        async with self.submit_lock:
            existing = self.store.job("incoming", job_id)
            if existing:
                previous = MobileSubmission(**existing["payload"]).model_dump() if existing["payload"] else None
                if previous and spec.kind == "chat":
                    previous = {key: previous[key] for key in payload}
                if existing["peer_id"] != device_id or previous != payload:
                    raise ValueError("Job ID already belongs to another request.")
                return self.public(existing, detail=True)
            if any(job["status"] not in TERMINAL and job["payload"]["session_id"] == spec.session_id
                   and (spec.kind == "chat" or job["payload"]["kind"] == "chat")
                   for job in self.store.jobs("incoming")):
                raise ValueError("This conversation already has an active mobile job.")
            session = await run_in_threadpool(session_store.get_session, spec.session_id)
            if session is None:
                raise ValueError("The conversation is no longer available.")
            if spec.kind == "chat" and session["revision"] != spec.expected_revision:
                raise session_store.SessionConflict(session["revision"])
            # Persist a receipt BEFORE changing the chat or starting computation.
            # A crash at any later point leaves an interrupted, non-replayed job.
            job, _ = self.store.insert("incoming", job_id, device_id, payload)
            request_id = "mobile-" + job_id
            message = {"id": ("image-request-" + request_id if spec.kind == "image" else request_id + "-user"),
                       "role": "user", "content": ("[Image generation] " if spec.kind == "image" else "") + spec.prompt}
            try:
                if spec.kind == "image":
                    # Image prompts do not consume chat history. Merge their stable
                    # IDs into current history while earlier queued results arrive.
                    saved = await run_in_threadpool(session_store.append_messages, spec.session_id, [message])
                else:
                    saved = await run_in_threadpool(session_store.update_session, spec.session_id,
                        [*session["messages"], message], model=spec.model, expected_revision=spec.expected_revision)
                if saved is None:
                    raise ValueError("The conversation was removed before submission.")
                self.changed()
            except Exception:
                self.store.update("incoming", job_id, status="failed", error="Submission could not be saved. Reload the conversation before submitting a new job.")
                raise
            task = asyncio.create_task(self.run(job, saved))
            self.tasks[job_id] = task
            task.add_done_callback(lambda _task: self.tasks.pop(job_id, None))
            return self.public(job, detail=True)

    async def run(self, job, session):
        job_id, spec = job["id"], job["payload"]
        try:
            if self.store.job("incoming", job_id)["cancel_requested"]:
                self.store.update("incoming", job_id, status="cancelled")
                return
            if spec["kind"] == "chat":
                await self.chat(job, session)
            else:
                await self.image(job)
        except asyncio.CancelledError:
            self.store.update("incoming", job_id, status="interrupted", error="Desktop worker stopped. This job was not replayed.")
            raise
        except httpx.HTTPError:
            self.store.update("incoming", job_id, status="interrupted",
                              error="Desktop connection failed. The result may still be saved; check this conversation and gallery before submitting again.")
        except Exception as error:
            # Provider errors can include local paths, credentials and prompts.
            logger.warning("Mobile job %s failed (%s)", job_id, type(error).__name__)
            self.store.update("incoming", job_id, status="failed",
                              error="Desktop execution failed. Check desktop model availability and logs, then submit a new job.")

    async def chat(self, job, session):
        job_id, spec = job["id"], job["payload"]
        messages = [{"role": message["role"], "content": message.get("content") or ""}
                    for message in session["messages"] if message.get("role") in {"system", "user", "assistant"}]
        if len(json.dumps(messages).encode()) > 1024 * 1024:
            raise ValueError("Conversation exceeds the mobile context limit.")
        body = {"model": spec["model"], "messages": messages, "session_id": spec["session_id"],
                "request_id": "mobile-" + job_id, "use_memory": False, "use_durable_memory": False,
                "use_knowledge_base": False, "tool_ids": []}
        text, complete, saved_at = "", False, 0
        async with self.client() as client:
            async with client.stream("POST", "/chat", json=body) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    event = json.loads(line[6:])
                    if event.get("cancelled"):
                        self.store.update("incoming", job_id, status="cancelled", result={"text": text})
                        return
                    if event.get("error") or str(event.get("token", "")).startswith("[Error:"):
                        raise ValueError("Provider failed")
                    text += event.get("token", "")
                    if len(text) > 1024 * 1024:
                        raise ValueError("Output limit exceeded")
                    complete = complete or event.get("done", False)
                    runtime = event.get("runtime_status") or {}
                    if time.monotonic() - saved_at > .2 or complete:
                        current = self.store.job("incoming", job_id)
                        self.store.update("incoming", job_id, result={"text": text},
                            status="cancelling" if current["cancel_requested"] else "queued" if runtime.get("stage") == "queued" else "running",
                            progress={"stage": runtime.get("stage", "generating"), "detail": "Waiting for desktop queue" if runtime.get("stage") == "queued" else "Generating response"})
                        saved_at = time.monotonic()
        if not complete:
            raise ValueError("Stream ended without completion")
        if self.store.job("incoming", job_id)["cancel_requested"]:
            self.store.update("incoming", job_id, status="cancelled", result={"text": text})
            return
        self.store.update("incoming", job_id, status="running", result={"text": text}, progress={"stage": "saving", "detail": "Saving conversation"})
        saved = await run_in_threadpool(session_store.append_messages, spec["session_id"],
            [{"id": "mobile-" + job_id + "-assistant", "role": "assistant", "content": text}], spec["model"])
        if saved is None:
            raise ValueError("Conversation was removed")
        self.store.update("incoming", job_id, status="completed", result={"text": text}, progress=None)
        self.changed()

    async def image(self, job):
        job_id, spec = job["id"], job["payload"]
        request_id, client_id = "mobile-" + job_id, "mobile-" + job["peer_id"]
        values = {key: spec[key] for key in ("session_id", "prompt", "negative_prompt", "width", "height", "steps", "guidance_scale", "seed", "lora_id", "lora_scale", "long_prompt", "allow_long_wait")}
        values.update(model_id=spec["model"], request_id=request_id)
        snapshot = await self.local("/image-generation/tasks", "POST", {"client_id": client_id, "requests": [values]})
        backend_id = snapshot["backend_id"]
        while True:
            if snapshot["backend_id"] != backend_id:
                self.store.update("incoming", job_id, status="interrupted", error="Desktop restarted during generation. Check the gallery before submitting again.")
                return
            task = next((item for item in snapshot["tasks"] if item["request_id"] == request_id), None)
            if task is None:
                raise ValueError("Image task disappeared")
            status = task["status"]
            current = self.store.job("incoming", job_id)
            if current["cancel_requested"] and status not in TERMINAL:
                await self.local("/image-generation/stop/" + request_id, "POST")
            progress = task.get("progress") or {}
            total = progress.get("total_steps") or 0
            self.store.update("incoming", job_id, status=("running" if status == "saving" else status),
                desktop_progress=progress,
                **({"result": {"image": task["result"]}} if task.get("result") else {}),
                progress={"detail": progress.get("phase", "Working on desktop"),
                          "percent": max(0, min(100, 100 * (progress.get("step") or 0) / total)) if total else None},
                error="Desktop image generation failed. Check the desktop and submit a new job." if status == "failed" else None)
            if status in TERMINAL:
                self.changed()
                return
            await asyncio.sleep(.5)
            snapshot = await self.local("/image-generation/tasks?client_id=" + client_id)

    async def cancel(self, device_id, job_id):
        job = self.owned(device_id, job_id)
        if job["status"] in TERMINAL:
            return self.public(job)
        self.store.update("incoming", job_id, cancel_requested=True, status="cancelling")
        path = "/chat/stop/" if job["payload"]["kind"] == "chat" else "/image-generation/stop/"
        await self.local(path + "mobile-" + job_id, "POST")
        return self.public(self.owned(device_id, job_id))

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
