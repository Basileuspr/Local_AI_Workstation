from typing import Literal
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, model_validator
from starlette.concurrency import run_in_threadpool
from PIL import Image
from services.image_manager import manager
from services.image_manager_tools import LIMITS as IMAGE_TOOL_LIMITS

router = APIRouter(prefix="/image-manager", tags=["image-manager"])


def call(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except (ValueError, KeyError, TypeError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise HTTPException(422, str(error)) from error
    except OSError as error:
        raise HTTPException(422, "An image folder or file is inaccessible. Check its location and permissions.") from error


class FolderRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    purpose: Literal["source", "output"] = "source"


class ImageToolsOptions(BaseModel):
    model_config = {"extra": "forbid"}
    format: Literal['png', 'jpg', 'webp'] = 'png'
    standardize: bool = False
    width: int = Field(default=1024, ge=1, le=IMAGE_TOOL_LIMITS['max_image_side'])
    height: int = Field(default=1024, ge=1, le=IMAGE_TOOL_LIMITS['max_image_side'])
    fit: Literal['contain', 'cover', 'stretch'] = 'contain'
    background: str = Field(default='#ffffff', pattern=r'^#[0-9a-fA-F]{6}$')
    layout: Literal['none', 'vertical', 'horizontal', 'grid', 'balanced', 'gif'] = 'none'
    columns: int = Field(default=0, ge=0, le=IMAGE_TOOL_LIMITS['max_stitched_side'])
    gap: int = Field(default=0, ge=0, le=IMAGE_TOOL_LIMITS['max_gap'])
    frame_delay: int = Field(default=100, ge=20, le=10000)
    loop: int = Field(default=0, ge=-1, le=1000)
    reverse: bool = False
    size_mode: Literal['exact', 'fit', 'pages'] = 'exact'
    images_per_sheet: int = Field(default=60, ge=1)
    order: Literal['filename', 'reverse', 'shuffle'] = 'filename'
    shuffle_seed: int = Field(default=1, ge=0, le=2147483647)
    trim_white: bool = False
    orientation_size: bool = False
    save_copies: bool = True
    name_prefix: str = Field(default='', max_length=80, pattern=r'^[\w -]*$')


class TaskRequest(BaseModel):
    kind: Literal["scan", "duplicates", "plan", "duplicate-plan", "function", "apply", "report", "trash", "image-tools"]
    folder_ids: list[str] = Field(default_factory=list, max_length=100)
    ids: list[str] = Field(default_factory=list)
    recursive: bool = True
    output_id: str = ""
    layout: Literal["month", "day", "format", "folders"] = "month"
    mode: Literal["copy", "move"] = "copy"
    function_id: str = ""
    plan_id: str = ""
    confirmation: str = ""
    review_id: str = ""
    duplicate_members: Literal["extra", "all"] = "extra"
    duplicate_offset: int = Field(default=0, ge=0, le=100000)
    image_options: ImageToolsOptions | None = None

    @model_validator(mode='after')
    def bounded_transfer_selection(self):
        if self.kind != 'image-tools' and len(self.ids) > 1000:
            raise ValueError('Select up to 1,000 images for organization and transfer tasks.')
        return self


class FunctionRequest(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=80)
    folder_ids: list[str] = Field(min_length=1, max_length=100)
    steps: list[Literal["scan", "duplicates", "plan", "duplicate-plan", "report"]] = Field(min_length=1, max_length=12)
    output_id: str = ""
    recursive: bool = True
    layout: Literal["month", "day", "format", "folders"] = "month"
    mode: Literal["copy", "move"] = "copy"
    duplicate_members: Literal["extra", "all"] = "extra"


class MetadataRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=1000)
    favorite: bool | None = None
    tags: list[str] | None = Field(default=None, max_length=20)
    add_tags: list[str] | None = Field(default=None, max_length=20)
    hidden: bool | None = None


class HideTaggedRequest(BaseModel):
    folder_id: str = Field(default="", max_length=100)


class ImageToolsSourcesRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)
    folder_id: str = ''
    recursive: bool = True


@router.post('/image-tools/sources')
def image_tools_sources(request: ImageToolsSourcesRequest):
    from services.image_manager_tools import sources
    return call(sources, manager, request.ids, folder_id=request.folder_id, recursive=request.recursive)


class TrashReviewRequest(BaseModel):
    action: Literal['delete', 'restore', 'purge']
    ids: list[str] = Field(min_length=1, max_length=1000)


@router.get('/trash')
def trash():
    return call(manager.trash)


@router.post('/trash/review')
def review_trash(request: TrashReviewRequest):
    return call(manager.review_trash, request.action, request.ids)


@router.get("/state")
def state():
    return call(manager.state)


@router.post("/folders")
def add_folder(request: FolderRequest):
    return call(manager.add_folder, request.path, request.purpose)


@router.delete("/folders/{identifier}")
def forget_folder(identifier: str):
    return call(manager.forget_folder, identifier)


@router.get("/images")
def images(folder_id: str = "", search: str = Query(default="", max_length=200), tag: str = Query(default="", max_length=120), format: str = "", month: str = "", favorite: bool = False, hide_tagged: bool = False, tagged_only: bool = False, visibility: Literal["visible", "hidden", "all"] = "visible",
           duplicates: bool = False, digest: str = "", sort: str = "date", offset: int = Query(default=0, ge=0), limit: int = Query(default=48, ge=1, le=1000)):
    return call(manager.query, folder_id=folder_id, search=search, tag=tag, format=format, month=month, favorite=favorite, hide_tagged=hide_tagged, tagged_only=tagged_only, visibility=visibility,
                duplicates=duplicates, digest=digest, sort=sort, offset=offset, limit=limit)


@router.get("/images/{identifier}/thumbnail")
async def thumbnail(identifier: str, large: bool = False):
    from services.image_vault import guard_path, LockedImageError
    _, original = await run_in_threadpool(call, manager.image_path, identifier)
    try:
        await run_in_threadpool(guard_path, original)
    except LockedImageError as error:
        raise HTTPException(403, "Image unavailable or locked") from error
    data = await run_in_threadpool(call, manager.thumbnail, identifier, 1280 if large else 320)
    try:
        await run_in_threadpool(guard_path, original)
    except LockedImageError as error:
        raise HTTPException(403, "Image unavailable or locked") from error
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/images/{identifier}/file")
def image_file(identifier: str):
    record, path = call(manager.image_path, identifier)
    if record["bytes"] > 64 * 1024 * 1024:
        raise HTTPException(422, "Use Show in folder for images larger than 64 MiB.")
    mime = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp", "AVIF": "image/avif", "TIFF": "image/tiff", "GIF": "image/gif", "BMP": "image/bmp"}[record["format"]]
    return FileResponse(path, media_type=mime, filename=path.name, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.get("/images/{identifier}/location")
def location(identifier: str):
    _, path = call(manager.image_path, identifier)
    return {"path": str(path)}


@router.patch("/metadata")
def metadata(request: MetadataRequest):
    return call(manager.metadata, request.ids, favorite=request.favorite, tags=request.tags, add_tags=request.add_tags, hidden=request.hidden)


@router.post("/visibility/hide-tagged")
def hide_tagged(request: HideTaggedRequest):
    return call(manager.hide_tagged, request.folder_id)


@router.post("/visibility/unhide")
def unhide_images(request: HideTaggedRequest):
    return call(manager.unhide_images, request.folder_id)


@router.post("/tasks")
def task(request: TaskRequest):
    return call(manager.start, request.kind, request.model_dump(exclude={"kind"}))


@router.post("/tasks/{identifier}/stop")
def stop(identifier: str):
    return call(manager.stop, identifier)


@router.get("/plans/{identifier}")
def plan(identifier: str):
    return call(manager.plan, identifier)


@router.post("/functions")
def save_function(request: FunctionRequest):
    return call(manager.save_function, request.model_dump())


@router.delete("/functions/{identifier}")
def remove_function(identifier: str):
    return call(manager.remove_function, identifier)
