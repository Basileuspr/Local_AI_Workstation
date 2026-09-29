from fastapi import APIRouter, HTTPException
from services.request_queue import queue

router = APIRouter(prefix="/queue", tags=["queue"])


@router.get("")
async def list_queue():
    snapshot = queue.snapshot()
    from services.image_generation import manager
    for job in snapshot["jobs"]:
        if job["kind"] == "image" and job["status"] == "running":
            job["progress"] = manager.generation_progress(job["request_id"])
    return snapshot


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str):
    job = queue.find(job_id=job_id)
    if job is None:
        raise HTTPException(404, "Queue request not found")
    return {"cancelled": await queue.cancel(job)}
