from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from services.web_access import WebError, manager
from services import image_store

router = APIRouter(prefix="/web", tags=["web"])


class ImportRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2000)
    include_images: bool = True


@router.post("/jobs")
async def start_import(request: ImportRequest):
    try:
        return manager.start(request.url, include_images=request.include_images)
    except WebError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/active")
async def active_import():
    for job_id, task in manager.tasks.items():
        if not task.done():
            return {"job": manager.jobs[job_id].copy()}
    return {"job": None}


@router.get("/images/{digest}")
def imported_image(digest: str):
    reference = f"blob:{digest}"
    if not image_store.is_reference(reference):
        raise HTTPException(status_code=404, detail="Image not found")
    found = image_store.get_bytes(reference)
    if not found or found[1] not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
        raise HTTPException(status_code=404, detail="Image unavailable or locked")
    return Response(content=found[0], media_type=found[1],
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


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
