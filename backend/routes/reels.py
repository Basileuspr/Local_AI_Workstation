"""Desktop-only reel batches. Model content cannot nominate a path or URL fetch."""
import asyncio
from contextlib import suppress
import threading
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from routes.local_files import native
from services import reels_analysis, reels_store
from services.request_queue import queue, QueueCancelled

router = APIRouter(prefix='/reels', tags=['reels'])
_running = {}


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Models(Strict):
    summaryModel: str | None = Field(default=None, min_length=1, max_length=200)
    visionModel: str = Field(min_length=1, max_length=200)
    whisperModel: Literal['base', 'small', 'turbo'] = 'small'


class Create(Models):
    accountRef: str = Field(pattern=r'^[a-f0-9]{64}$')
    profileId: str = Field(pattern=r'^(default|[a-f0-9]{32})$')
    sourceUrl: str = Field(max_length=1100)
    reels: list[str] = Field(min_length=1, max_length=100)


class Update(Strict):
    workflowId: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$')
    status: Literal['ready', 'running', 'paused', 'cancelled', 'interrupted', 'complete'] | None = None
    index: int | None = Field(default=None, ge=0, le=99)
    itemStatus: Literal['acquiring', 'unsupported', 'failed', 'cancelled', 'interrupted'] | None = None


class Analyze(Strict):
    workflowId: str = Field(pattern=r'^[a-f0-9]{32}$')
    capturedUrl: str = Field(max_length=1100)


@router.get('/state')
def state(request: Request):
    native(request)
    return {**reels_store.listing(), 'processing': list(_running)}


@router.post('/preflight')
async def preflight(body: Models, request: Request):
    native(request)
    try: return await reels_analysis.readiness(body.visionModel, body.whisperModel, body.summaryModel)
    except Exception as exc: raise HTTPException(400, 'Local vision or selected Whisper model is unavailable. Check Audio and local model setup.') from exc


@router.post('/batches')
def create(body: Create, request: Request):
    native(request)
    try: return reels_store.create(body.model_dump())
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


@router.post('/batches/{identifier}/checkpoint')
def checkpoint(identifier: str, body: Update, request: Request):
    native(request)
    try: return reels_store.update(identifier, body.status, body.index, body.itemStatus, body.workflowId)
    except (ValueError, IndexError) as exc: raise HTTPException(400, 'Invalid reel checkpoint.') from exc


@router.post('/batches/{identifier}/cancel')
async def cancel(identifier: str, request: Request):
    native(request)
    active = _running.get(identifier)
    if active:
        active.set()
        job = queue.find(kind='reels-analysis', request_id=identifier)
        if job: await queue.cancel(job)
    return {'stopping': bool(active)}


@router.post('/batches/{identifier}/items/{index}/analyze')
async def analyze(identifier: str, index: int, body: Analyze, request: Request):
    native(request)
    if _running: raise HTTPException(409, 'A reel is still processing. Wait until it stops.')
    try:
        record = reels_store.get(identifier)
        if index < 0: raise ValueError()
        item = record['items'][index]
        captured, _ = reels_store.source(body.capturedUrl, reel=True)
        if captured != item['url']: raise ValueError()
        if not reels_store.claim(identifier, index, body.workflowId):
            reels_store.cleanup(body.workflowId)
            return {'duplicate': True}
    except (ValueError, IndexError) as exc: raise HTTPException(400, 'The capture does not match the selected reel.') from exc
    event = threading.Event(); _running[identifier] = event
    job = queue.enqueue('reels-analysis', 'Reels: local transcript and evidence', request_id=identifier,
                        requires_gpu=False, cpu_lane='local-video', cancel=event.set)
    worker = None; failure = None; done = asyncio.Event()
    async def monitor():
        while not done.is_set():
            if event.is_set() or job.cancel_event.is_set() or await request.is_disconnected():
                event.set(); await queue.cancel(job); return
            try: await asyncio.wait_for(done.wait(), .15)
            except TimeoutError: pass
    watcher = asyncio.create_task(monitor())
    try:
        await queue.wait(job, request)
        if event.is_set(): raise QueueCancelled()
        worker = asyncio.create_task(reels_analysis.analyze(body.workflowId, record['visionModel'], record['whisperModel'], event,
                             lambda message: queue.set_stage(job, 'analyzing', message), record.get('summaryModel')))
        result = await asyncio.shield(worker)
        if event.is_set(): raise QueueCancelled()
        return reels_store.complete(identifier, index, result)
    except (QueueCancelled, asyncio.CancelledError) as exc:
        event.set(); await queue.cancel(job)
        if worker:
            with suppress(Exception): await worker
        failure = 'Reel processing cancelled.'
        reels_store.update(identifier, index=index, item_status='interrupted')
        raise HTTPException(499, failure) from exc
    except Exception as exc:
        if event.is_set():
            await queue.cancel(job)
            failure = 'Reel processing cancelled.'
            reels_store.update(identifier, index=index, item_status='interrupted')
            raise HTTPException(499, failure) from exc
        failure = 'Reel analysis incomplete: captured evidence could not be fully processed or verified.'
        reels_store.update(identifier, index=index, item_status='failed')
        raise HTTPException(400, failure) from exc
    finally:
        done.set(); await watcher
        # A summary is committed before deletion. Resume checks the unique identity.
        try:
            reels_store.cleanup(body.workflowId)
            reels_store.released(identifier, index)
        finally:
            queue.finish(job, failure); _running.pop(identifier, None)


@router.post('/clear-cache')
def clear(request: Request):
    native(request)
    if _running: raise HTTPException(409, 'Stop reel processing before clearing its cache.')
    reels_store.clear_cache()
    return {'cleared': True}
