"""Desktop-only mobile controls, behind the unchanged local SessionGuard."""
from contextlib import asynccontextmanager
import threading
import sqlite3
import uuid
import httpx

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from config import PROJECT_ROOT, settings
from mobile_companion.mobile_companion import MobileCompanion, MobileListen
from services.session_guard import expected_token
from services.conditional_status import conditional_status

_instance = None
_lock = threading.RLock()


def companion():
    global _instance
    with _lock:
        if _instance is None:
            _instance = MobileCompanion(settings.data_dir / "mobile", f"http://127.0.0.1:{settings.port}",
                                        expected_token(), PROJECT_ROOT / "dist" / "mobile")
        return _instance


@asynccontextmanager
async def lifespan(_app):
    yield
    if _instance:
        await run_in_threadpool(_instance.stop, True)


router = APIRouter(prefix="/mobile", tags=["mobile"], lifespan=lifespan)


@router.get("/activity")
async def activity():
    # Idle desktop observation must not initialize phone credentials or storage.
    return await call(lambda: {"revision": _instance.jobs.store.setting("activity") if _instance else None})


@router.get("/image-tasks")
async def image_tasks(request: Request):
    snapshot = await call(lambda: _instance.jobs.image_snapshot() if _instance else
                          {"backend_id": "inactive", "snapshot_sequence": 0, "tasks": []})
    return conditional_status(request, snapshot,
                              etag_data={key: snapshot[key] for key in ("backend_id", "tasks")})


@router.post("/image-tasks/{job_id}/cancel")
async def cancel_image(job_id: str):
    # Desktop task IDs refer either to a whole receipt or one batch member.
    try:
        parent_id = str(uuid.UUID(job_id))
        member_id = None
    except ValueError:
        try:
            parent_id = str(uuid.UUID(job_id[:36]))
            member_id = "mobile-" + job_id
        except ValueError:
            raise HTTPException(404, "Phone image job not found") from None
    service = _instance
    job = await call(lambda: service.jobs.store.job("incoming", parent_id) if service else None)
    if not job or (job.get("payload") or {}).get("kind") != "image":
        raise HTTPException(404, "Phone image job not found")
    try:
        return (await service.jobs.cancel_image(job["peer_id"], parent_id, member_id) if member_id
                else await service.jobs.cancel(job["peer_id"], parent_id))
    except KeyError:
        raise HTTPException(404, "Phone image not found") from None
    except httpx.HTTPError:
        raise HTTPException(503, "Cancellation saved; desktop confirmation unavailable. Retry after reconnecting.") from None


async def call(function, *args):
    try:
        return await run_in_threadpool(function, *args)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    except (OSError, sqlite3.Error):
        raise HTTPException(503, "Mobile storage unavailable. Check free space and desktop data permissions.") from None


@router.get("")
async def status():
    return await call(lambda: companion().status())


@router.post("/start")
async def start(body: MobileListen):
    return await call(lambda: companion().start(body))


@router.post("/stop")
async def stop():
    return await call(lambda: companion().stop())


@router.post("/invitation")
async def invitation():
    return await call(lambda: companion().invitation())


@router.post("/client-update")
async def client_update():
    def apply():
        service = companion()
        service.updates.start()
        return service.status()
    return await call(apply)


@router.post("/devices/{device_id}/revoke")
async def revoke(device_id: str):
    def apply():
        service = companion()
        service.access.revoke(device_id)
        return service.status()
    return await call(apply)
