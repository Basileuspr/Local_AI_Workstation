from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse, Response
from starlette.concurrency import run_in_threadpool
from services import image_conversion
from services import file_packager
from services import gif_maker
from starlette.background import BackgroundTask
import json
import asyncio
import hashlib
from contextlib import suppress
from uuid import UUID, uuid4
from services.request_queue import queue, QueueCancelled

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("/gif")
async def create_gif(client_request: Request, files: list[UploadFile] = File(...), width: int = Form(512), height: int = Form(512),
                     duration: int = Form(200), loop: bool = Form(True), background: str = Form("#ffffff"), fit: str = Form("cover"), request_id: UUID | None = Form(None), name: str = Form("Animation", max_length=100)):
    started = success = False
    key = str(request_id or uuid4())
    job = worker = monitor = None
    error = None
    finished = asyncio.Event()
    async def watch_disconnect():
        while not finished.is_set():
            if await client_request.is_disconnected():
                await queue.cancel(job)
                return
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(finished.wait(), 0.2)
    try:
        gif_maker.progress.start(key, len(files))
        started = True
        job = queue.enqueue('gif', name, key, requires_gpu=False, cpu_lane='gif',
                            timing_profile=hashlib.sha256(json.dumps([len(files), width, height, fit]).encode()).hexdigest())
        gif_maker.progress.update(key, 'Waiting in Prompt Queue', None, None)
        await queue.wait(job, client_request)
        gif_maker.progress.begin(key, len(files))
        monitor = asyncio.create_task(watch_disconnect())
        def report(phase, completed, total):
            if job.cancel_event.is_set():
                raise QueueCancelled('GIF creation cancelled')
            job.stage = phase
            gif_maker.progress.update(key, phase, completed, total)
        worker = asyncio.create_task(run_in_threadpool(gif_maker.create, files, width, height, duration, loop, background, fit, report))
        data = await asyncio.shield(worker)
        if job.cancel_event.is_set():
            raise QueueCancelled('GIF creation cancelled')
        success = True
        return Response(data, media_type="image/gif", headers={"Cache-Control": "no-store"})
    except (QueueCancelled, asyncio.CancelledError):
        if job:
            await queue.cancel(job)
        if worker:
            with suppress(Exception):
                await asyncio.shield(worker)
        raise HTTPException(499, 'GIF creation cancelled')
    except ValueError as exc:
        error = str(exc)
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        error = str(exc)
        raise
    finally:
        finished.set()
        if monitor:
            with suppress(asyncio.CancelledError):
                await monitor
        if job:
            queue.finish(job, error)
        if started:
            gif_maker.progress.finish(key, success)
            if job and job.cancel_event.is_set():
                gif_maker.progress.update(key, 'Cancelled', None, None)
        for file in files:
            await file.close()


@router.get('/gif/progress/{request_id}')
def gif_progress(request_id: UUID):
    return {'progress': gif_maker.progress.get(str(request_id))}


@router.post("/package")
async def create_package(files: list[UploadFile] = File(...), entries: str = Form(...),
                         name: str = Form("Package"), compression: str = Form("compressed")):
    try:
        if len(entries) > 1024 * 1024:
            raise ValueError("Too many package paths.")
        manifest = json.loads(entries)
        if not isinstance(manifest, list):
            raise ValueError("Invalid package file list.")
        target = await run_in_threadpool(file_packager.build_package, files, manifest, compression)
        return FileResponse(target, filename=file_packager.package_name(name), media_type="application/zip",
                            headers={"Cache-Control": "no-store"},
                            background=BackgroundTask(target.unlink, missing_ok=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        for file in files:
            await file.close()


@router.post("/convert")
async def convert_image(file: UploadFile = File(...), target: str = Form(...), quality: int = Form(92, ge=1, le=100),
                        icon_size: int = Form(256), icon_fit: str = Form('contain')):
    raw = await file.read(image_conversion.MAX_BYTES + 1)
    try: return await run_in_threadpool(image_conversion.convert, raw, file.filename or "image", target, quality,
                                      icon_size=icon_size, icon_fit=icon_fit)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


@router.get("/converted/{ident}")
def download_conversion(ident: str, thumbnail: bool = False):
    try:
        value, file = image_conversion.read(ident)
        if thumbnail:
            from services.image_thumbnails import path_response
            return path_response(file)
        return FileResponse(file, filename=value["name"], media_type=image_conversion.FORMATS[value["format"]][1], headers={"Cache-Control": "no-store"})
    except FileNotFoundError as exc: raise HTTPException(404, str(exc)) from exc
