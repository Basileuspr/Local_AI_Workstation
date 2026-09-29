"""Image tasks owned by the backend, independent of a renderer connection.

Tasks survive UI refreshes, not backend shutdowns. Generated images are saved to
their source chat before completion is reported. No base64 payloads are retained.
"""
import asyncio
import uuid
from dataclasses import dataclass, field

from starlette.concurrency import run_in_threadpool
from services import session_store


@dataclass
class ImageTask:
    client_id: str
    request: dict
    batch_id: str | None
    batch_index: int
    batch_count: int
    status: str = "queued"
    result: dict | None = None
    error: str | None = None
    cancelled: bool = False
    worker: object = None
    message_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    image_id: str = field(default_factory=lambda: uuid.uuid4().hex)

    def snapshot(self):
        return dict(request_id=self.request["request_id"], session_id=self.request["session_id"],
                    batch_id=self.batch_id, batch_index=self.batch_index, batch_count=self.batch_count,
                    prompt=self.request["prompt"], label=self.request.get("request_label"),
                    status=self.status, result=self.result, error=self.error)


class ImageTasks:
    def __init__(self):
        self.tasks = {}
        self._submit_lock = asyncio.Lock()

    def snapshot(self, client_id):
        return [task.snapshot() for task in self.tasks.values() if task.client_id == client_id]

    async def submit(self, client_id, requests, batch_id, model, execute):
        async with self._submit_lock:
            return await self._submit(client_id, requests, batch_id, model, execute)

    async def _submit(self, client_id, requests, batch_id, model, execute):
        ids = [request["request_id"] for request in requests]
        if len(ids) != len(set(ids)):
            raise ValueError("Each image must have a unique request ID")
        # Retries must return the original submission rather than enqueue twice.
        existing = [self.tasks.get(request_id) for request_id in ids]
        if any(existing):
            if not all(task and task.client_id == client_id and task.request == request
                       and task.batch_id == batch_id for task, request in zip(existing, requests)):
                raise ValueError("Image request ID already belongs to another submission")
            return self.snapshot(client_id)
        session_id = requests[0]["session_id"]
        if any(request["session_id"] != session_id for request in requests):
            raise ValueError("A batch must use one source chat")
        # Persist submission messages together before acknowledging the batch.
        messages = [{"id": f"image-request-{request['request_id']}", "role": "user",
                     "content": f"[Image generation] {request['prompt']}" +
                     (f"\n{request['request_label']}" if request.get("request_label") else "")}
                    for request in requests]
        session = await run_in_threadpool(session_store.append_messages, session_id, messages, model)
        if session is None:
            raise ValueError("The submitting chat is unavailable")
        finished = [key for key, task in self.tasks.items() if task.status in {"completed", "failed", "cancelled"}]
        for key in finished[:-100]:
            del self.tasks[key]
        for index, request in enumerate(requests):
            task = ImageTask(client_id, request, batch_id, index, len(requests))
            self.tasks[request["request_id"]] = task
            task.worker = asyncio.create_task(self._run(task, model, execute))
        return self.snapshot(client_id)

    async def _run(self, task, model, execute):
        try:
            if task.cancelled:
                task.status = "cancelled"
                return
            task.status = "running"
            generated = await execute(task.request)
            if task.cancelled:
                task.status = "cancelled"
                return
            task.status = "saving"
            seed = generated.get("seed")
            message = {"id": task.message_id, "role": "assistant",
                       "content": f"[Image generated: {generated['filename']}]" + (f"\nSeed: {seed}" if seed is not None else ""),
                       "generatedImages": [{"id": task.image_id, "src": generated["image_ref"],
                                            "name": generated["filename"], "type": "image/png",
                                            **({"seed": seed} if seed is not None else {})}]}
            session_id = task.request["session_id"]
            saved = await run_in_threadpool(session_store.append_messages, session_id, [message], model)
            if saved is None:
                raise ValueError("Image generated, but the submitting chat was removed")
            task.result = {key: value for key, value in generated.items() if key not in {"data_url", "image_ref"}}
            task.result.update(session_id=session_id, message_id=task.message_id, image_id=task.image_id,
                               request_id=task.request["request_id"], batch_id=task.batch_id,
                               url=f"/sessions/{session_id}/images/by-id/{task.message_id}/{task.image_id}")
            task.status = "completed"
        except asyncio.CancelledError:
            task.status = "cancelled"
            raise
        except Exception as error:
            task.status = "cancelled" if task.cancelled or getattr(error, "status_code", None) == 499 else "failed"
            task.error = str(getattr(error, "detail", error))
        finally:
            task.worker = None

    def cancel(self, request_id):
        task = self.tasks.get(request_id)
        if not task or task.status in {"completed", "failed", "cancelled", "saving"}:
            return False
        task.cancelled = True
        return True


image_tasks = ImageTasks()
