from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from services import image_conversion

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.post("/convert")
async def convert_image(file: UploadFile = File(...), target: str = Form(...), quality: int = Form(92, ge=1, le=100)):
    raw = await file.read(image_conversion.MAX_BYTES + 1)
    try: return await run_in_threadpool(image_conversion.convert, raw, file.filename or "image", target, quality)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc


@router.get("/converted/{ident}")
def download_conversion(ident: str):
    try:
        value, file = image_conversion.read(ident)
        return FileResponse(file, filename=value["name"], media_type=image_conversion.FORMATS[value["format"]][1], headers={"Cache-Control": "no-store"})
    except FileNotFoundError as exc: raise HTTPException(404, str(exc)) from exc
