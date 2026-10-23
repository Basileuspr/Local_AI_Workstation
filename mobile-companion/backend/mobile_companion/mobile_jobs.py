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


class ImageVariant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647, strict=True)
    steps: int = Field(ge=1, le=MAX_IMAGE_STEPS, strict=True)
    guidance_scale: float = Field(ge=1, le=MAX_IMAGE_GUIDANCE, allow_inf_nan=False)


class MobileSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["chat", "image"]
    session_id: str = Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
    expected_revision: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=12000)
    output_tokens: int = Field(default=-1, ge=-1, le=32768, strict=True)
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
    image_variants: list[ImageVariant] = Field(default_factory=list, max_length=32)

    @model_validator(mode="after")
    def valid(self):
        if not self.prompt.strip() or not self.model.strip():
            raise ValueError("Choose a model and enter a prompt.")
        if self.output_tokens == 0:
            raise ValueError("Output tokens must be -1 (automatic) or between 1 and 32768.")
        if self.kind == "chat" and self.image_variants:
            raise ValueError("Image variations require an image job.")
        validate_dimensions(self.width, self.height, self.allow_long_wait)
        return self


class MobileJobs:
    def __init__(self, root, local_url, local_token, *, transport=None):
        self.store = BridgeStore(root)
        self.local_url, self.local_token = local_url, local_token
        self.transport = transport
        self.tasks = {}
        self.submit_lock = asyncio.Lock()
        self.session_locks = {}
        self.session_jobs = {}
        self.snapshot_id = uuid.uuid4().hex

    def image_snapshot(self):
        """Desktop observation uses the existing image-task shape and saved results."""
        tasks = []
        for job in reversed(self.store.jobs("incoming")):
            spec = job.get("payload") or {}
            if spec.get("kind") != "image":
                continue
            members = job.get("members") or [{"id": "mobile-" + job["id"], "status": job["status"],
                "error": job.get("error"), "desktop_progress": job.get("desktop_progress")}]
            saved = (self.store.job("incoming", job["id"]).get("result") or {}) if any(
                member["status"] == "completed" for member in members) else {}
            for index, member in enumerate(members):
                status = member["status"] if job["status"] != "interrupted" or member["status"] in TERMINAL else "interrupted"
                tasks.append(dict(request_id=member["id"], session_id=spec["session_id"],
                    prompt=spec["prompt"], label=f"Phone · {index + 1}/{len(members)}" if len(members) > 1 else "Phone",
                    batch_id=job["id"] if len(members) > 1 else None, batch_index=index, batch_count=len(members),
                    status="failed" if status == "interrupted" else status,
                    result=saved.get("images", {}).get(member["id"], saved.get("image")),
                    error=member.get("error"), progress=member.get("desktop_progress")))
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
        value["started"] = job.get("started", False)
        if spec.get("kind") == "image":
            value["batch_count"] = len(spec.get("image_variants") or [None])
            value["members"] = [{**{key: member.get(key) for key in ("id", "status", "progress", "error")},
                **({"status": job["status"]} if job["status"] in TERMINAL and member["status"] not in TERMINAL else {})}
                for member in job.get("members", [])]
        if (job.get("result") or {}).get("response_usage"):
            value["response_usage"] = job["result"]["response_usage"]
        if detail:
            value["text"] = (job.get("result") or {}).get("text", "")
        return value

    def list(self, device_id):
        return [self.public(job) for job in self.store.jobs("incoming") if job["peer_id"] == device_id]

    async def submit(self, device_id, job_id, spec):
        payload = spec.model_dump()
        if spec.kind == "chat":
            payload = {key: payload[key] for key in ("kind", "session_id", "expected_revision", "model", "prompt", "output_tokens")}
        async with self.submit_lock:
            existing = self.store.job("incoming", job_id)
            if existing:
                previous = MobileSubmission(**existing["payload"]).model_dump() if existing["payload"] else None
                if previous and spec.kind == "chat":
                    previous = {key: previous[key] for key in payload}
                if existing["peer_id"] != device_id or previous != payload:
                    raise ValueError("Job ID already belongs to another request.")
                return self.public(existing, detail=True)
            outstanding = [job for job in self.store.jobs("incoming") if job["status"] not in TERMINAL]
            if spec.kind == "image":
                pending_images = sum(sum(member["status"] not in TERMINAL for member in job["members"])
                    if job.get("members") else 1 for job in outstanding if job["payload"]["kind"] == "image")
                if pending_images + len(spec.image_variants or [None]) > 32:
                    raise ValueError("The phone image queue holds 32 pending images. Finish or cancel images before adding this batch.")
            session = await run_in_threadpool(session_store.get_session, spec.session_id)
            if session is None:
                raise ValueError("The conversation is no longer available.")
            # Once work is pending, additive turns deliberately rebase on its
            # completed history. An idle, stale conversation still requires reload.
            if spec.kind == "chat" and session["revision"] != spec.expected_revision and not any(
                    job["payload"]["session_id"] == spec.session_id for job in outstanding):
                raise session_store.SessionConflict(session["revision"])
            # Persist a receipt BEFORE changing the chat or starting computation.
            # A crash at any later point leaves an interrupted, non-replayed job.
            job, _ = self.store.insert("incoming", job_id, device_id, payload)
            if spec.kind == "image":
                members = [{"id": "mobile-" + job_id + (f"-{index}" if spec.image_variants else ""),
                            "status": "queued", "cancel_requested": False}
                           for index in range(len(spec.image_variants or [None]))]
                job = self.store.update("incoming", job_id, members=members)
            self.session_locks.setdefault(spec.session_id, asyncio.Lock())
            self.session_jobs.setdefault(spec.session_id, set()).add(job_id)
            self.changed()
            task = asyncio.create_task(self.run(job, None))
            self.tasks[job_id] = task
            task.add_done_callback(lambda _task: self.forget(job_id, spec.session_id))
            return self.public(job, detail=True)

    def forget(self, job_id, session_id):
        self.tasks.pop(job_id, None)
        ids = self.session_jobs.get(session_id)
        if ids is not None:
            ids.discard(job_id)
            if not ids:
                self.session_jobs.pop(session_id, None)
                self.session_locks.pop(session_id, None)

    async def run(self, job, session):
        job_id, spec = job["id"], job["payload"]
        try:
            async with self.session_locks[spec["session_id"]]:
                if self.store.job("incoming", job_id)["cancel_requested"]:
                    self.store.update("incoming", job_id, status="cancelled")
                    return
                session = await run_in_threadpool(session_store.get_session, spec["session_id"])
                if session is None:
                    raise ValueError("Conversation was removed")
                self.store.update("incoming", job_id, started=True)
                if spec["kind"] == "chat":
                    session = await run_in_threadpool(session_store.append_messages, spec["session_id"],
                        [{"id": "mobile-" + job_id + "-user", "role": "user", "content": spec["prompt"]}], spec["model"])
                    if session is None:
                        raise ValueError("Conversation was removed")
                    self.changed()
                    if self.store.job("incoming", job_id)["cancel_requested"]:
                        self.store.update("incoming", job_id, status="cancelled")
                        return
                    await self.chat(job, session)
                else:
                    await self.image(job)
        except asyncio.CancelledError:
            current = self.store.job("incoming", job_id)
            self.fail(job_id, "cancelled" if current["cancel_requested"] else "interrupted",
                      None if current["cancel_requested"] else "Desktop worker stopped. This job was not replayed.")
            if current["cancel_requested"]:
                return
            raise
        except httpx.HTTPError:
            self.fail(job_id, "interrupted", "Desktop connection failed. The result may still be saved; check this conversation and gallery before submitting again.")
        except Exception as error:
            # Provider errors can include local paths, credentials and prompts.
            logger.warning("Mobile job %s failed (%s)", job_id, type(error).__name__)
            self.fail(job_id, "failed", "Desktop execution failed. Check desktop model availability and logs, then submit a new job.")

    def fail(self, job_id, status, error):
        current = self.store.job("incoming", job_id)
        members = [{**member, "status": status, "error": error} if member["status"] not in TERMINAL else member
                   for member in current.get("members", [])]
        self.store.update("incoming", job_id, status=status, error=error, **({"members": members} if members else {}))

    async def chat(self, job, session):
        job_id, spec = job["id"], job["payload"]
        messages = [{"role": message["role"], "content": message.get("content") or ""}
                    for message in session["messages"] if message.get("role") in {"system", "user", "assistant"}]
        if len(json.dumps(messages).encode()) > 1024 * 1024:
            raise ValueError("Conversation exceeds the mobile context limit.")
        body = {"model": spec["model"], "messages": messages, "session_id": spec["session_id"],
                "request_id": "mobile-" + job_id, "use_memory": False, "use_durable_memory": False,
                "use_knowledge_base": False, "tool_ids": [],
                "options": {"num_predict": spec.get("output_tokens", -1)}}
        text, complete, saved_at = "", False, 0
        response_usage = {"requested_tokens": spec.get("output_tokens", -1), "effective_tokens": None, "generated_tokens": None, "limit_reached": False}
        async with self.client() as client:
            async with client.stream("POST", "/chat", json=body) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    event = json.loads(line[6:])
                    if event.get("cancelled"):
                        self.store.update("incoming", job_id, status="cancelled", result={"text": text, "response_usage": response_usage})
                        return
                    if event.get("error") or str(event.get("token", "")).startswith("[Error:"):
                        raise ValueError("Provider failed")
                    usage = event.get("context_usage")
                    if usage:
                        response_usage.update(effective_tokens=usage.get("output_reserve"), generated_tokens=usage.get("generated_tokens"))
                    if event.get("notice", {}).get("kind") == "output_limit":
                        response_usage["limit_reached"] = True
                    text += event.get("token", "")
                    if len(text) > 1024 * 1024:
                        raise ValueError("Output limit exceeded")
                    complete = complete or event.get("done", False)
                    runtime = event.get("runtime_status") or {}
                    if time.monotonic() - saved_at > .2 or complete:
                        current = self.store.job("incoming", job_id)
                        self.store.update("incoming", job_id, result={"text": text, "response_usage": response_usage},
                            status="cancelling" if current["cancel_requested"] else "queued" if runtime.get("stage") == "queued" else "running",
                            progress={"stage": runtime.get("stage", "generating"), "detail": "Waiting for desktop queue" if runtime.get("stage") == "queued" else "Generating response"})
                        saved_at = time.monotonic()
        if not complete:
            raise ValueError("Stream ended without completion")
        if self.store.job("incoming", job_id)["cancel_requested"]:
            self.store.update("incoming", job_id, status="cancelled", result={"text": text, "response_usage": response_usage})
            return
        self.store.update("incoming", job_id, status="running", result={"text": text, "response_usage": response_usage}, progress={"stage": "saving", "detail": "Saving conversation"})
        saved = await run_in_threadpool(session_store.append_messages, spec["session_id"],
            [{"id": "mobile-" + job_id + "-assistant", "role": "assistant", "content": text, "response_usage": response_usage}], spec["model"])
        if saved is None:
            raise ValueError("Conversation was removed")
        self.store.update("incoming", job_id, status="completed", result={"text": text, "response_usage": response_usage}, progress=None)
        self.changed()

    async def image(self, job):
        job_id, spec = job["id"], job["payload"]
        client_id = "mobile-" + job["peer_id"]
        values = {key: spec[key] for key in ("session_id", "prompt", "negative_prompt", "width", "height", "steps", "guidance_scale", "seed", "lora_id", "lora_scale", "long_prompt", "allow_long_wait")}
        values["model_id"] = spec["model"]
        variants = spec.get("image_variants") or [{}]
        current = self.store.job("incoming", job_id)
        requests = [{**values, **variant, "request_id": member["id"],
                     "request_label": f"Phone batch {index + 1}/{len(variants)}" if len(variants) > 1 else "Phone"}
                    for index, (member, variant) in enumerate(zip(current["members"], variants))
                    if not member.get("cancel_requested")]
        if not requests or current["cancel_requested"]:
            self.store.update("incoming", job_id, status="cancelled")
            return
        snapshot = await self.local("/image-generation/tasks", "POST", {
            "client_id": client_id, "batch_id": job_id if len(requests) > 1 else None, "requests": requests})
        backend_id = snapshot["backend_id"]
        while True:
            if snapshot["backend_id"] != backend_id:
                self.fail(job_id, "interrupted", "Desktop restarted during generation. Check the gallery before submitting again.")
                return
            current = self.store.job("incoming", job_id)
            by_id = {item["request_id"]: item for item in snapshot["tasks"]}
            members, results = [], (current.get("result") or {}).get("images", {})
            for member in current["members"]:
                task = by_id.get(member["id"])
                if task is None:
                    if member["status"] == "cancelled":
                        members.append(member)
                        continue
                    raise ValueError("Image task disappeared")
                status = task["status"]
                if (current["cancel_requested"] or member.get("cancel_requested")) and status not in TERMINAL:
                    await self.local("/image-generation/stop/" + member["id"], "POST")
                progress = task.get("progress") or {}
                total = progress.get("total_steps") or 0
                members.append({**member, "status": "running" if status == "saving" else status,
                    "desktop_progress": progress, "progress": {
                        "detail": progress.get("phase", "Waiting for desktop queue"),
                        "percent": 100 if status in TERMINAL else max(0, min(100, 100 * (progress.get("step") or 0) / total)) if total else 0},
                    "error": "Image generation failed. Other saved images are retained." if status == "failed" else None})
                if task.get("result"):
                    results[member["id"]] = task["result"]
            # Cancellation may arrive while a desktop stop request is in flight.
            current = self.store.job("incoming", job_id)
            cancellations = {item["id"]: item.get("cancel_requested", False) for item in current["members"]}
            for member in members:
                member["cancel_requested"] = cancellations[member["id"]]
                if member["status"] not in TERMINAL and (member["cancel_requested"] or current["cancel_requested"]):
                    member["status"] = "cancelling"
            finished = all(member["status"] in TERMINAL for member in members)
            failed = any(member["status"] == "failed" for member in members)
            cancelled = any(member["status"] == "cancelled" for member in members)
            status = ("failed" if failed else "cancelled" if cancelled else "completed") if finished else (
                "cancelling" if current["cancel_requested"] else "running" if any(
                    member["status"] in {"running", "cancelling"} for member in members) else "queued")
            completed = sum(member["status"] == "completed" for member in members)
            self.store.update("incoming", job_id, status=status, members=members,
                result={"images": results, **({"image": next(iter(results.values()))} if len(members) == 1 and results else {})},
                progress={"detail": f"{completed}/{len(members)} images saved" if len(members) > 1 else members[0].get("progress", {}).get("detail"),
                          "percent": sum(member.get("progress", {}).get("percent", 100 if member["status"] in TERMINAL else 0) for member in members) / len(members)},
                error="Some images failed; completed images remain saved." if finished and failed else None)
            if finished:
                self.changed()
                return
            await asyncio.sleep(.5)
            snapshot = await self.local("/image-generation/tasks?client_id=" + client_id)

    async def cancel(self, device_id, job_id):
        job = self.owned(device_id, job_id)
        if job["status"] in TERMINAL:
            return self.public(job)
        # A waiting turn has not reached the desktop and must never start later.
        if job.get("started") is False or (job_id in self.tasks and not job.get("started")):
            self.store.update("incoming", job_id, cancel_requested=True, status="cancelled",
                **({"members": [{**member, "status": "cancelled", "cancel_requested": True} for member in job["members"]]} if job.get("members") else {}))
            if task := self.tasks.get(job_id):
                task.cancel()
            self.changed()
            return self.public(self.owned(device_id, job_id))
        self.store.update("incoming", job_id, cancel_requested=True, status="cancelling")
        if job["payload"]["kind"] == "image" and job.get("members"):
            for member in job["members"]:
                if member["status"] not in TERMINAL:
                    await self.local("/image-generation/stop/" + member["id"], "POST")
            return self.public(self.owned(device_id, job_id))
        path = "/chat/stop/" if job["payload"]["kind"] == "chat" else "/image-generation/stop/"
        await self.local(path + "mobile-" + job_id, "POST")
        return self.public(self.owned(device_id, job_id))

    async def cancel_image(self, device_id, job_id, member_id):
        job = self.owned(device_id, job_id)
        members = job.get("members") or []
        member = next((member for member in members if member["id"] == member_id), None)
        if job["payload"]["kind"] != "image" or member is None:
            raise KeyError("Image not found")
        if job["status"] in TERMINAL or member["status"] in TERMINAL:
            return self.public(job)
        updated = [{**item, "cancel_requested": True, "status": "cancelling" if job.get("started") else "cancelled"}
                   if item["id"] == member_id else item for item in members]
        self.store.update("incoming", job_id, members=updated)
        if all(item["status"] in TERMINAL for item in updated):
            return await self.cancel(device_id, job_id)
        if job.get("started"):
            await self.local("/image-generation/stop/" + member_id, "POST")
        return self.public(self.owned(device_id, job_id))

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
