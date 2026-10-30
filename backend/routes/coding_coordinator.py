"""Desktop-authorized coding runs; never exposed as model-callable app tools."""
import hmac
import os
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict

from config import settings
from services.coding_coordinator import manager


def desktop(request: Request):
    token = os.environ.get('LAW_LOCAL_FILES_TOKEN', '')
    if not token or not hmac.compare_digest(request.headers.get('x-local-files', ''), token):
        raise HTTPException(403, 'Start and control coding tasks through the desktop workspace.')


router = APIRouter(prefix='/coding', tags=['coding-coordinator'])
RunId = Annotated[str, Field(pattern=r'^[a-f0-9]{32}$')]


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Check(Strict):
    name: str = Field(min_length=1, max_length=80)
    argv: list[str] = Field(min_length=1, max_length=40)
    timeout_seconds: int = Field(default=120, ge=1, le=600)


class Start(Strict):
    root: str = Field(min_length=1, max_length=4096)
    goal: str = Field(min_length=3, max_length=8000)
    model: str = Field(default='gpt-oss:20b', min_length=1, max_length=300)
    checks: list[Check] = Field(min_length=1, max_length=6)
    context_tokens: int = Field(default=8192, ge=4096, le=32768)
    max_rounds: int = Field(default=24, ge=2, le=40)
    trusted_checks: bool = False


async def guarded(operation):
    try:
        return await operation
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except RuntimeError as error:
        raise HTTPException(409, str(error)) from error
    except (ValueError, OSError, httpx.HTTPError) as error:
        raise HTTPException(400, str(error)) from error


@router.get('/models')
async def models():
    try:
        async with httpx.AsyncClient(timeout=15, trust_env=False) as client:
            response = await client.get(settings.ollama_base_url + '/api/tags')
            response.raise_for_status()
            result = []
            for item in response.json().get('models', [])[:50]:
                name = item.get('name')
                info = await client.post(settings.ollama_base_url + '/api/show', json={'model': name})
                info.raise_for_status()
                caps = info.json().get('capabilities', [])
                result.append({'name': name, 'tools': 'tools' in caps, 'thinking': 'thinking' in caps})
        return {'models': result}
    except httpx.HTTPError as error:
        raise HTTPException(503, 'Could not inspect local Ollama models.') from error


@router.get('/runs')
def runs():
    return manager().listing()


@router.get('/runs/{key}')
def read(key: RunId):
    try:
        return manager().get(key)
    except LookupError as error:
        raise HTTPException(404, str(error)) from error
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise HTTPException(409, 'This saved task needs recovery; its file was retained.') from error


@router.post('/runs', status_code=202, dependencies=[Depends(desktop)])
async def start(body: Start):
    if not body.trusted_checks:
        raise HTTPException(400, 'Acknowledge that project checks execute code on this PC.')
    if len({check.name for check in body.checks}) != len(body.checks):
        raise HTTPException(400, 'Check names must be unique.')
    if any(not arg or len(arg) > 4096 or '\0' in arg for check in body.checks for arg in check.argv):
        raise HTTPException(400, 'Check arguments must be nonempty text of at most 4096 characters.')
    return await guarded(manager().start(body.root, body.goal, body.model,
                         [check.model_dump() for check in body.checks], context_tokens=body.context_tokens,
                         max_rounds=body.max_rounds))


@router.post('/runs/{key}/resume', dependencies=[Depends(desktop)])
async def resume(key: RunId):
    return await guarded(manager().resume(key))


@router.post('/runs/{key}/pause', dependencies=[Depends(desktop)])
async def pause(key: RunId):
    return await guarded(manager().stop(key, pause=True))


@router.post('/runs/{key}/cancel', dependencies=[Depends(desktop)])
async def cancel(key: RunId):
    return await guarded(manager().stop(key))
