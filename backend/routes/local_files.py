"""Authenticated local-file UI, with extra native-only authority for filesystem paths."""
import asyncio
from contextlib import suppress
import hmac
import os
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, ConfigDict
from starlette.concurrency import run_in_threadpool

from services import file_handlers, local_files as store, local_database, local_video
from services.request_queue import queue, QueueCancelled

router = APIRouter(prefix='/local-files', tags=['local-files'])


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Open(Strict):
    path: str = Field(max_length=32768)


class Edit(Strict):
    id: str = Field(max_length=20)
    text: str = Field(max_length=1000000)
    bold: bool
    italic: bool


class Save(Strict):
    target: str = Field(max_length=32768)
    changes: list[Edit] = Field(max_length=10000)
    expected_target: str | None = None
    acknowledged: bool = False


class Query(Strict):
    table: str | None = Field(default=None, max_length=512)
    sql: str = Field(default='', max_length=32000)
    search: str = Field(default='', max_length=1000)
    offset: int = Field(default=0, ge=0, le=10000000)
    limit: int = Field(default=100, ge=1, le=200)
    count: bool = False


class Video(Strict):
    operation: Literal['metadata', 'frames', 'audio', 'transcript', 'vision', 'full']
    preset: Literal['quick', 'balanced', 'detailed', 'custom'] = 'quick'
    interval: float = Field(default=10, ge=.1, le=3600, allow_inf_nan=False)
    keyframes: bool = False
    model: str = Field(default='', max_length=200)
    speech_model: Literal['base', 'small', 'turbo'] = 'base'
    frame_ids: list[str] = Field(default_factory=list, max_length=120)
    focus: str = Field(default='', max_length=2000)


def native(request):
    token = os.environ.get('LAW_LOCAL_FILES_TOKEN', '')
    if not token or not hmac.compare_digest(request.headers.get('x-local-files', ''), token):
        raise HTTPException(403, 'Choose files and save destinations with the desktop file dialog.')


async def guarded(work, *args):
    try: return await run_in_threadpool(work, *args)
    except Exception as exc:
        # No document/database contents are logged; errors stay with the requester.
        raise HTTPException(400, str(exc)[:700]) from exc


@router.get('/handlers')
def handlers(): return file_handlers.registry()


@router.get('/capabilities')
def capabilities():
    from services import audio
    from services.image_workflows.adapters import vision_models
    return {'transcription': audio.status(), 'vision_models': vision_models()}


@router.post('/open')
async def open_file(body: Open, request: Request):
    native(request)
    return await guarded(store.open_file, body.path)


@router.post('/{identifier}/save')
async def save(identifier: str, body: Save, request: Request):
    native(request)
    def work():
        with store.operation(identifier, 'document') as item:
            item.data = item.document.save(body.target, [edit.model_dump() for edit in body.changes], body.expected_target, body.acknowledged)
            item.path = item.document.path
            return item.public()
    return await guarded(work)


@router.delete('/{identifier}')
async def close(identifier: str):
    await guarded(store.close, identifier)
    return {'closed': True}


@router.get('/{identifier}/status')
async def status(identifier: str):
    def work():
        item = store.get(identifier)
        return {'busy': item.lock.locked(), 'progress': item.progress}
    return await guarded(work)


@router.get('/{identifier}')
async def read(identifier: str):
    return await guarded(lambda: store.get(identifier).public())


@router.post('/{identifier}/cancel')
async def cancel(identifier: str):
    def work():
        store.get(identifier).cancel.set()
        return {'stopping': True}
    return await guarded(work)


@router.post('/{identifier}/query')
async def query(identifier: str, body: Query):
    def work():
        with store.operation(identifier, 'database') as item:
            return local_database.query(item.directory / 'snapshot.db', item.path.name, cancel=item.cancel, **body.model_dump())
    return await guarded(work)


@router.get('/{identifier}/asset/{asset}')
async def asset(identifier: str, asset: str):
    try:
        item = store.get(identifier)
        if asset == 'source' and item.handler in {'video', 'model'}:
            path = item.path
        elif item.handler == 'video' and asset in {f['id'] for f in item.data.get('frames', [])} | {item.data.get('audio_id')}:
            path = item.directory / asset
        else: raise ValueError('File asset not found.')
        return FileResponse(path, headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
    except ValueError as exc: raise HTTPException(404, str(exc)) from exc


@router.post('/{identifier}/video')
async def video(identifier: str, body: Video, request: Request):
    job = None; failure = None; watcher = None; worker = None; done = asyncio.Event()
    try:
        with store.operation(identifier, 'video') as item:
            if body.operation in {'vision', 'full'} and not body.model:
                raise ValueError('Choose an installed vision model to analyze the video. Frame extraction alone does not run analysis.')
            for key in ('transcript_warning', 'vision_warning'): item.data.pop(key, None)
            def report(message):
                item.progress = message
                if job: queue.set_stage(job, 'processing', message)
            job = queue.enqueue('local-file', 'Video processing', requires_gpu=False, cpu_lane='local-video')
            async def monitor():
                while not done.is_set():
                    if await request.is_disconnected() or item.cancel.is_set() or job.cancel_event.is_set():
                        item.cancel.set(); await queue.cancel(job); return
                    try: await asyncio.wait_for(done.wait(), .25)
                    except TimeoutError: pass
            watcher = asyncio.create_task(monitor())
            await queue.wait(job, request)
            def check():
                if item.cancel.is_set(): raise QueueCancelled('Video processing cancelled.')
            async def cpu(function, *args):
                nonlocal worker
                worker = asyncio.create_task(run_in_threadpool(function, *args))
                try:
                    result = await asyncio.shield(worker); check(); return result
                except asyncio.CancelledError:
                    item.cancel.set()
                    with suppress(Exception): await worker
                    raise
            check()
            if body.operation == 'metadata':
                item.data['metadata'] = await cpu(local_video.metadata, item.path)
            resample = body.operation in {'frames', 'full'} or body.operation == 'vision' and not body.frame_ids
            if resample:
                result = await cpu(local_video.sample, item.path, item.directory, item.data['metadata'], body.preset,
                                   body.interval, body.keyframes if body.operation == 'frames' else False, item.cancel, report)
                for old in item.data['frames']: (item.directory / old['id']).unlink(missing_ok=True)
                item.data.update(result)
                item.data.pop('analysis', None)
            if body.operation in {'audio', 'transcript', 'full'}:
                audio_path = None
                try:
                    report('Extracting audio')
                    audio_path = await cpu(local_video.extract_audio, item.path, item.directory, item.cancel)
                    if body.operation == 'audio':
                        old = item.data.get('audio_id')
                        if old: (item.directory / old).unlink(missing_ok=True)
                        item.data['audio_id'] = audio_path.name
                    else:
                        report('Transcribing with the existing local audio service; stopping waits for its current call')
                        item.data['transcript'] = await cpu(local_video.transcribe, audio_path, body.speech_model)
                except Exception as exc:
                    check()
                    if body.operation != 'full': raise
                    item.data['transcript_warning'] = str(exc)[:400]
                finally:
                    if audio_path and body.operation != 'audio': audio_path.unlink(missing_ok=True)
            if body.operation in {'vision', 'full'}:
                selected = [frame for frame in item.data['frames'] if resample or not body.frame_ids or frame['id'] in body.frame_ids]
                item.data['analysis'] = {}
                report('Waiting for the vision queue')
                try:
                    await local_video.vision(selected, item.directory, body.model, local_video.PRESETS[body.preset][1], item.cancel, report,
                                             body.focus, item.data.get('transcript') if body.operation == 'full' else None, item.data['analysis'])
                except QueueCancelled:
                    raise
                except Exception as exc:
                    check()
                    if body.operation != 'full': raise
                    item.data['vision_warning'] = str(exc)[:400]
            return item.public()
    except (asyncio.CancelledError, QueueCancelled) as exc:
        failure = 'Video processing cancelled.'
        if job: job.cancel_event.set()
        if worker and not worker.done():
            with suppress(Exception): await worker
        raise HTTPException(499, failure) from exc
    except Exception as exc:
        failure = str(exc)
        raise HTTPException(400, failure[:700]) from exc
    finally:
        done.set()
        # Remove incomplete outputs even when a cancellation arrived at a worker boundary.
        if 'item' in locals():
            retained = {f['id'] for f in item.data.get('frames', [])} | {item.data.get('audio_id')}
            for output in item.directory.glob('*'):
                if output.name not in retained: output.unlink(missing_ok=True)
        if watcher: await watcher
        if job: queue.finish(job, failure)
