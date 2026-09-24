from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from typing import Literal
from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from services import image_library as library, image_vault as vault
from services.app_logging import get_logger

logger = get_logger("backend.image_library")

def no_store(response: Response):
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(prefix="/image-library", tags=["image-library"], dependencies=[Depends(no_store)])


def call(function, *args, **kwargs):
    try: return function(*args, **kwargs)
    except vault.PinError as error: raise HTTPException(401, str(error)) from error
    except vault.LockedImageError as error: raise HTTPException(403, str(error)) from error
    except (ValueError, KeyError, TypeError) as error: raise HTTPException(422, str(error)) from error
    except OSError as error:
        logger.exception("Image storage operation failed")
        raise HTTPException(500, "Image storage failed. Existing records were preserved.") from error


def token(authorization): return (authorization or "").removeprefix("Bearer ")


class Folder(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ImageEdit(BaseModel):
    rating: Literal["liked", "disliked"] | None = None
    folder_ids: list[str] | None = Field(default=None, max_length=100)
    hidden: bool | None = None
    caption: str | None = Field(default=None, max_length=10000)
    tag_ids: list[str] | None = Field(default=None, max_length=100)


class Tag(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class Source(BaseModel):
    kind: Literal["session", "workflow", "library"]
    id: str | None = Field(default=None, max_length=100)
    session_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]+$", max_length=100)
    message_id: str | None = Field(default=None, max_length=200)
    image_id: str | None = Field(default=None, max_length=200)
    workflow_id: str | None = Field(default=None, max_length=100)
    job_id: str | None = Field(default=None, max_length=100)
    output_id: str | None = Field(default=None, max_length=100)
    layout: Literal["grid", "row", "column"] | None = None
    name: str | None = Field(default=None, max_length=240)
    folder_id: str | None = Field(default=None, max_length=100)


@router.get("")
def listing(): return call(library.public_index)


@router.post("/folders")
def create_folder(request: Folder): return call(library.folder, request.name)


@router.post("/tags")
def create_tag(request: Tag): return call(library.tag, request.name)


@router.put("/tags/{tag_id}")
def rename_tag(tag_id: str, request: Tag): return call(library.tag, request.name, tag_id)


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: str):
    call(library.delete_tag, tag_id); return {"deleted": True}


@router.put("/folders/{folder_id}")
def rename_folder(folder_id: str, request: Folder): return call(library.folder, request.name, folder_id)


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str):
    call(library.delete_folder, folder_id); return {"deleted": True}


@router.post("/import")
def import_source(request: Source):
    data, item = call(library.source_bytes, request.model_dump(exclude_none=True))
    return call(library.import_image, data, item["name"], item.get("origin"), request.folder_id)


@router.post("/upload")
async def upload(files: list[UploadFile] = File(...)):
    images, errors = [], []
    try:
        if len(files) > 100: raise HTTPException(422, "Select up to 100 images per upload")
        for file in files:
            try:
                data = await file.read(library.MAX_BYTES + 1)
                images.append(await run_in_threadpool(call, library.import_image, data, file.filename, {"kind": "review"}))
            except HTTPException as error: errors.append({"name": file.filename, "error": error.detail})
        return {"images": images, "errors": errors}
    finally:
        for file in files: await file.close()


@router.get("/images/{image_id}/content")
def content(image_id: str):
    data, item = call(library.image_bytes, image_id)
    return Response(data, media_type=item["type"], headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.patch("/images/{image_id}")
def edit_image(image_id: str, request: ImageEdit):
    return call(library.edit_image, image_id, rating=request.rating, folder_ids=request.folder_ids, set_rating="rating" in request.model_fields_set, hidden=request.hidden, caption=request.caption, tag_ids=request.tag_ids)


@router.delete("/images/{image_id}")
def delete_image(image_id: str):
    call(library.delete_image, image_id); return {"deleted": True}


class Pin(BaseModel):
    pin: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")


class ChangePin(BaseModel):
    old_pin: str = Field(min_length=4, max_length=12)
    new_pin: str = Field(min_length=4, max_length=12, pattern=r"^[0-9]+$")


@router.get("/vault/status")
def vault_status():
    value = call(vault.config)
    return {"configured": value is not None, "locked_hashes": sorted(call(vault.locked_hashes))}


@router.post("/vault/setup")
def setup(request: Pin): return call(vault.setup, request.pin)


@router.post("/vault/unlock")
def unlock(request: Pin): return call(vault.unlock, request.pin)


@router.post("/vault/unlock-for-deletion")
def unlock_for_deletion(request: Pin): return call(vault.unlock, request.pin, preserve_sessions=True)


@router.post("/vault/lock")
def lock(authorization: str | None = Header(default=None)):
    if authorization: vault.revoke(token(authorization))
    else: vault.lock()
    return {"locked": True}


@router.post("/vault/pin")
def change_pin(request: ChangePin, authorization: str | None = Header(default=None)):
    return call(vault.change_pin, token(authorization), request.old_pin, request.new_pin)


@router.get("/vault/images")
def private_images(authorization: str | None = Header(default=None)):
    return {"images": call(vault.list_images, token(authorization))}


@router.get("/vault/images/{image_id}/content")
def private_content(image_id: str, authorization: str | None = Header(default=None)):
    data, item = call(vault.read_image, token(authorization), image_id)
    return Response(data, media_type=item["type"], headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/vault/import")
def lock_source(request: Source, authorization: str | None = Header(default=None)):
    call(vault.key_for, token(authorization))
    from services.request_queue import queue
    if any(job["status"] in {"queued", "running", "cancelling"} for job in queue.snapshot()["jobs"]):
        raise HTTPException(409, "Finish or stop queued work before locking its possible image inputs")
    data, item = call(library.source_bytes, request.model_dump(exclude_none=True))
    return call(vault.add, token(authorization), data, item["name"], item.get("origin") or request.model_dump(exclude_none=True))


@router.post("/vault/images/{image_id}/restore")
def restore(image_id: str, authorization: str | None = Header(default=None)):
    return call(vault.restore, token(authorization), image_id)


class ExportImages(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


@router.post("/export")
async def export_images(request: ExportImages):
    archive = await run_in_threadpool(call, library.export_images, request.ids)
    def chunks():
        while data := archive.read(1024 * 1024):
            yield data
    return StreamingResponse(chunks(), media_type="application/zip", background=BackgroundTask(archive.close),
        headers={"Content-Disposition": 'attachment; filename="review-images.zip"', "Cache-Control": "no-store"})
