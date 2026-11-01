"""Manual API endpoints for the SQLite-backed memory store."""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    change_memory,
    memory_project_names,
    MemoryConflict,
)


router = APIRouter(prefix="/memory", tags=["memory"])


class SaveMemoryRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    username: str = Field(min_length=1, max_length=100)
    memory_text: str = Field(min_length=1, max_length=8000)
    memory_type: str = Field(default="general", min_length=1, max_length=100)
    importance: int = Field(default=3, ge=1, le=5)
    project_name: str | None = Field(default=None, max_length=200)
    is_active: bool = True


class EditMemoryRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    version: int = Field(ge=1)
    memory_text: str | None = Field(default=None, min_length=1, max_length=8000)
    memory_type: str | None = Field(default=None, min_length=1, max_length=100)
    importance: int | None = Field(default=None, ge=1, le=5)
    is_active: bool | None = None

    @field_validator('memory_text', 'memory_type', 'importance', 'is_active')
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError('An edited field cannot be null')
        return value


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
            is_active=request.is_active,
        )
        return {"memory": memory_to_dict(memory)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("")
def get_memories(username: str = Query(..., min_length=1, max_length=100, description="User whose memories should be listed")):
    user = get_user_by_username(username)
    if not user:
        return {"memories": [], "count": 0, "candidate_ids": []}

    projects = memory_project_names(user.id)
    memories = [{**memory_to_dict(memory), 'project_name': projects.get(memory.project_id)} for memory in list_memories(user.id)]
    return {"memories": memories, "count": len(memories),
            "candidate_ids": [memory['id'] for memory in memories if memory['is_active']][:10]}


def _change(username, memory_id, version, changes=None):
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail='Memory no longer exists. Refresh the library.')
    try:
        memory = change_memory(user.id, memory_id, version, changes)
        return {'memory': memory_to_dict(memory)} if memory else {'deleted': memory_id}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except MemoryConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch('/{memory_id}')
def edit_memory(memory_id: int, request: EditMemoryRequest, username: str = Query(..., min_length=1, max_length=100)):
    changes = request.model_dump(exclude_unset=True, exclude={'version'})
    if not changes:
        raise HTTPException(status_code=400, detail='Choose a memory field to change.')
    return _change(username, memory_id, request.version, changes)


@router.delete('/{memory_id}')
def remove_memory(memory_id: int, username: str = Query(..., min_length=1, max_length=100), version: int = Query(..., ge=1)):
    return _change(username, memory_id, version)
