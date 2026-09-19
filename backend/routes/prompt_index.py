"""Routes for the reusable prompt index."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.prompt_index_store import (
    create_entry,
    delete_entry,
    clear_draft,
    load_state,
    list_entries,
    save_draft,
    update_entry,
)


router = APIRouter(prefix="/prompt-index", tags=["prompt-index"])


class PromptIndexEntryRequest(BaseModel):
    title: str
    content: str
    source: str | None = None
    tags: list[str] = []


class PromptIndexDraftRequest(BaseModel):
    editor: str | None = None
    form: dict | None = None
    search: str | None = None


@router.get("")
def get_entries():
    return {"entries": list_entries()}


@router.get("/state")
def get_state():
    return load_state()


@router.put("/draft")
def save_editor_draft(request: PromptIndexDraftRequest):
    return save_draft(request.editor, request.form, request.search)


@router.delete("/draft")
def remove_editor_draft():
    clear_draft()
    return {"deleted": True}


@router.post("")
def add_entry(request: PromptIndexEntryRequest):
    try:
        return create_entry(request.title, request.content, request.source, request.tags)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.put("/{entry_id}")
def edit_entry(entry_id: str, request: PromptIndexEntryRequest):
    try:
        entry = update_entry(entry_id, request.title, request.content, request.source, request.tags)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    if not entry:
        raise HTTPException(status_code=404, detail="Prompt Index entry not found")
    return entry


@router.delete("/{entry_id}")
def remove_entry(entry_id: str):
    if not delete_entry(entry_id):
        raise HTTPException(status_code=404, detail="Prompt Index entry not found")
    return {"deleted": True}
