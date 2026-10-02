import hashlib
import io
import json
from pathlib import Path
import threading
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from services import storage_libraries as storage
from routes.storage_libraries import router


@pytest.fixture
def libraries(tmp_path, monkeypatch):
    service = storage.Libraries(tmp_path/'app-data')
    monkeypatch.setattr(storage, 'manager', lambda: service)
    return service


def add(service, tmp_path, name):
    parent = tmp_path/name; parent.mkdir()
    return service.add(str(parent), 'App Library', name)


def png(color='blue'):
    result = io.BytesIO(); Image.new('RGB', (12, 12), color).save(result, format='PNG'); return result.getvalue()


def test_nothing_created_until_explicit_action_and_default_is_persisted(libraries, tmp_path):
    assert not libraries.root.exists()
    assert libraries.status()['default_id'] == 'primary'
    assert not libraries.root.exists()
    a = add(libraries, tmp_path, 'drive-a')
    b = add(libraries, tmp_path, 'drive-b')
    assert (Path(a['path'])/storage.MARKER).is_file()
    assert libraries.status()['default_id'] == 'primary'
    libraries.set_default(b['id'])
    assert storage.Libraries(libraries.root).status()['default_id'] == b['id']
    assert len(libraries.status()['libraries']) == 3


def test_new_files_follow_default_and_existing_objects_remain_accessible(libraries, tmp_path):
    old = libraries.root/'generated_images/old.png'; old.parent.mkdir(parents=True); old.write_bytes(b'old')
    a = add(libraries, tmp_path, 'drive-a'); libraries.set_default(a['id'])
    first = libraries.path(libraries.root/'generated_images/a.png', create=True); first.write_bytes(b'A')
    b = add(libraries, tmp_path, 'drive-b'); libraries.set_default(b['id'])
    second = libraries.path(libraries.root/'generated_images/b.png', create=True); second.write_bytes(b'B')
    assert first.is_relative_to(a['path']) and second.is_relative_to(b['path'])
    assert libraries.path(old, create=True) == old and old.read_bytes() == b'old'
    assert libraries.path(libraries.root/'generated_images/a.png').read_bytes() == b'A'
    assert libraries.path(libraries.root/'generated_images/b.png').read_bytes() == b'B'
    assert not (libraries.root/'generated_images/a.png').exists()
    assert len(list(storage.glob_paths(libraries.root/'generated_images', '*.png'))) == 3


def test_disconnected_or_replaced_library_never_falls_back(libraries, tmp_path):
    a = add(libraries, tmp_path, 'drive-a'); libraries.set_default(a['id'])
    logical = libraries.root/'artifacts'/('a'*32)/'document.docx'
    path = libraries.path(logical, create=True); path.write_bytes(b'document')
    original = Path(a['path']); away = original.with_name('Disconnected'); original.rename(away)
    with pytest.raises(storage.StorageUnavailable): libraries.path(logical)
    with pytest.raises(storage.StorageUnavailable): libraries.path(libraries.root/'blobs/new.png', create=True)
    assert not logical.exists() and not original.exists()
    original.mkdir(); (original/storage.MARKER).write_text(json.dumps({'format':storage.FORMAT, 'id':'f'*32}))
    with pytest.raises(storage.StorageUnavailable): libraries.set_default(a['id'])
    assert not libraries.status()['libraries'][1]['available']
    assert (away/'files/artifacts'/('a'*32)/'document.docx').read_bytes() == b'document'


@pytest.mark.parametrize('name', ['../escape', 'CON', 'one/two', 'trailing.', '', '..', 'a:b'])
def test_folder_names_cannot_escape_or_use_reserved_names(libraries, tmp_path, name):
    with pytest.raises(ValueError): libraries.add(str(tmp_path), name)


def test_existing_unrelated_folders_and_overlapping_roots_are_preserved(libraries, tmp_path):
    folder = tmp_path/'Existing'; folder.mkdir(); (folder/'keep').write_text('untouched')
    with pytest.raises(ValueError, match='not an app library'): libraries.add(str(tmp_path), 'Existing')
    assert (folder/'keep').read_text() == 'untouched'
    a = add(libraries, tmp_path, 'drive-a')
    with pytest.raises(ValueError, match='overlaps'): libraries.add(a['path'], 'Nested')
    with pytest.raises(ValueError): libraries.add(str(libraries.root), 'Nested')
    with pytest.raises(ValueError): storage.confined(libraries.root/'image_workflows/../other', libraries.root/'image_workflows')


def test_readding_marked_library_recovers_files_without_original_registry(libraries, tmp_path):
    a = add(libraries, tmp_path, 'drive-a'); libraries.set_default(a['id'])
    logical = libraries.root/'generated_images/saved.png'
    libraries.path(logical, create=True).write_bytes(b'saved')
    second = storage.Libraries(tmp_path/'new-app-data')
    second.add(str(Path(a['path']).parent), Path(a['path']).name)
    assert second.path(second.root/'generated_images/saved.png').read_bytes() == b'saved'


def test_chat_blobs_imported_images_documents_and_conversions_use_library(libraries, tmp_path, monkeypatch):
    from services import image_store, image_library, image_vault, chat_documents as docs, session_store, image_conversion
    for module, field, relative in [(image_store,'BLOBS_DIR','blobs'), (image_library,'ROOT','image_library'),
            (image_vault,'ROOT','locked_images'), (docs,'ROOT','artifacts'), (image_conversion,'ROOT','artifacts/conversions'),
            (session_store,'SESSIONS_DIR','sessions'), (session_store,'TRASH_DIR','trash/sessions'), (session_store,'BACKUPS_DIR','backups/sessions')]:
        monkeypatch.setattr(module, field, libraries.root/relative)
    a = add(libraries, tmp_path, 'drive-a'); libraries.set_default(a['id'])
    data = png(); reference = image_store.put_bytes(data)
    image = image_library.import_image(data, 'fixture.png')
    session = session_store.create_session()['id']
    document = docs.create_document(docs.DocumentSpec(title='Storage test', blocks=[{'type':'paragraph','text':'Stored on the selected drive.'}]), session, {}, threading.Event())
    converted = image_conversion.convert(data, 'fixture.png', 'jpg')
    assert image_store._path_for(reference).is_relative_to(a['path'])
    assert docs.file_path(document['id'], 'document.docx').is_relative_to(a['path'])
    assert image_conversion.read(converted['id'])[1].is_relative_to(a['path'])
    libraries.set_default('primary')
    assert image_store.get_bytes(reference)[0] == data
    assert image_library.image_bytes(image['id'])[0] == data
    assert docs.read_artifact(document['id'])['title'] == 'Storage test'
    assert (libraries.root/'image_library/index.json').is_file()
    assert (libraries.root/'sessions').is_dir()


def test_new_datasets_workflows_and_character_files_stay_bound_to_their_library(libraries, tmp_path, monkeypatch):
    from services.faces import store as faces, bank
    from services.character_parts import store as parts
    from services.image_workflows import store as workflows
    from services import character_resources, image_vault
    for module, relative in [(faces,'face_datasets'), (bank,'face_bank'), (parts,'character_datasets'), (workflows,'image_workflows'), (image_vault,'locked_images')]:
        monkeypatch.setattr(module, 'ROOT', libraries.root/relative)
    a = add(libraries, tmp_path, 'drive-a'); libraries.set_default(a['id'])
    face = faces.create_dataset('Faces'); part = parts.create('Parts'); workflow = workflows.create('Workflow')
    asset = character_resources.save_asset('notes.txt', b'Character notes')
    b = add(libraries, tmp_path, 'drive-b'); libraries.set_default(b['id'])
    faces.save_source(face['id'], png(), 'source.png')
    parts.import_image(part['id'], png(), 'source.png', {'kind':'upload'})
    assert faces.dataset_dir(face['id']).is_relative_to(a['path'])
    assert parts.directory(part['id']).is_relative_to(a['path'])
    assert workflows._directory(workflow.id).is_relative_to(a['path'])
    assert character_resources.asset_path(asset['id'], 'blob').is_relative_to(a['path'])
    assert workflows.list_workflows()['workflows'][0]['id'] == workflow.id
    assert faces.list_datasets()[0]['id'] == face['id'] and parts.list_datasets()[0]['id'] == part['id']
    assert character_resources.catalog('file')[0]['id'] == asset['id']


def test_backup_includes_libraries_and_can_restore_without_external_drives(libraries, tmp_path):
    import maintenance, backup_import
    a = add(libraries, tmp_path, 'drive-a'); libraries.set_default(a['id'])
    logical = libraries.root/'generated_images/a.png'; libraries.path(logical, create=True).write_bytes(png())
    result = maintenance.export_backup(tmp_path/'backup.zip', {}, libraries.root)
    assert result['verified']
    staging = tmp_path/'restored'; staging.mkdir()
    with zipfile.ZipFile(result['archive']) as archive:
        assert 'data/generated_images/a.png' in archive.namelist()
        assert 'data/storage/libraries.sqlite3' not in archive.namelist()
        payload = archive.read('data/generated_images/a.png')
        assert hashlib.sha256(payload).digest() == hashlib.sha256(png()).digest()
    # Exercise the production validation and staging path, not an unchecked extract.
    backup_import.validate_backup(result['archive'], root=staging, staging=staging)
    restored = storage.Libraries(staging)
    assert restored.path(staging/'generated_images/a.png').read_bytes() == png()
    assert restored.status()['default_id'] == 'primary'
    Path(a['path']).rename(Path(a['path']).with_name('Disconnected'))
    with pytest.raises(storage.StorageUnavailable): maintenance.export_backup(tmp_path/'incomplete.zip', {}, libraries.root)
    assert not (tmp_path/'incomplete.zip').exists()


def test_routes_require_explicit_add_and_default_actions(libraries, tmp_path):
    app = FastAPI(); app.include_router(router); client = TestClient(app)
    assert len(client.get('/storage-libraries').json()['libraries']) == 1
    assert not libraries.root.exists()
    assert client.post('/storage-libraries', json={'parent':'relative'}).status_code == 400
    result = client.post('/storage-libraries', json={'parent':str(tmp_path), 'name':'Selected library'})
    assert result.status_code == 201
    library = result.json()
    assert client.put(f"/storage-libraries/default/{library['id']}").status_code == 200
    assert client.post('/storage-libraries/export-folder/images').json()['folder'].startswith(library['path'])
    assert client.post('/storage-libraries/export-folder/unsupported').status_code == 409


def test_storage_routes_obey_session_guard_without_creating_folders(libraries, tmp_path, monkeypatch):
    from services.session_guard import SessionGuard
    monkeypatch.setenv('LAW_SESSION_TOKEN', 'storage-test-token')
    app = FastAPI(); app.include_router(router); app.add_middleware(SessionGuard)
    client = TestClient(app, base_url='http://127.0.0.1:8000')
    assert client.post('/storage-libraries', json={'parent':str(tmp_path)}).status_code == 403
    assert client.put('/storage-libraries/default/primary').status_code == 403
    assert not libraries.root.exists()
    assert client.get('/storage-libraries', headers={'X-LAW-Session':'storage-test-token'}).status_code == 200


def test_invalid_marker_is_reported_unavailable_and_http_handler_preserves_detail(libraries, tmp_path):
    from main import storage_unavailable
    a = add(libraries, tmp_path, 'drive-a'); libraries.set_default(a['id'])
    (Path(a['path'])/storage.MARKER).write_text('[]')
    assert not libraries.status()['libraries'][1]['available']
    app = FastAPI(); app.add_exception_handler(storage.StorageUnavailable, storage_unavailable)
    @app.get('/write')
    def write():
        return libraries.path(libraries.root/'generated_images/new.png', create=True)
    response = TestClient(app).get('/write')
    assert response.status_code == 503 and 'Reconnect' in response.json()['detail']
    assert not (libraries.root/'generated_images').exists()
