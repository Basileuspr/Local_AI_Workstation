import io
import json
from pathlib import Path
import uuid

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from services import image_library, image_store, image_vault
from services.faces import bank
from mobile_companion.mobile_api import create_mobile_api
from mobile_companion.mobile_companion import MobileCompanion

ORIGIN = 'https://desktop.example.ts.net'
HEADERS = {'Origin': ORIGIN, 'X-LAW-Mobile': '1'}


@pytest.fixture
def phone(tmp_path, monkeypatch, sessions_dir):
    monkeypatch.setattr(bank, 'ROOT', tmp_path / 'characters')
    monkeypatch.setattr(image_library, 'ROOT', tmp_path / 'images')
    monkeypatch.setattr(image_store, 'BLOBS_DIR', tmp_path / 'blobs')
    monkeypatch.setattr(image_vault, 'ROOT', tmp_path / 'vault')
    assets = tmp_path / 'assets'
    assets.mkdir()
    service = MobileCompanion(tmp_path / 'mobile', 'http://127.0.0.1:8000', 'test-session-token', assets)
    with TestClient(create_mobile_api(service.jobs, service.access, ORIGIN, assets), base_url=ORIGIN) as client:
        invitation = service.access.invitation()
        assert client.post('/api/pair', json={'code': invitation['code'], 'name': 'Test phone'}, headers=HEADERS).status_code == 200
        yield client


def png(color='green'):
    stream = io.BytesIO()
    Image.new('RGB', (8, 8), color).save(stream, 'PNG')
    return stream.getvalue()


def test_phone_profiles_persist_in_desktop_store_and_preserve_manual_fields(phone):
    body = {'name': '  Rowan  ', 'bio': 'An explorer', 'notes': 'Keep these notes', 'tags': ['green', 'Tall, strong']}
    response = phone.post('/api/characters', json=body, headers=HEADERS)
    assert response.status_code == 201
    created = response.json()
    raw = bank._read(created['id'])
    raw['manual_extra'] = {'keep': True}
    raw['resources'] = [{'id': uuid.uuid4().hex, 'kind': 'lora_adapter', 'target_id': 'private-model', 'note': 'private-adapter'}]
    bank._write(raw)
    current = phone.get('/api/characters/' + created['id']).json()
    assert 'lora' not in json.dumps(current).lower() and 'private-' not in json.dumps(current)
    renamed = phone.patch('/api/characters/' + created['id'], json={'name': 'Rowan II', 'expected_revision': current['revision']}, headers=HEADERS)
    assert renamed.status_code == 200
    saved = json.loads(bank._path(created['id']).read_text(encoding='utf-8'))
    assert saved['name'] == 'Rowan II' and saved['bio'] == body['bio'] and saved['notes'] == body['notes']
    assert saved['tags'] == body['tags'] and saved['manual_extra'] == {'keep': True}
    assert saved['resources'] == raw['resources']
    assert phone.get('/api/characters?search=rowan').json()['characters'][0]['name'] == 'Rowan II'
    assert phone.get('/api/characters/' + created['id']).json()['bio'] == 'An explorer'
    assert set(current) == {'id', 'name', 'bio', 'notes', 'tags', 'created_at', 'updated_at', 'revision', 'images'}


def test_stale_phone_profile_cannot_overwrite_desktop_edits(phone):
    created = phone.post('/api/characters', json={'name': 'A'}, headers=HEADERS).json()
    bank.update_character(created['id'], notes='Desktop edit')
    response = phone.patch('/api/characters/' + created['id'], json={
        'name': 'A', 'notes': 'Stale draft', 'expected_revision': created['revision']}, headers=HEADERS)
    assert response.status_code == 409 and bank._read(created['id'])['notes'] == 'Desktop edit'
    assert 'draft is kept' in response.json()['detail']
    bank.delete_character(created['id'])
    assert phone.patch('/api/characters/' + created['id'], json={'name': 'A', 'expected_revision': created['revision']}, headers=HEADERS).status_code == 404
    assert not bank._path(created['id']).exists()


@pytest.mark.parametrize('body', [
    {'name': ' '}, {'name': 'x' * 121}, {'name': 'A', 'bio': 'x' * 20001},
    {'name': 'A', 'tags': ['x' * 61]}, {'name': 'A', 'tags': [str(i) for i in range(41)]},
    {'name': 'A', 'dataset_id': '../private'}, {'name': 'A', 'lora_id': 'anything'},
    {'name': 'A', 'resources': []},
])
def test_profile_input_is_bounded_and_rejects_training_and_path_arguments(phone, body):
    assert phone.post('/api/characters', json=body, headers=HEADERS).status_code == 422
    assert bank.list_characters() == []


def test_image_links_are_idempotent_reauthorized_and_preserve_originals(phone, monkeypatch):
    data = png()
    image = image_library.import_image(data, 'Reference.png', origin={'kind': 'generated'})
    original = Path(image['path'])
    created = phone.post('/api/characters', json={'name': 'Reference owner'}, headers=HEADERS).json()
    path = '/api/characters/' + created['id'] + '/images'
    catalog = phone.get('/api/characters/images').json()
    assert catalog['total'] == 1 and set(catalog['images'][0]) == {'id', 'name', 'url'}
    linked = phone.post(path, json={'image_id': image['id']}, headers=HEADERS).json()
    assert len(linked['images']) == 1
    link_id = linked['images'][0]['id']
    assert phone.post(path, json={'image_id': image['id']}, headers=HEADERS).json()['images'][0]['id'] == link_id
    assert len(bank._read(created['id'])['resources']) == 1
    image_library.edit_image(image['id'], hidden=True)
    assert phone.get('/api/characters/images').json()['total'] == 0
    hidden = phone.get('/api/characters/' + created['id']).json()['images'][0]
    assert hidden == {'id': link_id, 'available': False, 'name': 'Unavailable image reference'}
    assert phone.post(path, json={'image_id': image['id']}, headers=HEADERS).status_code == 404
    assert phone.get('/api/media/library/' + image['id']).status_code == 404
    image_library.edit_image(image['id'], hidden=False)
    with monkeypatch.context() as context:
        context.setattr(image_vault, 'is_locked', lambda _digest: True)
        assert phone.get('/api/characters/images').json()['total'] == 0
        assert phone.get('/api/media/library/' + image['id']).status_code == 404
        assert not phone.get('/api/characters/' + created['id']).json()['images'][0]['available']
    assert phone.delete(path + '/' + link_id, headers=HEADERS).status_code == 200
    assert bank._read(created['id'])['resources'] == [] and original.read_bytes() == data


def test_reference_and_character_routes_require_pairing_and_origin(phone):
    character = phone.post('/api/characters', json={'name': 'Private'}, headers=HEADERS).json()
    assert phone.patch('/api/characters/' + character['id'], json={'name': 'X', 'expected_revision': character['revision']}).status_code == 403
    assert phone.post('/api/characters/' + character['id'] + '/images', json={'image_id': '../outside'}, headers=HEADERS).status_code == 422
    assert phone.get('/api/characters?limit=49').status_code == 422
    assert phone.get('/api/characters/images?limit=49').status_code == 422
    phone.cookies.clear()
    assert phone.get('/api/characters').status_code == 401
    assert phone.get('/api/characters/' + character['id']).status_code == 401


def test_review_only_and_missing_images_are_not_link_candidates(phone):
    image_library.import_image(png(), 'Review.png')
    image = image_library.import_image(png('blue'), 'Missing.png', origin={'kind': 'generated'})
    Path(image['path']).unlink()
    assert phone.get('/api/characters/images').json()['images'] == []
