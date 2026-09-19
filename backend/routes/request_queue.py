from fastapi import APIRouter, HTTPException
from services.request_queue import queue

router = APIRouter(prefix="/queue", tags=["queue"])


@router.get("")
async def list_queue():
    return queue.snapshot()


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str):
    job = queue.find(job_id=job_id)
    if job is None:
        raise HTTPException(404, "Queue request not found")
    return {"cancelled": await queue.cancel(job)}
