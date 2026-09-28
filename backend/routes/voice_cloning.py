import json
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool
from services import voice_cloning as voices
from services.audio import AudioError, EXTENSIONS

router = APIRouter(prefix='/voices', tags=['audio'])


@router.get('/status')
def status():
    return voices.status()


@router.post('/synthesize')
async def synthesize(reference: UploadFile = File(...), engine: str = Form(...), text: str = Form(...),
                     reference_text: str = Form(''), language: str = Form('English'), acceleration: str = Form('auto')):
    try:
        voices.validate(engine, text, reference_text, language, acceleration)
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
            waveform, processing = await run_in_threadpool(voices.synthesize, engine, text, path,
                reference_text, language, acceleration, directory)
            return Response(waveform, media_type='audio/wav', headers={
                'Content-Disposition':f'attachment; filename="{engine}-voice.wav"',
                'Cache-Control':'no-store', 'X-Voice-Processing':json.dumps(processing),
                'Access-Control-Expose-Headers':'X-Voice-Processing'})
    except AudioError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    finally:
        await reference.close()
