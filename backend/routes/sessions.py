"""
Session Routes
API endpoints for managing chat sessions.

These are the HTTP endpoints that the JavaScript frontend calls.
They're thin wrappers around session_store.py — the route receives
the request, calls the service, and returns the result.
"""

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

# Import the session store service (Python side only)
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from services.session_store import (
    create_session,
    list_deleted_sessions,
    restore_session,
    get_session,
    public_session,
    update_session,
    update_session_metadata,
    update_checklist_item,
    edit_message_checklist,
    SessionConflict,
    append_messages,
    list_sessions,
    list_session_images,
    list_session_image_inventory,
    migrate_session_metadata,
    get_session_image,
    get_session_image_by_id,
    hide_session_image,
    permanently_delete_session_image,
    delete_session,
    permanently_delete_trashed_session as purge_trashed_session,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


# --- Data models for requests ---

class CreateSessionRequest(BaseModel):
    title: str | None = None


class UpdateSessionRequest(BaseModel):
    messages: list[dict]
    model: str | None = None
    title: str | None = None
    memory_summary: str | None = None
    summarized_message_count: int | None = None
    expected_revision: str | None = None


class UpdateSessionMetadataRequest(BaseModel):
    # Forbid histories here: an older caller must not accidentally replace them.
    model_config = {"extra": "forbid"}
    title: str | None = None
    model: str | None = None
    memory_summary: str | None = None
    summarized_message_count: int | None = Field(default=None, ge=0)
    expected_revision: str | None = None


def revision_error(error):
    return HTTPException(status_code=428 if error.required else 409, detail={
        "code": "session_revision_required" if error.required else "session_conflict",
        "message": str(error), "current_revision": error.revision,
    })


class MetadataMigrationRequest(BaseModel):
    session_ids: list[str] = Field(min_length=1, max_length=25)


class ChecklistItemRequest(BaseModel):
    model_config = {"extra": "forbid"}
    line_index: int = Field(ge=0, strict=True)
    checked: bool = Field(strict=True)
    expected_content: str


class ChecklistEditItem(BaseModel):
    model_config = {"extra": "forbid"}
    line_index: int | None = Field(default=None, ge=0, strict=True)
    text: str = Field(max_length=4000)
    checked: bool = Field(strict=True)


class ChecklistEditRequest(BaseModel):
    model_config = {"extra": "forbid"}
    expected_content: str
    items: list[ChecklistEditItem] = Field(max_length=500)


# --- Endpoints ---

@router.post("/new")
def create_new_session(request: CreateSessionRequest = None):
    """
    Create a fresh session with no memory.
    The frontend calls this when you click "New Chat".
    """
    title = request.title if request else None
    session = create_session(title=title)
    return public_session(session)


@router.get("/list")
def get_all_sessions():
    """
    Get all sessions (summaries only, not full message history).
    The frontend calls this to populate the session list/sidebar.
    """
    sessions = list_sessions()
    return {"sessions": sessions}


@router.get("/images")
def get_all_session_images(response: Response, hidden: bool = False, include_hidden: bool = False):
    """Return a lightweight gallery index for images stored in chats."""
    response.headers["Cache-Control"] = "no-store"
    if include_hidden:
        return list_session_image_inventory()
    return {"images": list_session_images(hidden=hidden)}


@router.post("/metadata/migrate")
def migrate_selected_session_metadata(request: MetadataMigrationRequest):
    """Optional, explicit maintenance for at most 25 selected legacy chats."""
    try:
        return migrate_session_metadata(request.session_ids)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/{session_id}/images/by-id/{message_id}/{image_id}")
def get_image_by_stable_id(session_id: str, message_id: str, image_id: str):
    """Stream one gallery image using its persistent IDs."""
    image = get_session_image_by_id(session_id, message_id, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    image_bytes, media_type = image
    return Response(
        content=image_bytes,
        media_type=media_type,
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{session_id}/images/{message_index}/{image_index}")
def get_image_by_id(session_id: str, message_index: int, image_index: int):
    """Legacy index-based image route retained for old URLs."""
    image = get_session_image(session_id, message_index, image_index)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    image_bytes, media_type = image
    return Response(
        content=image_bytes,
        media_type=media_type,
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/{session_id}/gallery-images/{image_id}")
def hide_image_from_gallery(session_id: str, image_id: str):
    """Hide an image from the gallery without modifying chat history."""
    if not hide_session_image(session_id, image_id):
        raise HTTPException(status_code=404, detail="Image not found")
    return {"deleted": True}


@router.delete("/{session_id}/images/{image_id}")
def permanently_delete_image(session_id: str, image_id: str):
    """Erase an image from its chat and reclaim its unshared disk files."""
    if not permanently_delete_session_image(session_id, image_id):
        raise HTTPException(status_code=404, detail="Image not found")
    return {"deleted": True}


@router.post("/{session_id}/gallery-images/{image_id}/restore")
def restore_gallery_image(session_id: str, image_id: str):
    if not hide_session_image(session_id, image_id, hidden=False): raise HTTPException(404, "Image not found")
    return {"restored": True}


@router.get("/trash")
def get_deleted_sessions():
    """Sessions that were removed but are still recoverable."""
    return {"sessions": list_deleted_sessions()}


class RestoreSessionRequest(BaseModel):
    file: str


@router.post("/trash/restore")
def restore_deleted_session(request: RestoreSessionRequest):
    """Put a deleted session back in the list."""
    session = restore_session(request.file)
    if not session:
        raise HTTPException(status_code=404, detail="Deleted session not found")
    return public_session(session)


@router.delete("/trash/{filename}")
def permanently_delete_trashed_session(filename: str):
    """Permanently erase one chat that is already in Recently deleted."""
    if not purge_trashed_session(filename):
        raise HTTPException(status_code=404, detail="Deleted session not found")
    return {"deleted": True}


@router.get("/{session_id}")
def get_session_by_id(session_id: str):
    """
    Load a specific session with its full message history.
    The frontend calls this when you click on a past session to resume it.
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return public_session(session)


@router.put("/{session_id}")
def update_session_by_id(session_id: str, request: UpdateSessionRequest):
    """
    Replace history only if it still matches the caller's loaded revision.
    Additive turns use append; rename/settings use the metadata route.
    """
    try:
        session = update_session(
            session_id=session_id,
            messages=request.messages,
            model=request.model,
            title=request.title,
            memory_summary=request.memory_summary,
            summarized_message_count=request.summarized_message_count,
            expected_revision=request.expected_revision,
        )
    except SessionConflict as error:
        raise revision_error(error) from error
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return public_session(session)


@router.patch("/{session_id}/metadata")
def patch_session_metadata(session_id: str, request: UpdateSessionMetadataRequest):
    try:
        session = update_session_metadata(session_id, **request.model_dump(exclude_unset=True))
    except SessionConflict as error:
        raise revision_error(error) from error
    if session is None:
        raise HTTPException(404, "Session not found")
    return public_session(session)


@router.post("/{session_id}/messages/append")
def append_session_messages(session_id: str, request: UpdateSessionRequest):
    try:
        session = append_messages(session_id, request.messages, model=request.model,
                                  memory_summary=request.memory_summary,
                                  summarized_message_count=request.summarized_message_count,
                                  expected_revision=request.expected_revision)
    except SessionConflict as error:
        raise revision_error(error) from error
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if session is None:
        raise HTTPException(404, "The original chat is no longer available")
    return public_session(session)


@router.patch("/{session_id}/messages/{message_id}/checklist")
def patch_checklist_item(session_id: str, message_id: str, request: ChecklistItemRequest):
    try:
        result = update_checklist_item(session_id, message_id, **request.model_dump())
    except SessionConflict as error:
        raise revision_error(error) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if result is None:
        raise HTTPException(404, "The checklist message is no longer available")
    return result


@router.put("/{session_id}/messages/{message_id}/checklist")
def edit_checklist_message(session_id: str, message_id: str, request: ChecklistEditRequest):
    try:
        result = edit_message_checklist(session_id, message_id, **request.model_dump())
    except SessionConflict as error:
        raise revision_error(error) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if result is None:
        raise HTTPException(404, "The checklist message is no longer available")
    return result


@router.delete("/{session_id}")
def delete_session_by_id(session_id: str):
    """
    Move a session to recoverable trash.
    The frontend calls this when you click delete on a past session.
    """
    try:
        deleted = delete_session(session_id)
    except OSError as exc:
        raise HTTPException(500, "Could not move this chat to Recently deleted. The original chat was preserved.") from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}
