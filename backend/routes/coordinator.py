import asyncio
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from services.coordinator import manager
from services.coordinator_harnesses import HARNESSES

router = APIRouter(prefix='/coordinator', tags=['coordinator'])


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Start(Strict):
    harness_id: Literal['research', 'media']
    goal: str = Field(min_length=3, max_length=2000)
    model: str = Field(min_length=1, max_length=200)
    urls: list[str] = Field(default_factory=list, max_length=6)
    max_pages: int = Field(default=4, ge=1, le=6)
    media_ids: list[str] = Field(default_factory=list, max_length=24)

    @field_validator('goal')
    @classmethod
    def goal_text(cls, value):
        if len(value.strip()) < 3:
            raise ValueError('Describe a task with at least three non-padding characters.')
        return value.strip()


class Confirm(Strict):
    confirmed: Literal[True]


class Metadata(Confirm):
    media_ids: list[str] = Field(min_length=1, max_length=24)


class Transfer(Strict):
    media_ids: list[str] = Field(min_length=1, max_length=24)
    mode: Literal['copy', 'move']
    destination_preset_id: str = Field(max_length=80)
    collision: Literal['rename', 'skip'] = 'rename'


class Execute(Confirm):
    reviewed_plan_id: str = Field(pattern=r'^[a-f0-9]{32}$')


class Knowledge(Confirm):
    source_ref: str = Field(pattern=r'^S[1-8]$')


def checked(fn, *args):
    try:
        return fn(*args)
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise HTTPException(409, str(error) if isinstance(error, ValueError) else 'Coordinator data is unavailable; the record was retained.') from None


async def action(fn, *args):
    owner = manager()
    owner.actions += 1
    worker = asyncio.create_task(asyncio.to_thread(checked, fn, *args))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        # A disconnected HTTP client must not release maintenance while a file
        # transfer is still writing. The worker retains its durable receipt.
        await asyncio.gather(worker, return_exceptions=True)
        raise
    finally:
        owner.actions -= 1


@router.get('/harnesses')
def harnesses():
    return {'harnesses': HARNESSES}


@router.get('/runs')
def runs():
    from services.coding_coordinator import manager as coding
    coding_runs = coding().listing()
    records = [{**row, 'harness_id': 'coding', 'harness_version': 1} for row in coding_runs['runs']]
    rows = sorted(manager().listing() + records, key=lambda row: row.get('updated_at', row.get('created_at', 0)), reverse=True)
    return {'runs': rows, 'warnings': manager().warnings + coding_runs.get('warnings', [])}


@router.post('/runs', status_code=202)
async def start(body: Start):
    if body.harness_id == 'media' and (not body.media_ids or body.urls):
        raise HTTPException(422, 'Select registered media for Media Librarian.')
    if body.harness_id == 'research' and body.media_ids:
        raise HTTPException(422, 'Research uses public sources, not media IDs.')
    if len(set(body.media_ids)) != len(body.media_ids) or any(len(item) > 360 for item in body.media_ids):
        raise HTTPException(422, 'Use unique bounded registered media IDs.')
    return checked(manager().start, body.harness_id, body.goal.strip(), body.model, {'urls': body.urls, 'max_pages': body.max_pages, 'media_ids': body.media_ids})


@router.get('/runs/{ident}')
def read(ident: str):
    return checked(manager().get, ident)


@router.post('/runs/{ident}/stop')
async def stop(ident: str):
    checked(manager().get, ident)
    return await manager().stop(ident)


@router.post('/runs/{ident}/remove')
def remove(ident: str, body: Confirm):
    return checked(manager().delete, ident)


@router.post('/runs/{ident}/metadata')
async def metadata(ident: str, body: Metadata):
    return await action(manager().apply_metadata, ident, body.media_ids)


@router.post('/runs/{ident}/transfer-plan')
async def prepare_transfer(ident: str, body: Transfer):
    return await action(manager().prepare_transfer, ident, body.media_ids, body.mode, body.destination_preset_id, body.collision)


@router.post('/runs/{ident}/transfer')
async def transfer(ident: str, body: Execute):
    return await action(manager().transfer, ident, body.reviewed_plan_id)


@router.post('/runs/{ident}/knowledge')
async def knowledge(ident: str, body: Knowledge, request: Request):
    from routes.files import _embedding_work
    from services.web_knowledge import ingest
    document = checked(manager().document, ident, body.source_ref)
    owner = manager()
    owner.actions += 1
    try:
        result = await _embedding_work(request, 'Coordinator: save selected evidence to Knowledge', ingest, document)
        if result.get('error'):
            raise HTTPException(409, 'Knowledge did not save this source.')
        return checked(owner.knowledge_receipt, ident, body.source_ref, result)
    except ValueError:
        raise HTTPException(409, 'The selected source could not be saved to Knowledge. Check the local embedding runtime.') from None
    finally:
        owner.actions -= 1
