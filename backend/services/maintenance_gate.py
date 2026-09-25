"""Quiesce all HTTP work before the desktop closes its owned backend."""
import asyncio
import os
import secrets
import time
from fastapi import APIRouter, HTTPException, Request
from starlette.responses import JSONResponse

router = APIRouter(prefix="/maintenance")


class Gate:
    def __init__(self):
        self.active = 0
        self.locked = False
        self.expires = 0

    def blocked(self):
        if self.locked and time.monotonic() > self.expires: self.locked = False
        return self.locked


gate = Gate()


class MaintenanceMiddleware:
    def __init__(self, app): self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["path"] in {"/maintenance/lock", "/maintenance/unlock"}:
            return await self.app(scope, receive, send)
        if gate.blocked():
            return await JSONResponse({"detail": "App maintenance in progress."}, status_code=503)(scope, receive, send)
        gate.active += 1
        try: await self.app(scope, receive, send)
        finally: gate.active -= 1


def authorize(request):
    expected = os.environ.get("LAW_DESKTOP_MAINTENANCE_TOKEN", "")
    supplied = request.headers.get("x-desktop-maintenance", "")
    if not expected or not secrets.compare_digest(expected, supplied):
        raise HTTPException(403, "Maintenance is available only to the owning desktop process.")


def workers_busy():
    from services.request_queue import queue, TERMINAL
    from services.gpu_coordination import gpu_coordinator
    from services.lora_training import manager as training
    from services.image_workflows.runner import manager as workflows
    from routes.lora import active_analysis_tasks
    with queue._lock:
        queued = any(job.status not in TERMINAL for job in queue.jobs)
    return queued or gpu_coordinator.current_owner() is not None or training.is_active() or bool(workflows.active) or bool(active_analysis_tasks)


@router.post("/lock")
async def lock(request: Request):
    authorize(request)
    if gate.blocked(): raise HTTPException(409, "Maintenance is already preparing.")
    gate.locked = True
    gate.expires = time.monotonic() + 60
    try:
        from routes.bridge import _instance as bridge
        if bridge and bridge.running:
            raise HTTPException(409, "Stop the PC bridge in Dashboard before reset or backup.")
        # Block new traffic first; let existing requests finish. Busy inference
        # is never killed just to make the reset available.
        for _ in range(50):
            if workers_busy(): raise HTTPException(409, "Finish or cancel queued/running work before reset or backup.")
            if gate.active == 0: return {"locked": True}
            await asyncio.sleep(0.1)
        raise HTTPException(409, "Requests are still active. Wait for them to finish, then retry.")
    except BaseException:
        gate.locked = False
        raise


@router.post("/unlock")
async def unlock(request: Request):
    authorize(request)
    gate.locked = False
    return {"locked": False}
