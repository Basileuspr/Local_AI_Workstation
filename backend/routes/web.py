from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.web_access import WebError, manager

router = APIRouter(prefix="/web", tags=["web"])


class ImportRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


@router.post("/jobs")
async def start_import(request: ImportRequest):
    try:
        return manager.start(request.url)
    except WebError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/active")
async def active_import():
    for job_id, task in manager.tasks.items():
        if not task.done():
            return {"job": manager.jobs[job_id].copy()}
    return {"job": None}


@router.get("/jobs/{job_id}")
async def import_status(job_id: str):
    if job_id not in manager.jobs:
        raise HTTPException(status_code=404, detail="Import not found. It may have ended when the backend restarted.")
    return manager.jobs[job_id].copy()


@router.post("/jobs/{job_id}/stop")
async def stop_import(job_id: str):
    result = await manager.cancel(job_id)
    if not result:
        raise HTTPException(status_code=404, detail="Import not found")
    return result.copy()
