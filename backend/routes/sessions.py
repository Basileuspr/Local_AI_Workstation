"""
Session Routes
API endpoints for managing chat sessions.

These are the HTTP endpoints that the JavaScript frontend calls.
They're thin wrappers around session_store.py — the route receives
the request, calls the service, and returns the result.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Import the session store service (Python side only)
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from services.session_store import (
    create_session,
    get_session,
    update_session,
    list_sessions,
    delete_session,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


# --- Data models for requests ---

class CreateSessionRequest(BaseModel):
    title: str | None = None


class UpdateSessionRequest(BaseModel):
    messages: list[dict]
    model: str | None = None
    title: str | None = None


# --- Endpoints ---

@router.post("/new")
async def create_new_session(request: CreateSessionRequest = None):
    """
    Create a fresh session with no memory.
    The frontend calls this when you click "New Chat".
    """
    title = request.title if request else None
    session = create_session(title=title)
    return session


@router.get("/list")
async def get_all_sessions():
    """
    Get all sessions (summaries only, not full message history).
    The frontend calls this to populate the session list/sidebar.
    """
    sessions = list_sessions()
    return {"sessions": sessions}


@router.get("/{session_id}")
async def get_session_by_id(session_id: str):
    """
    Load a specific session with its full message history.
    The frontend calls this when you click on a past session to resume it.
    """
    session = get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.put("/{session_id}")
async def update_session_by_id(session_id: str, request: UpdateSessionRequest):
    """
    Save updated messages to a session.
    The frontend calls this after each message exchange.
    """
    session = update_session(
        session_id=session_id,
        messages=request.messages,
        model=request.model,
        title=request.title,
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/{session_id}")
async def delete_session_by_id(session_id: str):
    """
    Permanently delete a session.
    The frontend calls this when you click delete on a past session.
    """
    deleted = delete_session(session_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"deleted": True}