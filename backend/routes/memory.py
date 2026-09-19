"""Manual API endpoints for the SQLite-backed memory store."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from services.memory_store import (
    create_project_if_missing,
    create_user_if_missing,
    get_user_by_username,
    list_memories,
    memory_to_dict,
    save_memory,
)


router = APIRouter(prefix="/memory", tags=["memory"])


class SaveMemoryRequest(BaseModel):
    username: str
    memory_text: str
    memory_type: str = "general"
    importance: int = Field(default=3, ge=1, le=5)
    project_name: str | None = None


@router.post("")
def create_memory(request: SaveMemoryRequest):
    try:
        user = create_user_if_missing(request.username)
        project = None
        if request.project_name:
            project = create_project_if_missing(user.id, request.project_name)

        memory = save_memory(
            user_id=user.id,
            project_id=project.id if project else None,
            memory_text=request.memory_text,
            memory_type=request.memory_type,
            importance=request.importance,
        )
        return {"memory": memory_to_dict(memory)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("")
def get_memories(username: str = Query(..., description="User whose memories should be listed")):
    user = get_user_by_username(username)
    if not user:
        return {"memories": [], "count": 0}

    memories = [memory_to_dict(memory) for memory in list_memories(user.id)]
    return {"memories": memories, "count": len(memories)}
