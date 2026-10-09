"""Opaque browser media handoff protected by launch and native capabilities."""
import asyncio
from contextlib import suppress
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from routes.local_files import native
from services import browser_media
from services.request_queue import queue, QueueCancelled

router = APIRouter(prefix='/browser-media', tags=['browser-media'])


class Expected(BaseModel):
    model_config = ConfigDict(extra='forbid')
    duration: float = Field(gt=0, le=600, allow_inf_nan=False)
    bytes: int = Field(gt=0, le=browser_media.MAX_BYTES)
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')


@router.post('/{identifier}/verify')
async def verify(identifier: str, body: Expected, request: Request):
    native(request)
    try:
        browser_media.directory(identifier)
        cancelled = browser_media.register(identifier)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, 'Browser media is unavailable or already busy.') from exc
    job = queue.enqueue('browser-media', 'Verify selected browser video', request_id=identifier,
                        requires_gpu=False, cpu_lane='local-video', cancel=lambda: browser_media.cancel(identifier))
    done = asyncio.Event()
    worker = None
    failure = None

    async def monitor():
        while not done.is_set():
            if cancelled.is_set() or job.cancel_event.is_set() or await request.is_disconnected():
                cancelled.set(); await queue.cancel(job); return
            try: await asyncio.wait_for(done.wait(), .1)
            except TimeoutError: pass

    watcher = asyncio.create_task(monitor())
    try:
        await queue.wait(job, request)
        if cancelled.is_set(): raise QueueCancelled()
        worker = asyncio.create_task(run_in_threadpool(browser_media.verify, identifier, body.model_dump(), cancelled,
                                  lambda message: queue.set_stage(job, 'verifying', message)))
        result = await asyncio.shield(worker)
        if cancelled.is_set(): raise QueueCancelled()
        return result
    except (QueueCancelled, asyncio.CancelledError) as exc:
        cancelled.set(); failure = 'Browser media verification cancelled.'
        await queue.cancel(job)
        if worker:
            with suppress(Exception): await worker
        raise HTTPException(499, failure) from exc
    except Exception as exc:
        # Decoder errors may contain source paths. Never return/log those.
        failure = 'Browser media could not be verified as a complete supported video.'
        raise HTTPException(400, failure) from exc
    finally:
        done.set(); await watcher
        queue.finish(job, failure); browser_media.release(identifier)


@router.post('/{identifier}/cancel')
def cancel(identifier: str, request: Request):
    native(request)
    return {'stopping': browser_media.cancel(identifier)}


@router.get('/{identifier}/{kind}')
def asset(identifier: str, kind: Literal['video', 'audio', 'captions'], request: Request):
    native(request)
    try:
        file = browser_media.asset(identifier, kind)
        return FileResponse(file, media_type={'video':'application/octet-stream','audio':'audio/mp4','captions':'application/json'}[kind],
                            headers={'Cache-Control':'no-store'})
    except (ValueError, OSError) as exc:
        raise HTTPException(404, 'Browser media has been cleared. Reacquire it in Browser.') from exc
