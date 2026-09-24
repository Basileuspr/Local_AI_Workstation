"""Face dataset API. Detection runs in the background through the shared queue."""
from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from services.faces import bank, pipeline, store
from services.faces.providers import catalog, get_provider
from services.image_library import MAX_BYTES

router = APIRouter(prefix="/faces", tags=["faces"])
MAX_UPLOAD_FILES = 100


def call(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class NameRequest(BaseModel):
    name: str = Field(default="Face dataset", max_length=120)


class SettingsRequest(BaseModel):
    settings: dict


class ExtractRequest(BaseModel):
    sources: list[dict] = Field(default_factory=list, max_length=500)
    name: str = Field(default="", max_length=120)


class StateRequest(BaseModel):
    face_ids: list[str] = Field(default_factory=list, max_length=20000)
    state: str


class FaceIdsRequest(BaseModel):
    face_ids: list[str] = Field(default_factory=list, max_length=20000)


@router.get("/providers")
async def providers():
    entries = await run_in_threadpool(catalog)
    return {"providers": [entry.__dict__ for entry in entries]}


@router.post("/providers/install")
async def install_provider():
    """Fetch the model weights. This is the only action that downloads them."""
    from services.faces.insight_onnx import provider
    status = await run_in_threadpool(call, provider.install)
    return status.__dict__


@router.get("/datasets")
async def list_datasets():
    return {"datasets": await run_in_threadpool(store.list_datasets)}


@router.post("/datasets", status_code=201)
async def create_dataset(request: NameRequest):
    return await run_in_threadpool(call, store.create_dataset, request.name)


@router.get("/datasets/{dataset_id}")
async def get_dataset(dataset_id: str):
    dataset = await run_in_threadpool(call, store.get_dataset, dataset_id)
    return {**dataset, "run": pipeline.extractor.status(dataset_id)}


@router.put("/datasets/{dataset_id}")
async def rename_dataset(dataset_id: str, request: NameRequest):
    return await run_in_threadpool(call, store.rename_dataset, dataset_id, request.name)


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: str):
    if pipeline.extractor.active():
        raise HTTPException(409, "Stop the running face extraction before deleting this dataset.")
    await run_in_threadpool(call, store.delete_dataset, dataset_id)
    return {"deleted": True}


@router.put("/datasets/{dataset_id}/settings")
async def update_settings(dataset_id: str, request: SettingsRequest):
    return await run_in_threadpool(call, store.update_settings, dataset_id, request.settings)


@router.post("/datasets/{dataset_id}/extract", status_code=202)
async def extract(dataset_id: str, request: ExtractRequest):
    return call(pipeline.extractor.start, dataset_id, request.sources, request.name)


@router.post("/datasets/{dataset_id}/upload", status_code=202)
async def upload(dataset_id: str, files: list[UploadFile] = File(...), name: str = Form(default="", max_length=120)):
    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(400, f"Choose up to {MAX_UPLOAD_FILES} images at a time")
    import base64
    sources = []
    total_bytes = 0
    for item in files:
        payload = await item.read(MAX_BYTES + 1)
        await item.close()
        if len(payload) > MAX_BYTES:
            sources.append({"kind": "invalid-upload", "name": item.filename or "Upload", "error": "Images must be at most 20 MiB each"})
            continue
        total_bytes += len(payload)
        if total_bytes > 64 * 1024 * 1024:
            raise HTTPException(400, "Send face images in batches up to 64 MiB")
        sources.append({"kind": "inline", "name": item.filename or "Upload",
                        "data": base64.b64encode(payload).decode("ascii")})
    return call(pipeline.extractor.start, dataset_id, sources, name)


@router.get("/datasets/{dataset_id}/runs")
async def runs(dataset_id: str):
    records = await run_in_threadpool(call, store.list_runs, dataset_id)
    current = pipeline.extractor.status(dataset_id)
    for record in records:
        if current and current["id"] == record["id"]:
            record.update(current)
        elif record["status"] in {"queued", "running"}:
            record["status"] = "interrupted"
    return {"runs": records}


@router.put("/datasets/{dataset_id}/runs/{run_id}")
async def rename_run(dataset_id: str, run_id: str, request: NameRequest):
    result = await run_in_threadpool(call, store.rename_run, dataset_id, run_id, request.name)
    current = pipeline.extractor.run
    if current and current.id == run_id and current.dataset_id == dataset_id:
        current.name = result["name"]
    return result


@router.get("/datasets/{dataset_id}/run")
async def run_status(dataset_id: str):
    return {"run": pipeline.extractor.status(dataset_id)}


@router.post("/datasets/{dataset_id}/run/stop")
async def stop_run(dataset_id: str, run_id: str | None = None):
    try:
        return {"run": await pipeline.extractor.stop(dataset_id, run_id)}
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/datasets/{dataset_id}/recrop")
async def recrop(dataset_id: str, request: FaceIdsRequest):
    if pipeline.extractor.active():
        raise HTTPException(409, "Wait for the running face extraction to finish before re-cropping.")
    return await run_in_threadpool(call, pipeline.recrop, dataset_id, request.face_ids or None)


@router.get("/datasets/{dataset_id}/faces/{face_id}/crop")
async def crop(dataset_id: str, face_id: str):
    path = await run_in_threadpool(call, store.crop_path, dataset_id, face_id)
    return Response(content=await run_in_threadpool(path.read_bytes), media_type="image/png",
                    headers={"Cache-Control": "no-cache"})


@router.post("/datasets/{dataset_id}/state")
async def set_state(dataset_id: str, request: StateRequest):
    return await run_in_threadpool(call, store.set_state, dataset_id, request.face_ids, request.state)


@router.post("/datasets/{dataset_id}/remove")
async def remove_faces(dataset_id: str, request: FaceIdsRequest):
    return await run_in_threadpool(call, store.remove_faces, dataset_id, request.face_ids)


@router.get("/datasets/{dataset_id}/similar/{face_id}")
async def similar(dataset_id: str, face_id: str, threshold: float = Query(default=None)):
    scores = await run_in_threadpool(call, store.similarity_to, dataset_id, face_id)
    dataset = await run_in_threadpool(call, store.get_dataset, dataset_id)
    limit = dataset["settings"]["similar_threshold"] if threshold is None else float(threshold)
    matches = sorted(((face_id, value) for face_id, value in scores.items() if value >= limit),
                     key=lambda item: -item[1])
    return {"reference": face_id, "threshold": limit, "scores": scores,
            "matches": [{"face_id": item[0], "score": round(item[1], 4)} for item in matches],
            "note": "Similarity groups faces that look alike. It is not a confirmed identity."}


@router.post("/datasets/{dataset_id}/cluster")
async def cluster(dataset_id: str, threshold: float = Query(default=None)):
    return await run_in_threadpool(call, store.cluster, dataset_id, threshold)


@router.post("/datasets/{dataset_id}/duplicates")
async def duplicates(dataset_id: str, threshold: float = Query(default=None)):
    return await run_in_threadpool(call, store.mark_duplicates, dataset_id, threshold)


# --- character face bank -------------------------------------------------

class CharacterRequest(BaseModel):
    name: str = Field(max_length=120)
    dataset_id: str | None = None
    face_ids: list[str] = Field(default_factory=list, max_length=5000)
    notes: str = Field(default="", max_length=10000)
    tags: list[str] = Field(default_factory=list, max_length=40)


class CharacterEditRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=10000)
    tags: list[str] | None = Field(default=None, max_length=40)


class MembersRequest(BaseModel):
    dataset_id: str | None = None
    face_ids: list[str] = Field(default_factory=list, max_length=5000)
    state: str | None = None
    target_id: str | None = None


class ReferenceRequest(BaseModel):
    face_id: str
    role: str


@router.get("/characters")
async def list_characters():
    return {"characters": await run_in_threadpool(bank.list_characters)}


@router.post("/characters", status_code=201)
async def create_character(request: CharacterRequest):
    return await run_in_threadpool(call, bank.create_character, request.name, request.dataset_id,
                                   request.face_ids, request.notes, request.tags)


@router.get("/characters/{character_id}")
async def get_character(character_id: str):
    return await run_in_threadpool(call, bank.get_character, character_id)


@router.put("/characters/{character_id}")
async def update_character(character_id: str, request: CharacterEditRequest):
    return await run_in_threadpool(call, bank.update_character, character_id,
                                   name=request.name, notes=request.notes, tags=request.tags)


@router.delete("/characters/{character_id}")
async def delete_character(character_id: str):
    await run_in_threadpool(call, bank.delete_character, character_id)
    return {"deleted": True}


@router.post("/characters/{character_id}/members")
async def add_members(character_id: str, request: MembersRequest):
    if not request.dataset_id:
        raise HTTPException(400, "Choose the dataset these faces come from")
    return await run_in_threadpool(call, bank.add_members, character_id,
                                   request.dataset_id, request.face_ids)


@router.post("/characters/{character_id}/members/state")
async def set_member_state(character_id: str, request: MembersRequest):
    return await run_in_threadpool(call, bank.set_member_state, character_id,
                                   request.face_ids, request.state or "accepted")


@router.post("/characters/{character_id}/members/remove")
async def remove_members(character_id: str, request: MembersRequest):
    return await run_in_threadpool(call, bank.remove_members, character_id, request.face_ids)


@router.post("/characters/{character_id}/members/move")
async def move_members(character_id: str, request: MembersRequest):
    if not request.target_id:
        raise HTTPException(400, "Choose the character to move these faces into")
    return await run_in_threadpool(call, bank.move_members, character_id,
                                   request.target_id, request.face_ids)


@router.post("/characters/{character_id}/reference")
async def set_reference(character_id: str, request: ReferenceRequest):
    return await run_in_threadpool(call, bank.set_reference, character_id, request.face_id, request.role)


@router.post("/characters/{character_id}/recompute")
async def recompute(character_id: str):
    return await run_in_threadpool(call, bank.recompute, character_id)


@router.get("/characters/{character_id}/identity")
async def identity_bundle(character_id: str):
    """Stable read model for future identity-conditioned generation workflows."""
    return await run_in_threadpool(call, bank.reference_bundle, character_id)


@router.get("/datasets/{dataset_id}/export")
async def export(dataset_id: str, include_rejected: bool = False):
    dataset = await run_in_threadpool(call, store.get_dataset, dataset_id)
    payload, count = await run_in_threadpool(call, pipeline.export_archive, dataset_id,
                                             ("accepted",), include_rejected)
    safe = "".join(character for character in dataset["name"] if character.isalnum() or character in " -_").strip()
    return Response(content=payload, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="{safe or "face-dataset"}-{count}-faces.zip"'})
