import asyncio
from contextlib import suppress
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from services import audio_extraction as extraction
from services.audio import AudioError

router = APIRouter(tags=['audio'])


class ExtractionResponse(FileResponse):
    """Clean temporary inputs/output even when a download disconnects early."""
    def __init__(self, *args, temporary, **kwargs):
        super().__init__(*args, **kwargs)
        self.temporary = temporary

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.temporary.cleanup()


@router.get('/extraction/status')
def status():
    return extraction.status()


@router.post('/extract')
async def extract(request: Request, file: UploadFile = File(...), output_format: str = Form('mp3'),
                  track: int = Form(1,ge=1,le=32), request_id: UUID = Form(...)):
    temporary = None
    worker = monitor = None
    cancelled = threading.Event()
    finished = asyncio.Event()
    async def watch_disconnect():
        while not finished.is_set():
            if await request.is_disconnected():
                cancelled.set()
                return
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(finished.wait(),.2)
    try:
        suffix = Path(file.filename or '').suffix.lower()
        if suffix not in extraction.EXTENSIONS:
            raise AudioError('Choose a supported video or audio file, such as MP4, MOV, MKV, WebM, MP3, or WAV.')
        if output_format not in extraction.FORMATS:
            raise AudioError('Choose MP3, WAV, M4A, or FLAC output.')
        if extraction.status()['busy']:
            raise AudioError('Audio extraction is busy. Wait for the current file to finish.',409)
        monitor = asyncio.create_task(watch_disconnect())
        temporary = TemporaryDirectory(prefix='law-audio-extract-')
        directory = Path(temporary.name)
        source,output = directory/('input'+suffix),directory/('audio.'+output_format)
        size = 0
        with source.open('wb') as handle:
            while block := await file.read(1024**2):
                if cancelled.is_set():
                    raise AudioError('Audio extraction cancelled.',499)
                size += len(block)
                if size > extraction.MAX_INPUT_BYTES:
                    raise AudioError('Video and audio inputs must be 2 GB or smaller.',413)
                await run_in_threadpool(handle.write,block)
        if not size:
            raise AudioError('Choose a nonempty video or audio file.')
        worker = asyncio.create_task(run_in_threadpool(extraction.extract,source,output,output_format,track-1,str(request_id),cancelled))
        metadata = await asyncio.shield(worker)
        if cancelled.is_set():
            raise AudioError('Audio extraction cancelled.',499)
        response = ExtractionResponse(output,temporary=temporary,filename='extracted-audio.'+output_format,
            media_type=extraction.FORMATS[output_format]['mime'],headers={
                'Cache-Control':'no-store','X-Audio-Extraction':json.dumps(metadata),
                'Access-Control-Expose-Headers':'X-Audio-Extraction'})
        temporary = None  # Response owns cleanup until transmission finishes.
        return response
    except asyncio.CancelledError:
        cancelled.set()
        if worker:
            with suppress(Exception):
                await asyncio.shield(worker)
        raise
    except AudioError as exc:
        raise HTTPException(exc.status,str(exc)) from exc
    finally:
        finished.set()
        if monitor:
            with suppress(asyncio.CancelledError):
                await monitor
        if temporary:
            temporary.cleanup()
        await file.close()
