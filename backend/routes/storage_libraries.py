from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from services import storage_libraries as storage

router = APIRouter(prefix='/storage-libraries', tags=['storage-libraries'])


class AddLibrary(BaseModel):
    model_config = {'extra': 'forbid'}
    parent: str = Field(min_length=1, max_length=4096)
    name: str = Field(default='Local AI Workstation Library', min_length=1, max_length=80)
    label: str = Field(default='', max_length=120)


@router.get('')
def status():
    return storage.manager().status()


@router.post('', status_code=201)
def add(request: AddLibrary):
    try: return storage.manager().add(**request.model_dump())
    except (OSError, ValueError) as exc: raise HTTPException(400, str(exc)) from exc


@router.put('/default/{library_id}')
def select(library_id: str):
    try: return storage.manager().set_default(library_id)
    except (OSError, ValueError) as exc: raise HTTPException(409, str(exc)) from exc


@router.get('/{library_id}/location')
def location(library_id: str):
    store = storage.manager()
    if library_id == storage.PRIMARY: return {'path': str(store.root)}
    record = next((row for row in store.records()[0] if row['id'] == library_id), None)
    if not record: raise HTTPException(404, 'Unknown storage library.')
    try: return {'path': str(store.library_root(record))}
    except ValueError as exc: raise HTTPException(409, str(exc)) from exc


@router.post('/export-folder/{category}')
def export_folder(category: str):
    try: return {'folder': storage.manager().export_folder(category)}
    except (OSError, ValueError) as exc: raise HTTPException(409, str(exc)) from exc
