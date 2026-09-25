"""Authenticated document previews and downloads; never accepts a filesystem path."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from services import chat_documents

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.get("/{artifact_id}")
def preview(artifact_id: str):
    try:
        value = chat_documents.read_artifact(artifact_id)
        return JSONResponse({key: value[key] for key in ("id", "kind", "name", "title", "size", "blocks", "created_at")}, headers={"Cache-Control": "no-store"})
    except FileNotFoundError as exc: raise HTTPException(404, str(exc)) from exc


@router.get("/{artifact_id}/download")
def download(artifact_id: str):
    try:
        value = chat_documents.read_artifact(artifact_id)
        return FileResponse(chat_documents.file_path(artifact_id, "document.docx"), media_type=chat_documents.MIME,
                            filename=value["name"], headers={"Cache-Control": "no-store"})
    except FileNotFoundError as exc: raise HTTPException(404, str(exc)) from exc


@router.get("/{artifact_id}/images/{name}")
def image(artifact_id: str, name: str):
    try:
        if name == "document.docx": raise FileNotFoundError("Document image not found")
        return FileResponse(chat_documents.file_path(artifact_id, name), media_type="image/png", headers={"Cache-Control": "no-store"})
    except FileNotFoundError as exc: raise HTTPException(404, str(exc)) from exc
