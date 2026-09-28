from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from services import audio

router = APIRouter(prefix="/audio", tags=["audio"])
from routes.voice_cloning import router as voice_router
router.include_router(voice_router)


@router.get("/status")
def status():
    return audio.status()


@router.post("/setup")
async def setup(model_size: str = Form('base')):
    try:
        return await run_in_threadpool(audio.setup, model_size)
    except audio.AudioError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form("auto"),
                     diarize: bool = Form(False), num_speakers: int = Form(0, ge=0, le=20),
                     model_size: str = Form('base'), acceleration: str = Form('cpu'),
                     cpu_assistance: str | None = Form(None)):
    try:
        audio.model_directory(model_size)
        if acceleration not in {'auto', 'cpu'} or cpu_assistance not in {None, 'auto', 'light', 'balanced'}:
            raise HTTPException(400, 'Choose a supported processing and CPU assistance option.')
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in audio.EXTENSIONS:
            raise HTTPException(400, "Choose a WAV, MP3, M4A, AAC, OGG, FLAC, WebM, or MP4 audio file.")
        if language not in audio.LANGUAGES:
            raise HTTPException(400, "Choose a supported language or Auto detect.")
        with TemporaryDirectory(prefix="law-audio-") as directory:
            path = Path(directory) / ("input" + suffix)
            size = 0
            with path.open("wb") as target:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > audio.MAX_BYTES:
                        raise HTTPException(413, "Audio files must be 250 MB or smaller.")
                    target.write(chunk)
            if not size:
                raise HTTPException(400, "The audio file is empty.")
            if acceleration != 'cpu' or cpu_assistance is not None:
                return await run_in_threadpool(audio.transcribe, path, language, diarize, num_speakers,
                                               model_size, acceleration, cpu_assistance)
            if model_size != 'base':
                return await run_in_threadpool(audio.transcribe, path, language, diarize, num_speakers, model_size)
            if diarize:
                return await run_in_threadpool(audio.transcribe, path, language, True, num_speakers)
            return await run_in_threadpool(audio.transcribe, path, language)
    except audio.AudioError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    finally:
        await file.close()


@router.post('/speakers/setup')
async def setup_speakers():
    try:
        return await run_in_threadpool(audio.setup_speakers)
    except audio.AudioError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
