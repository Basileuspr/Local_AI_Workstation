"""Optional ties from face/parts/LoRA workspaces to Character Creator profiles."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import character_resources as resources
from services.faces import bank, store as faces
from services.character_parts import store as parts


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(bank, 'ROOT', tmp_path/'bank')
    monkeypatch.setattr(faces, 'ROOT', tmp_path/'faces')
    monkeypatch.setattr(parts, 'ROOT', tmp_path/'parts')


def test_face_datasets_link_like_other_workspace_resources():
    profile = bank.create_character('A')
    dataset = faces.create_dataset('Portraits')
    assert resources.catalog('face_dataset') == [{'id': dataset['id'], 'name': 'Portraits'}]
    link = resources.add(profile['id'], 'face_dataset', dataset['id'], 'Main set')
    assert resources.add(profile['id'], 'face_dataset', dataset['id'], 'other') == link
    item = resources.list_resources(profile['id'])[0]
    assert item['available'] and item['resource']['name'] == 'Portraits'
    with pytest.raises(ValueError):
        resources.add(profile['id'], 'face_dataset', 'f' * 32)


def test_tied_characters_are_listed_by_name_and_survive_a_removed_source():
    beta = bank.create_character('Beta'); alpha = bank.create_character('alpha'); bank.create_character('Unrelated')
    dataset = faces.create_dataset('Portraits')
    link = resources.add(beta['id'], 'face_dataset', dataset['id'], 'Main set')
    resources.add(alpha['id'], 'face_dataset', dataset['id'])
    tied = resources.linked_characters('face_dataset', dataset['id'])
    assert [item['name'] for item in tied] == ['alpha', 'Beta']
    assert tied[1] == {'character_id': beta['id'], 'name': 'Beta', 'link_id': link['id'], 'note': 'Main set'}
    faces.delete_dataset(dataset['id'])
    # The source is gone, but the ties remain visible so they can be untied.
    assert len(resources.linked_characters('face_dataset', dataset['id'])) == 2
    resources.unlink(beta['id'], link['id'])
    assert [item['name'] for item in resources.linked_characters('face_dataset', dataset['id'])] == ['alpha']
    assert resources.linked_characters('parts', dataset['id']) == []
    with pytest.raises(ValueError):
        resources.linked_characters('shell', 'x')


def test_link_lookup_route():
    from routes import faces as faces_routes
    app = FastAPI(); app.include_router(faces_routes.router)
    dataset = parts.create('Hands')
    with TestClient(app) as client:
        assert client.get(f"/faces/character-resources/links/parts/{dataset['id']}").json() == {'characters': []}
        created = client.post('/faces/characters', json={'name': 'Test'}).json()
        tie = client.post(f"/faces/characters/{created['id']}/resources", json={'kind': 'parts', 'target_id': dataset['id']})
        assert tie.status_code == 201
        body = client.get(f"/faces/character-resources/links/parts/{dataset['id']}").json()
        assert [item['character_id'] for item in body['characters']] == [created['id']]
        assert client.get('/faces/character-resources/links/shell/x').status_code == 400
        assert client.get('/faces/character-resources/links/parts/' + 'a' * 129).status_code == 422
