import asyncio
from contextlib import suppress
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from services import voice_cloning as voices
from services.audio import AudioError, EXTENSIONS

router = APIRouter(prefix='/voices', tags=['audio'])


@router.get('/status')
def status():
    return voices.status()


@router.post('/synthesize')
async def synthesize(request: Request, reference: UploadFile = File(...), engine: str = Form(...), text: str = Form(...),
                     reference_text: str = Form(''), language: str = Form('English'), acceleration: str = Form('auto'),
                     request_id: UUID | None = Form(None)):
    cancelled = None
    worker = monitor = None
    finished = asyncio.Event()
    async def watch_disconnect():
        while not finished.is_set():
            if await request.is_disconnected():
                cancelled.set()
                return
            with suppress(asyncio.TimeoutError):
                await asyncio.wait_for(finished.wait(), .2)
    try:
        voices.validate(engine, text, reference_text, language, acceleration)
        if request_id:
            cancelled = voices.register_request(str(request_id))
            monitor = asyncio.create_task(watch_disconnect())
        suffix = Path(reference.filename or '').suffix.lower()
        if suffix not in EXTENSIONS:
            raise AudioError('Choose a supported reference audio file.')
        with TemporaryDirectory(prefix='law-voice-') as work:
            directory = Path(work)
            path = directory / ('upload' + suffix)
            size = 0
            with path.open('wb') as handle:
                while block := await reference.read(1024 * 1024):
                    size += len(block)
                    if size > voices.MAX_REFERENCE_BYTES:
                        raise AudioError('Reference recordings must be 25 MB or smaller.', 413)
                    handle.write(block)
            if not size:
                raise AudioError('Choose a nonempty reference recording.')
            args = (engine, text, path, reference_text, language, acceleration, directory)
            worker = asyncio.create_task(run_in_threadpool(voices.synthesize, *args,
                **({'cancel_event': cancelled} if cancelled is not None else {})))
            try:
                waveform, processing = await asyncio.shield(worker)
                voices.check_cancelled(cancelled)
            except asyncio.CancelledError:
                if cancelled is not None:
                    cancelled.set()
                with suppress(Exception):
                    await asyncio.shield(worker)
                raise
            return Response(waveform, media_type='audio/wav', headers={
                'Content-Disposition':f'attachment; filename="{engine}-voice.wav"',
                'Cache-Control':'no-store', 'X-Voice-Processing':json.dumps(processing),
                'Access-Control-Expose-Headers':'X-Voice-Processing'})
    except AudioError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    finally:
        finished.set()
        if monitor:
            with suppress(asyncio.CancelledError):
                await monitor
        if cancelled is not None:
            voices.finish_request(str(request_id), cancelled)
        await reference.close()


@router.post('/stop/{request_id}')
def stop(request_id: UUID):
    return {'stopped': voices.cancel_request(str(request_id))}


@router.post('/references', status_code=201)
async def save_reference(reference: UploadFile = File(...)):
    """Explicitly retain a checked recording in the existing shared audio library."""
    from services import character_resources
    try:
        suffix = Path(reference.filename or '').suffix.lower()
        if suffix not in EXTENSIONS:
            raise AudioError('Choose a supported reference audio file.')
        payload = await reference.read(voices.MAX_REFERENCE_BYTES + 1)
        if not payload or len(payload) > voices.MAX_REFERENCE_BYTES:
            raise AudioError('Choose a nonempty reference recording up to 25 MB.', 413)
        with TemporaryDirectory(prefix='law-voice-reference-') as work:
            directory = Path(work)
            source = directory / ('input' + suffix)
            source.write_bytes(payload)
            await run_in_threadpool(voices.prepare_reference, source, directory / 'checked.wav')
        return await run_in_threadpool(character_resources.save_asset, reference.filename, payload)
    except (AudioError, ValueError) as exc:
        raise HTTPException(getattr(exc, 'status', 400), str(exc)) from exc
    finally:
        await reference.close()
