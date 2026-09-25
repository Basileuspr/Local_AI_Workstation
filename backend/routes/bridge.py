"""Local, session-authenticated bridge controls. Never mounted on the peer API."""
import asyncio
from contextlib import suppress, asynccontextmanager
import threading
import uuid

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from config import settings
from services.bridge import Bridge, TaskSpec
from services.bridge_store import TERMINAL
from services.session_guard import expected_token

@asynccontextmanager
async def lifespan(app):
    await startup()
    try:
        yield
    finally:
        await shutdown()


router = APIRouter(prefix="/bridge", tags=["bridge"], lifespan=lifespan)
_instance = None
_lock = threading.RLock()
_poll_task = None


def get_bridge():
    global _instance
    with _lock:
        if _instance is None:
            _instance = Bridge(settings.data_dir / "bridge", f"http://127.0.0.1:{settings.port}", expected_token())
        return _instance


async def call(function, *args):
    try:
        return await function(*args)
    except (ValueError, OSError, httpx.HTTPError) as exc:
        # Network exception strings can contain target details or invitation secrets.
        detail = str(exc) if isinstance(exc, ValueError) else "Bridge connection failed. Check the peer address, app, private-network firewall permission and pairing."
        raise HTTPException(400, detail) from exc


class ListenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str = Field(max_length=50)
    port: int = Field(default=8765, ge=1024, le=65535)
    name: str = Field(min_length=1, max_length=60)


class InvitationRequest(BaseModel):
    code: str = Field(min_length=1, max_length=14000)


class SubmitRequest(TaskSpec):
    peer_id: uuid.UUID
    job_id: uuid.UUID


@router.get("")
async def status():
    return get_bridge().status()


@router.post("/start")
async def start(body: ListenRequest):
    bridge = get_bridge()
    await call(run_in_threadpool, bridge.start, body.address, body.port, body.name.strip() or "My PC")
    return bridge.status()


@router.post("/stop")
async def stop():
    bridge = get_bridge()
    await call(run_in_threadpool, bridge.stop)
    return bridge.status()


@router.post("/invitation")
async def invitation():
    return {"code": await call(run_in_threadpool, get_bridge().invitation), "expires_in": 300}


@router.post("/pair")
async def pair(body: InvitationRequest):
    return await call(get_bridge().pair, body.code)


@router.post("/peers/{peer_id}/revoke")
async def revoke(peer_id: uuid.UUID):
    bridge = get_bridge()
    with bridge.lock:
        peer = bridge.store.peer(str(peer_id))
        if not peer:
            raise HTTPException(404, "Peer not found.")
        if any(job["peer_id"] == str(peer_id) and job["status"] not in TERMINAL for job in bridge.store.jobs("incoming")):
            raise HTTPException(409, "Finish or cancel this peer's incoming work first.")
        peer.update(enabled=False, inbound="", token="")
        bridge.store.save_peer(peer)
        bridge.invites.clear()
    return {"revoked": True}


@router.get("/peers/{peer_id}/capabilities")
async def peer_capabilities(peer_id: uuid.UUID):
    bridge = get_bridge()
    try:
        peer = bridge.require_peer(str(peer_id))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return await call(bridge.transport, peer, "GET", "/capabilities")


@router.get("/jobs")
async def jobs():
    # Large results are fetched explicitly, not retransmitted by every status poll.
    bridge = get_bridge()
    entries = [{key: value for key, value in job.items() if key != "result"} for job in bridge.store.jobs() if not job.get("archived")]
    if not bridge.running:
        for job in entries:
            if job["direction"] == "outgoing" and job["status"] not in TERMINAL:
                job["connection_error"] = "Bridge is off. Start it to check the worker's current status and retrieve results."
    return {"jobs": entries}


@router.post("/jobs")
async def submit(body: SubmitRequest):
    bridge = get_bridge()
    spec = body.model_dump(exclude={"peer_id", "job_id"})
    job = await call(bridge.submit, str(body.peer_id), str(body.job_id), spec)
    return {key: value for key, value in job.items() if key != "result"}


def find_job(direction, job_id):
    if direction not in {"incoming", "outgoing"}:
        raise HTTPException(404, "Job not found.")
    job = get_bridge().store.job(direction, str(job_id))
    if not job:
        raise HTTPException(404, "Job not found.")
    return job


@router.get("/jobs/{direction}/{job_id}")
async def job_result(direction: str, job_id: uuid.UUID):
    job = find_job(direction, job_id)
    await call(run_in_threadpool, get_bridge().public_job, job)
    return job


@router.post("/jobs/outgoing/{job_id}/retry")
async def retry(job_id: uuid.UUID):
    find_job("outgoing", job_id)
    return await call(get_bridge().sync, str(job_id), True)


@router.post("/jobs/{direction}/{job_id}/cancel")
async def cancel(direction: str, job_id: uuid.UUID):
    job = find_job(direction, job_id)
    if job["status"] in TERMINAL:
        return {"status": job["status"]}
    bridge = get_bridge()
    if direction == "incoming":
        return await bridge.cancel_incoming(str(job_id))
    bridge.store.update(direction, str(job_id), cancel_requested=True)
    return await bridge.sync(str(job_id))


@router.delete("/jobs/{direction}/{job_id}")
async def delete(direction: str, job_id: uuid.UUID):
    find_job(direction, job_id)
    # Incoming cleanup retains a receipt so delayed retries cannot execute twice.
    await call(run_in_threadpool, get_bridge().store.delete, direction, str(job_id))
    return {"removed": True}


@router.post("/jobs/outgoing/{job_id}/save-chat")
async def save_chat(job_id: uuid.UUID):
    from services import session_store
    bridge = get_bridge()
    job = find_job("outgoing", job_id)
    if job["status"] != "completed":
        raise HTTPException(409, "Wait for the completed result.")
    await call(run_in_threadpool, bridge.public_job, job)

    def save():
        with bridge.lock:
            current = bridge.store.job("outgoing", str(job_id))
            session_id = current.get("saved_session")
            if not session_id:
                session = session_store.create_session(title="Bridge: " + current["payload"]["prompt"][:45])
                session_id = session["id"]
                bridge.store.update("outgoing", str(job_id), saved_session=session_id)
            result = current["result"]
            answer = {"role": "assistant", "content": result.get("text", "Generated on the paired PC.")}
            if result.get("image"):
                answer["generatedImages"] = [{"src": result["image"], "prompt": current["payload"]["prompt"]}]
            messages = [{"role": "user", "content": current["payload"]["prompt"]}, answer]
            # Once saved, subsequent clicks never overwrite a user's later edits.
            if not current.get("save_complete"):
                if not session_store.update_session(session_id, messages, model=current["payload"]["model"]):
                    raise ValueError("The saved destination was removed. Result remains in Bridge.")
                bridge.store.update("outgoing", str(job_id), save_complete=True)
            return {"session_id": session_id}
    return await call(run_in_threadpool, save)


async def startup():
    global _poll_task

    async def poll():
        from services.maintenance_gate import gate
        while True:
            if _instance and _instance.running and not gate.blocked():
                pending = [job for job in _instance.store.jobs("outgoing") if job["status"] not in TERMINAL]
                # Bound simultaneous transfers; each request has its own timeout.
                for offset in range(0, len(pending), 2):
                    await asyncio.gather(*(_instance.sync(job["id"]) for job in pending[offset:offset + 2]), return_exceptions=True)
            await asyncio.sleep(3)
    _poll_task = asyncio.create_task(poll())


async def shutdown():
    if _poll_task:
        _poll_task.cancel()
        with suppress(asyncio.CancelledError):
            await _poll_task
    if _instance:
        await run_in_threadpool(_instance.stop, True)
