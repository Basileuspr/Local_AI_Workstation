from fastapi import APIRouter, HTTPException
import sqlite3

from services.evaluation_contracts import ExternalResponse, Review, RunRequest, ScheduleRequest, Suite
from services.evaluation_runner import manager

router = APIRouter(prefix='/evaluations', tags=['evaluations'])


def call(action):
    try:
        return action()
    except KeyError as exc:
        raise HTTPException(404, str(exc.args[0])) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (sqlite3.DatabaseError, OSError) as exc:
        raise HTTPException(503, 'Testing history storage is unavailable. Preserve the evaluations folder for recovery and check the application logs.') from exc


@router.get('')
def overview():
    def read():
        service = manager()
        return {'suites': service.store.suites(), 'runs': service.store.listing(),
                'schedules': service.store.schedules(), 'history_limit': 500}
    return call(read)


@router.post('/suites')
def save_suite(value: Suite):
    return call(lambda: manager().store.save_suite(value.model_dump(mode='json')))


@router.post('/runs')
async def start(value: RunRequest):
    return call(lambda: manager().start(value.model_dump(mode='json')))


@router.get('/runs/{id}')
def read(id: str):
    return call(lambda: manager().store.run(id))


@router.post('/runs/{id}/stop')
async def stop(id: str):
    call(lambda: manager().store.run(id))
    return await manager().stop(id)


@router.post('/runs/{id}/responses/{result_id}')
def external(id: str, result_id: str, value: ExternalResponse):
    return call(lambda: manager().external(id, result_id, value.model_dump(mode='json')))


@router.put('/runs/{id}/reviews/{result_id}')
def review(id: str, result_id: str, value: Review):
    return call(lambda: manager().review(id, result_id, value.model_dump(mode='json')))


@router.post('/schedules')
def schedule(value: ScheduleRequest):
    return call(lambda: manager().schedule(value.model_dump(mode='json')))


@router.post('/schedules/{id}/disable')
def disable(id: str):
    return call(lambda: manager().disable_schedule(id))
