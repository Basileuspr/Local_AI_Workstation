"""Character-region curation, queued suggestions, and reviewed training exports."""
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse
from pydantic import Field
from typing import Literal
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from services import image_library
from services.image_vault import LockedImageError
from services.image_workflows.scene_analysis import ImageSource
from services.image_workflows.adapters import vision_models
from services.character_parts import store
from services.character_parts.analysis import analyzer
from services.character_parts.contracts import (Record, Revision, Id, SaveSelection, StateRequest, AnalyzeRequest, PARTS, VIEWS, SIDES)

router = APIRouter(prefix="/character-parts", tags=["character-parts"])


def call(function, *args):
    try:
        return function(*args)
    except LockedImageError as exc:
        raise HTTPException(403, str(exc)) from exc
    except store.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc


class NameRequest(Record):
    name: str = Field(min_length=1, max_length=120)


class ImportRequest(Record):
    sources: list[ImageSource] = Field(min_length=1, max_length=100)


class CaptionRequest(Revision):
    caption: str = Field(max_length=2000)


class ExportRequest(Revision):
    scope: Literal["selected", "approved", "rejected"]
    ids: list[Id] = Field(default_factory=list, max_length=20000)


@router.on_event("startup")
async def recover():
    await run_in_threadpool(analyzer.recover)


@router.on_event("shutdown")
async def shutdown():
    await analyzer.shutdown()


@router.get("/catalog")
async def catalog():
    return {"parts": PARTS, "views": VIEWS, "sides": SIDES, "models": await run_in_threadpool(vision_models)}


@router.get("/datasets")
async def datasets():
    return {"datasets": await run_in_threadpool(call, store.list_datasets)}


@router.post("/datasets", status_code=201)
async def create(request: NameRequest):
    return await run_in_threadpool(call, store.create, request.name)


@router.get("/datasets/{dataset_id}")
async def dataset(dataset_id: str):
    return await run_in_threadpool(call, store.read, dataset_id)


@router.post("/datasets/{dataset_id}/import")
async def import_sources(dataset_id: str, request: ImportRequest):
    await run_in_threadpool(call, store.read, dataset_id)
    added, errors = 0, []
    for reference in request.sources:
        try:
            origin = reference.model_dump(exclude_none=True)
            content, meta = await run_in_threadpool(image_library.source_bytes, origin)
            added += await run_in_threadpool(store.import_image, dataset_id, content, meta.get("name") or "Image", origin)
        except (ValueError, OSError) as exc:
            errors.append({"source": reference.name or reference.id or "Image", "message": str(exc)[:300]})
    return {"dataset": await run_in_threadpool(call, store.read, dataset_id), "added": added, "errors": errors}


@router.post("/datasets/{dataset_id}/upload")
async def upload(dataset_id: str, files: list[UploadFile] = File(...)):
    await run_in_threadpool(call, store.read, dataset_id)
    if len(files) > 100:
        raise HTTPException(400, "Choose up to 100 files per batch")
    added, errors = 0, []
    for item in files:
        try:
            payload = await item.read(image_library.MAX_BYTES + 1)
            name = item.filename or "Upload"
            added += await run_in_threadpool(store.import_image, dataset_id, payload, name, {"kind": "upload", "name": name})
        except (ValueError, OSError) as exc:
            errors.append({"source": item.filename, "message": str(exc)[:300]})
        finally:
            await item.close()
    return {"dataset": await run_in_threadpool(call, store.read, dataset_id), "added": added, "errors": errors}


@router.get("/datasets/{dataset_id}/sources/{source_id}/image")
async def source_image(dataset_id: str, source_id: str, thumbnail: bool = False):
    data = await run_in_threadpool(call, store.read, dataset_id)
    payload = await run_in_threadpool(call, store.render, data, source_id, None, thumbnail)
    return Response(payload, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.put("/datasets/{dataset_id}/sources/{source_id}")
async def caption(dataset_id: str, source_id: str, request: CaptionRequest):
    return await run_in_threadpool(call, store.edit_source, dataset_id, source_id, request.revision, request.caption)


@router.post("/datasets/{dataset_id}/selections")
async def add_selection(dataset_id: str, request: SaveSelection):
    return await run_in_threadpool(call, store.save_selection, dataset_id, request.revision, request.selection)


@router.put("/datasets/{dataset_id}/selections/{selection_id}")
async def edit_selection(dataset_id: str, selection_id: str, request: SaveSelection):
    return await run_in_threadpool(call, store.save_selection, dataset_id, request.revision, request.selection, selection_id)


@router.post("/datasets/{dataset_id}/state")
async def state(dataset_id: str, request: StateRequest):
    return await run_in_threadpool(call, store.set_state, dataset_id, request)


@router.get("/datasets/{dataset_id}/selections/{selection_id}/crop")
async def crop(dataset_id: str, selection_id: str, thumbnail: bool = True):
    data = await run_in_threadpool(call, store.read, dataset_id)
    selection = call(store.selection, data, selection_id)
    payload = await run_in_threadpool(call, store.render, data, selection["source_id"], selection["box"], thumbnail)
    return Response(payload, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.post("/datasets/{dataset_id}/analyze", status_code=202)
async def analyze(dataset_id: str, request: AnalyzeRequest):
    return call(analyzer.start, dataset_id, request)


@router.get("/datasets/{dataset_id}/run")
async def status(dataset_id: str):
    return {"run": await run_in_threadpool(call, analyzer.status, dataset_id)}


@router.post("/datasets/{dataset_id}/run/stop")
async def stop(dataset_id: str, run_id: str):
    try:
        return {"run": await analyzer.stop(dataset_id, run_id)}
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/datasets/{dataset_id}/export")
async def export(dataset_id: str):
    archive = await run_in_threadpool(call, store.export_dataset, dataset_id)
    return archive_response(archive, "character-training-selection.zip")


@router.post("/datasets/{dataset_id}/export")
async def export_media(dataset_id: str, request: ExportRequest):
    archive = await run_in_threadpool(call, store.export_dataset, dataset_id, request.scope, request.ids, request.revision)
    return archive_response(archive, f"character-{request.scope}-media.zip")


def archive_response(archive, filename):
    def chunks():
        while data := archive.read(1024 * 1024):
            yield data
    return StreamingResponse(chunks(), media_type="application/zip", background=BackgroundTask(archive.close),
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})
