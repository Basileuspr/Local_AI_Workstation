from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from services import hash_auditor

router = APIRouter(prefix="/hash-auditor", tags=["hash-auditor"])
Mode = Literal["hash", "name_size", "size_modified", "name_size_modified"]
LocalPath = Annotated[str, Field(min_length=1, max_length=4096)]


class AuditRequest(BaseModel):
    model_config = {"extra": "forbid"}
    roots: list[LocalPath] = Field(min_length=1, max_length=64)
    excludes: list[LocalPath] = Field(default_factory=list, max_length=64)


@router.get("/status")
def status():
    return hash_auditor.manager().status()


@router.post("/scans", status_code=202)
def start(request: AuditRequest):
    try:
        return hash_auditor.manager().start(request.roots, request.excludes)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/scans/{scan_id}/cancel")
def cancel(scan_id: str):
    return hash_auditor.manager().cancel(scan_id)


@router.get("/scans/{scan_id}/issues")
def issues(scan_id: str, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200)):
    return hash_auditor.manager().issues(scan_id, offset, limit)


@router.get("/groups")
def groups(mode: Mode = "hash", offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50)):
    return hash_auditor.manager().groups(mode, offset, limit)


@router.get("/group-files")
def group_files(mode: Mode, key: str = Query(..., max_length=12000), offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200)):
    try:
        return hash_auditor.manager().group_files(mode, key, offset, limit)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/files")
def files(offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200), search: str = Query("", max_length=4096)):
    return hash_auditor.manager().inventory(offset, limit, search)


@router.get("/export")
def export(scope: Literal["inventory", "matches"] = "inventory", mode: Mode = "hash"):
    return StreamingResponse(hash_auditor.manager().export_csv(scope, mode), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="hash-audit-{scope}.csv"', "Cache-Control": "no-store"})
