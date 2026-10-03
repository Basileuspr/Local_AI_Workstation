from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
import json
from services import slicer

router = APIRouter(prefix='/slicer', tags=['slicer'])

class SliceOptions(BaseModel):
    machine: str = Field(default='fdmprinter', pattern=r'^[\w-]{1,100}$')
    generic_confirmed: bool = False
    material: str = Field(default='pla', pattern=r'^(pla|petg|abs)$')
    layer_height: float = Field(default=.2, ge=.06, le=.6, allow_inf_nan=False)
    nozzle: float = Field(default=.4, ge=.2, le=1.2, allow_inf_nan=False)
    infill: float = Field(default=20, ge=0, le=100, allow_inf_nan=False)
    support: bool = False
    heated_bed: bool = True

@router.get('/readiness')
def readiness(): return slicer.readiness()

@router.get('/status')
def status(): return slicer.status()

@router.post('/jobs')
async def start(file: UploadFile = File(...), options: str = Form('{}')):
    try:
        value = SliceOptions.model_validate_json(options).model_dump()
        raw = await file.read(slicer.MAX_FILE + 1)
        return await run_in_threadpool(slicer.start, raw, file.filename or '', value)
    except ValueError as exc: raise HTTPException(400, 'Invalid slicing options.' if not isinstance(exc, json.JSONDecodeError) and hasattr(exc, 'errors') else str(exc)) from exc
    finally: await file.close()

@router.post('/jobs/{ident}/stop')
def stop(ident: str):
    try: return slicer.cancel(ident)
    except ValueError as exc: raise HTTPException(404, str(exc)) from exc

@router.get('/jobs/{ident}/file')
def output(ident: str):
    try:
        file, name = slicer.output(ident)
        return FileResponse(file, filename=name, media_type='text/plain', headers={'Cache-Control': 'no-store'})
    except FileNotFoundError as exc: raise HTTPException(404, str(exc)) from exc
