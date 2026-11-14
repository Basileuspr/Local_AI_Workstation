"""Authenticated local Qwen/Wan job submission and output retrieval."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict
from starlette.concurrency import run_in_threadpool
from services import media_generation as media
from services.image_vault import LockedImageError

router = APIRouter(prefix='/media-generation', tags=['media-generation'])


class MediaRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    model_id: str = Field(min_length=1, max_length=100)
    prompt: str = Field(min_length=1, max_length=12000)
    negative_prompt: str = Field(default='', max_length=12000)
    width: int = Field(default=512, ge=128, le=1536)
    height: int = Field(default=512, ge=128, le=1536)
    steps: int = Field(default=20, ge=1, le=100)
    guidance: float = Field(default=5, ge=1, le=20)
    seed: int | None = Field(default=None, ge=0, le=2**31-1)
    references: list[str] = Field(default_factory=list, max_length=4)
    frames: int = Field(default=17, ge=9, le=81)
    fps: int = Field(default=16, ge=8, le=30)


@router.get('/models')
async def models():
    return await run_in_threadpool(media.catalog)


@router.get('/jobs')
async def list_jobs():
    return {'jobs': await run_in_threadpool(media.jobs.snapshots)}


@router.post('/jobs', status_code=202)
async def submit(request: MediaRequest):
    try:
        identifier = await media.jobs.submit(request.model_dump())
        return {'id': identifier}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post('/jobs/{identifier}/cancel')
async def cancel(identifier: str):
    await media.jobs.cancel(identifier)
    return {'ok': True}


@router.get('/jobs/{identifier}/output')
async def output(identifier: str, download: bool = False):
    media.jobs.load()
    item = media.jobs.jobs.get(identifier)
    if not item:
        raise HTTPException(404, 'Completed output not found.')
    try:
        path = await run_in_threadpool(media.output_path, item)
    except LockedImageError as exc:
        raise HTTPException(403, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(404, 'Completed output not found.') from exc
    return FileResponse(path, media_type='image/png' if item['kind'] == 'image' else 'video/webm',
                        filename=f'{item["model_id"]}-{identifier[:8]}{path.suffix}',
                        content_disposition_type='attachment' if download else 'inline', headers={'Cache-Control': 'no-store'})
