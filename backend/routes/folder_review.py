from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from services import folder_review

router = APIRouter(prefix='/folder-review', tags=['folder-review'])
ReviewId = Annotated[str, Field(pattern=r'^[a-f0-9]{32}$')]


class ReviewRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    root: str = Field(min_length=1, max_length=4096)
    model: str = Field(default='', max_length=200)
    recursive: bool = True
    max_entries: int = Field(default=2000, ge=1, le=10000)
    max_bytes: int = Field(default=16 * 1024 * 1024, ge=1024, le=32 * 1024 * 1024)
    max_chars: int = Field(default=200000, ge=1000, le=1000000)
    batch_chars: int = Field(default=4000, ge=500, le=6000)


@router.get('/status')
async def status():
    return await run_in_threadpool(folder_review.manager().status)


@router.post('/reviews', status_code=202)
async def start(request: ReviewRequest):
    try:
        options = request.model_dump(exclude={'root', 'model'})
        return await folder_review.manager().start(request.root, request.model.strip(), options)
    except (ValueError, OSError) as error:
        raise HTTPException(400, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error


@router.get('/reviews/{review_id}')
async def read(review_id: ReviewId):
    try:
        return await run_in_threadpool(folder_review.manager().get, review_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.get('/reviews/{review_id}/files')
async def files(review_id: ReviewId, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    try:
        return await run_in_threadpool(folder_review.manager().entries, review_id, offset, limit)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.post('/reviews/{review_id}/cancel')
async def cancel(review_id: ReviewId):
    try:
        return await folder_review.manager().cancel(review_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.get('/reviews/{review_id}/export')
async def export(review_id: ReviewId):
    try:
        review = await run_in_threadpool(folder_review.manager().get, review_id)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    if not review['report']:
        raise HTTPException(409, 'The report is still being prepared. Completed per-file results are available in the workspace.')
    return Response(review['report'], media_type='text/markdown', headers={
        'Content-Disposition': f'attachment; filename="folder-review-{review_id[:8]}.md"', 'Cache-Control': 'no-store'})
