import hashlib
import io
import zipfile

import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.image_library import router
from services import image_library as library, image_vault as vault
from services.image_workflows import store


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(library, 'ROOT', tmp_path / 'library')
    monkeypatch.setattr(vault, 'ROOT', tmp_path / 'vault')
    monkeypatch.setattr(store, 'ROOT', tmp_path / 'workflows')
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client: yield client
    vault.TOKENS.clear()


def test_large_upload_filing_export_and_workflow_copy_preserve_original(isolated, tmp_path, monkeypatch):
    path = tmp_path / 'large.png'
    with Image.new('RGB', (5000, 5000), '#3876bc') as image:
        image.save(path, 'PNG', compress_level=0)
    assert path.stat().st_size > 64 * 1024 * 1024
    with path.open('rb') as stream: digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    with path.open('rb') as stream:
        response = isolated.post('/image-library/upload', files={'files': ('large.png', stream, 'image/png')})
    assert response.status_code == 200 and not response.json()['errors']
    item = response.json()['images'][0]
    assert (item['width'], item['height'], item['sha256']) == (5000, 5000, digest)
    assert isolated.head(item['url']).headers['x-law-sha256'] == digest
    preview = isolated.get(item['url'] + '?thumbnail=true')
    assert preview.status_code == 200
    with Image.open(io.BytesIO(preview.content)) as image: assert max(image.size) <= 320
    folder = library.folder('Large originals')
    # Filing and export must never re-read a full file into a bytes object.
    monkeypatch.setattr(library, 'image_bytes', lambda *_: pytest.fail('Whole-image allocation'))
    filed = isolated.post('/image-library/import', json={'kind': 'library', 'id': item['id'], 'folder_id': folder['id']})
    assert filed.status_code == 200 and filed.json()['id'] == item['id']
    assert folder['id'] in filed.json()['folder_ids']
    archive = isolated.post('/image-library/export', json={'ids': [item['id']]})
    assert archive.status_code == 200
    assert len(archive.content) == int(archive.headers['content-length'])
    assert hashlib.sha256(archive.content).hexdigest() == archive.headers['x-law-sha256']
    with zipfile.ZipFile(io.BytesIO(archive.content)) as output:
        with output.open('images/0001-large.png') as stream: assert hashlib.file_digest(stream, 'sha256').hexdigest() == digest
    workflow = store.create('Large reference')
    from services.image_workflows.scene_analysis import ImportSourceRequest, import_source
    copied = import_source(workflow.id, ImportSourceRequest(revision=workflow.revision, source={'kind': 'library', 'id': item['id']}))
    assert copied.assets[0].id == digest and copied.assets[0].width == 5000
    from services.image_thumbnails import path_response
    stored, _ = store.asset_path(workflow.id, digest)
    with Image.open(io.BytesIO(path_response(stored).body)) as image: assert max(image.size) <= 320
    assert len(library.read_index()['images']) == 1


def test_stream_import_reads_in_chunks_and_rejects_corrupt_inputs_without_records(isolated):
    output = io.BytesIO()
    with Image.new('RGB', (16, 16)) as image: image.save(output, 'PNG')
    class Chunked(io.BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 1024 * 1024
            return super().read(size)
    assert library.import_stream(Chunked(output.getvalue()), 'image.png')['width'] == 16
    before = library.read_index()
    response = isolated.post('/image-library/upload', files={'files': ('broken.png', b'broken', 'image/png')})
    assert response.status_code == 200 and len(response.json()['errors']) == 1
    assert library.read_index() == before


def test_location_and_download_deny_locked_or_changed_content(isolated):
    output = io.BytesIO()
    with Image.new('RGB', (16, 16)) as image: image.save(output, 'PNG')
    item = library.import_image(output.getvalue(), 'image.png')
    assert isolated.get(f"/image-library/images/{item['id']}/location").status_code == 200
    access = vault.setup('12345678')
    vault.add(access['token'], output.getvalue(), 'private.png')
    assert isolated.head(item['url']).status_code == 403
    assert isolated.get(f"/image-library/images/{item['id']}/location").status_code == 403


def test_vault_metadata_inspection_never_writes_decrypted_bytes(isolated, monkeypatch):
    output = io.BytesIO()
    with Image.new('RGB', (16, 16)) as image: image.save(output, 'PNG')
    monkeypatch.setattr(library.tempfile, 'TemporaryDirectory', lambda **_: pytest.fail('Private bytes spilled to disk'))
    assert library.inspect(output.getvalue(), 'private.png')['width'] == 16


def test_workflow_upload_does_not_follow_an_assets_directory_link(isolated, tmp_path):
    workflow = store.create('Confined upload')
    outside = tmp_path / 'outside'; outside.mkdir()
    directory = store._directory(workflow.id) / 'assets'
    if directory.exists(): directory.rmdir()
    try: directory.symlink_to(outside, target_is_directory=True)
    except OSError: pytest.skip('Directory symlinks unavailable on this host')
    with pytest.raises(ValueError): store.add_asset_stream(workflow.id, workflow.revision, 'image.png', io.BytesIO(b'private'))
    assert not list(outside.iterdir())
