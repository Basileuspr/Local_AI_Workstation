"""Gallery stitches use temporary storage and verify pixels, ownership and failures."""
import base64
import io
import hashlib
import random
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from routes.image_library import router
from services import image_library as library, image_stitcher, image_vault as vault, image_store, session_store
from services.image_workflows import store, runner
from services.image_workflows.contracts import UpdateRequest, RunRecord


@pytest.fixture
def client(tmp_path, monkeypatch, sessions_dir):
    monkeypatch.setattr(library, 'ROOT', tmp_path / 'library')
    monkeypatch.setattr(vault, 'ROOT', tmp_path / 'vault')
    monkeypatch.setattr(image_store, 'BLOBS_DIR', tmp_path / 'blobs')
    monkeypatch.setattr(store, 'ROOT', tmp_path / 'workflows')
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client
    vault.TOKENS.clear()


def picture(color, size=(24, 16), *, orientation=None):
    stream = io.BytesIO()
    with Image.new('RGBA', size, color) as image:
        if orientation:
            exif = Image.Exif(); exif[274] = orientation
            image.save(stream, 'PNG', exif=exif)
        else:
            image.save(stream, 'PNG')
    return stream.getvalue()


def source(color='red', size=(24, 16), **kwargs):
    image = library.import_image(picture(color, size, **kwargs), 'frame.png', {'kind': 'fixture'})
    return {'kind': 'library', 'id': image['id']}


@pytest.mark.parametrize('layout,size,centers', [
    ('row', (48, 16), [(12, 8), (36, 8)]),
    ('column', (24, 32), [(12, 8), (12, 24)]),
    ('grid', (48, 16), [(12, 8), (36, 8)]),
])
def test_exact_pick_order_preview_matches_saved_and_originals_unchanged(client, layout, size, centers):
    red, green, blue = source(), source('green'), source('blue')
    before = library.read_index()
    originals = {item['id']: library.image_bytes(item['id'])[0] for item in before['images']}
    body = {'sources': [blue, red], 'layout': layout, 'columns': 2}
    preview = client.post('/image-library/stitch/preview', json=body)
    assert preview.status_code == 200, preview.text
    assert preview.headers['cache-control'] == 'no-store'
    assert library.read_index() == before
    png = base64.b64decode(preview.json()['preview'].split(',')[1])
    saved = client.post('/image-library/stitch', json=body)
    assert saved.status_code == 200, saved.text
    item = saved.json()
    assert item['origin']['sources'] == [blue, red] and not item['review_only']
    assert item['origin']['kind'] == 'stitch'
    assert client.get(item['url']).content == png
    with Image.open(io.BytesIO(png)) as image:
        assert image.size == size
        assert [image.getpixel(point) for point in centers] == [(0, 0, 255, 255), (255, 0, 0, 255)]
        assert not image.info  # No private IDs, prompts, or names in downloaded PNG metadata.
    for original in before['images']:
        assert library.image_bytes(original['id']) == (originals[original['id']], original)
    assert client.post('/image-library/stitch', json=body).json()['id'] == item['id']


def test_mixed_aspect_transparency_spacing_and_exif_orientation(client):
    wide = source('red', (20, 10))
    rotated = source('blue', (20, 10), orientation=6)
    body = {'sources': [wide, rotated], 'gap': 4, 'background': 'transparent'}
    saved = client.post('/image-library/stitch', json=body).json()
    with Image.open(io.BytesIO(client.get(saved['url']).content)) as image:
        assert image.size == (44, 20)
        assert image.getpixel((0, 0))[3] == 0
        assert image.getpixel((10, 10)) == (255, 0, 0, 255)
        assert image.getpixel((34, 0)) == (0, 0, 255, 255)
        assert image.getpixel((25, 10))[3] == 0
        assert image.getpixel((22, 10))[3] == 0


def test_fits_large_strip_and_grid_without_dropping_frames(client):
    frame = source('red', (64, 64))
    # 64 sources at maximum spacing and size are still bounded by shared layout rules.
    large = source('blue', (2048, 2048))
    response = client.post('/image-library/stitch/preview', json={'sources': [large] * 64, 'tile_size': 2048})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['reduced'] and result['columns'] == 64
    assert result['width'] <= 16384 and result['width'] * result['height'] <= library.MAX_PIXELS
    result = client.post('/image-library/stitch/preview', json={'sources': [frame] * 3, 'layout': 'grid', 'columns': 2, 'gap': 4}).json()
    assert (result['width'], result['height'], result['rows']) == (132, 132, 2)


def test_session_source_uses_owned_bytes_and_retains_chat(client):
    reference = image_store.put_bytes(picture('red'))
    session = session_store.create_session('Fixture')
    session_store.append_messages(session['id'], [{'id': 'msg', 'role': 'assistant', 'content': '',
        'generatedImages': [{'id': 'frame', 'name': 'frame.png', 'src': reference}]}])
    before = session_store.get_session(session['id'])
    session_source = {'kind': 'session', 'session_id': session['id'], 'message_id': 'msg', 'image_id': 'frame'}
    response = client.post('/image-library/stitch', json={'sources': [session_source, source('blue')]})
    assert response.status_code == 200, response.text
    assert session_store.get_session(session['id']) == before


def test_workflow_outputs_can_be_picked_across_runs(client):
    frames = []
    for color in ('red', 'blue'):
        workflow = store.create('Scene fixture')
        stage_id, output_id = uuid.uuid4().hex, uuid.uuid4().hex
        workflow = store.update(workflow.id, UpdateRequest(revision=workflow.revision, name=workflow.name,
            stages=[{'id': stage_id, 'operation': 'upscale'}]))
        job = store.prepare(workflow.id, workflow.revision)
        data = picture(color)
        filename = f'outputs/{stage_id}/{output_id}.png'
        store._atomic_bytes(runner._job_dir(workflow.id, job['id']) / filename, data)
        record = RunRecord(id=job['id'], workflow_id=workflow.id, request_id=job['id'],
            created_at=store._now(), updated_at=store._now(), status='completed', seed=42, stage_count=1,
            outputs=[{'id': output_id, 'stage_id': stage_id, 'filename': filename,
                      'sha256': hashlib.sha256(data).hexdigest(), 'width': 24, 'height': 16}])
        store._write(runner._job_dir(workflow.id, job['id']) / 'run.json', record.model_dump())
        frames.append({'kind': 'workflow', 'workflow_id': workflow.id, 'job_id': job['id'], 'output_id': output_id})
    response = client.post('/image-library/stitch', json={'sources': frames})
    assert response.status_code == 200, response.text
    with Image.open(io.BytesIO(client.get(response.json()['url']).content)) as image:
        assert image.getpixel((12, 8)) == (255, 0, 0, 255)
        assert image.getpixel((36, 8)) == (0, 0, 255, 255)


def test_oversized_encoded_output_rejects_save_without_a_partial_copy(client, monkeypatch):
    frames = []
    for seed in (1, 2):
        with Image.frombytes('RGB', (24, 16), random.Random(seed).randbytes(24 * 16 * 3)) as image:
            buffer = io.BytesIO(); image.save(buffer, 'PNG')
        item = library.import_image(buffer.getvalue(), 'noise.png', {'kind': 'fixture'})
        frames.append({'kind': 'library', 'id': item['id']})
    before = library.read_index()
    monkeypatch.setattr(library, 'MAX_BYTES', 1500)
    response = client.post('/image-library/stitch', json={'sources': frames})
    assert response.status_code == 422 and 'Reduce Frame size' in response.text
    assert library.read_index() == before


def test_missing_changed_and_locked_frames_fail_without_partial_save(client):
    first, second = source(), source('blue')
    before = library.read_index()
    body = {'sources': [first, {'kind': 'library', 'id': '0' * 32}]}
    response = client.post('/image-library/stitch', json=body)
    assert response.status_code == 422 and 'Frame 2' in response.json()['detail']
    image = library.image_bytes(second['id'])[1]
    path = library.image_path(image)
    path.write_bytes(picture('green'))
    response = client.post('/image-library/stitch', json={'sources': [first, second]})
    assert response.status_code == 422 and 'changed' in response.text
    path.write_bytes(picture('blue'))
    token = vault.setup('12345678')['token']
    vault.add(token, picture('blue'), 'private.png')
    for endpoint in ('/stitch', '/stitch/preview'):
        assert client.post('/image-library' + endpoint, json={'sources': [first, second]}).status_code == 403
    assert library.read_index() == before


@pytest.mark.parametrize('override', [
    {'sources': []}, {'sources': [{'kind': 'library', 'id': '0' * 32}] * 65},
    {'layout': 'unknown'}, {'columns': -1}, {'columns': 2.5}, {'gap': 65},
    {'tile_size': 4096}, {'background': 'url(http://example.com)'}, {'path': '../private'},
])
def test_invalid_requests_are_rejected_before_reading_images(client, override):
    response = client.post('/image-library/stitch', json={'sources': [source(), source('blue')], **override})
    assert response.status_code == 422


def test_budget_and_missing_workflow_errors_preserve_storage(client, monkeypatch):
    before = library.read_index()
    response = client.post('/image-library/stitch', json={'sources': [
        {'kind': 'workflow', 'workflow_id': '0' * 32, 'job_id': '1' * 32, 'output_id': '2' * 32}] * 2})
    assert response.status_code == 422 and 'Frame 1' in response.text
    assert library.read_index() == before
    frames = [source(), source('blue')]
    before = library.read_index()
    monkeypatch.setattr(image_stitcher, 'MAX_SOURCE_BYTES', 1)
    assert client.post('/image-library/stitch', json={'sources': frames}).status_code == 422
    assert library.read_index() == before
