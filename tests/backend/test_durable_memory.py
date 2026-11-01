import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from services import memory_store as store
from routes.memory import router


@pytest.fixture
def database(tmp_path, monkeypatch):
    path = tmp_path / 'memory.db'
    engine = create_engine(f'sqlite:///{path.as_posix()}', connect_args={'check_same_thread': False})
    monkeypatch.setattr(store, 'DATABASE_PATH', path)
    monkeypatch.setattr(store, 'engine', engine)
    monkeypatch.setattr(store, 'SessionLocal', sessionmaker(bind=engine, expire_on_commit=False))
    yield engine
    engine.dispose()


@pytest.fixture
def client(database):
    store.initialize_database()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def save(client, **fields):
    response = client.post('/memory', json={'username': 'local-user', 'memory_text': 'Use metric units.', **fields})
    assert response.status_code == 200, response.text
    return response.json()['memory']


def test_existing_database_upgrade_preserves_text_and_is_repeatable(database):
    with database.begin() as connection:
        connection.execute(text('CREATE TABLE memories (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, project_id INTEGER, session_id VARCHAR(36), memory_type VARCHAR(100), memory_text TEXT, importance INTEGER, created_at DATETIME, updated_at DATETIME)'))
        connection.execute(text("INSERT INTO memories VALUES (7, 2, NULL, NULL, 'preference', 'Keep this existing fact.', 4, '2026-01-01 00:00:00', '2026-01-01 00:00:00')"))
    store.initialize_database()
    store.initialize_database()
    memory = store.list_memories(2)[0]
    assert memory.memory_text == 'Keep this existing fact.'
    assert memory.id == 7 and memory.importance == 4 and memory.version == 1 and memory.is_active
    assert store.get_relevant_memories(2)[0].id == 7


def test_create_edit_pause_resume_delete_and_candidates(client):
    memory = save(client, project_name='Recipes')
    listing = client.get('/memory?username=local-user').json()
    assert listing['memories'][0]['project_name'] == 'Recipes'
    assert listing['candidate_ids'] == [memory['id']]
    user = store.get_user_by_username('local-user')
    url = f"/memory/{memory['id']}?username=local-user"
    changed = client.patch(url, json={'version': 1, 'memory_text': 'Use grams in recipes.', 'memory_type': 'Cooking', 'importance': 5, 'is_active': False}).json()['memory']
    assert changed['version'] == 2 and changed['project_id'] == memory['project_id']
    assert changed['created_at'] == memory['created_at']
    assert store.get_relevant_memories(user.id) == []
    assert client.get('/memory?username=local-user').json()['candidate_ids'] == []
    assert client.get('/memory?username=local-user').json()['count'] == 1
    resumed = client.patch(url, json={'version': 2, 'is_active': True}).json()['memory']
    assert resumed['version'] == 3
    assert store.get_relevant_memories(user.id)[0].memory_text == 'Use grams in recipes.'
    assert client.delete(url + '&version=3').status_code == 200
    assert client.get('/memory?username=local-user').json()['count'] == 0


def test_versions_prevent_lost_edits_and_deletes(client):
    memory = save(client)
    url = f"/memory/{memory['id']}?username=local-user"
    assert client.patch(url, json={'version': 1, 'importance': 5}).status_code == 200
    assert client.patch(url, json={'version': 1, 'memory_text': 'Stale overwrite'}).status_code == 409
    assert client.delete(url + '&version=1').status_code == 409
    assert client.get('/memory?username=local-user').json()['memories'][0]['memory_text'] == memory['memory_text']


def test_ownership_and_field_boundaries(client):
    memory = save(client)
    save(client, username='other-user', memory_text='Separate user')
    url = f"/memory/{memory['id']}?username=other-user"
    assert client.patch(url, json={'version': 1, 'memory_text': 'Wrong owner'}).status_code == 404
    assert client.delete(url + '&version=1').status_code == 404
    assert client.get('/memory?username=unknown').json()['memories'] == []
    url = f"/memory/{memory['id']}?username=local-user"
    for changes in ({'memory_text': '  '}, {'memory_text': None}, {'memory_type': ''}, {'importance': 6}, {'is_active': None}, {'user_id': 2}, {'project_id': 2}, {'session_id': 'moved'}):
        assert client.patch(url, json={'version': 1, **changes}).status_code == 422
    assert client.patch(url, json={'version': 1}).status_code == 400
    assert client.delete(url).status_code == 422


@pytest.mark.parametrize('changes', [{'username': ' '}, {'memory_text': ' '}, {'memory_text': 'x' * 8001}, {'memory_type': 'x' * 101}, {'importance': 0}])
def test_create_rejects_invalid_fields(client, changes):
    assert client.post('/memory', json={'username': 'local-user', 'memory_text': 'A fact', **changes}).status_code == 422


def test_ranking_project_selection_and_transcripts_unchanged(client):
    user = store.create_user_if_missing('local-user')
    project = store.create_project_if_missing(user.id, 'Selected project')
    other = store.create_project_if_missing(user.id, 'Other project')
    session = store.create_session(user.id, project.id)
    store.save_message(session.id, 'user', 'A retained transcript')
    for index in range(12):
        save(client, memory_text=f'General {index}', importance=2)
    save(client, memory_text='Paused high priority', importance=5, is_active=False)
    selected = save(client, memory_text='Selected project', project_name=project.name, importance=5)
    foreign = save(client, memory_text='Other project', project_name=other.name, importance=5)
    memories = store.get_relevant_memories(user.id, project.id)
    assert len(memories) == 10 and memories[0].id == selected['id']
    assert foreign['id'] not in [memory.id for memory in memories]
    assert all(memory.is_active for memory in memories)
    listing = client.get('/memory?username=local-user').json()
    assert listing['candidate_ids'] == [memory.id for memory in store.get_relevant_memories(user.id)]
    assert client.delete(f"/memory/{selected['id']}?username=local-user&version=1").status_code == 200
    with store.SessionLocal() as db:
        assert db.query(store.Message).one().content == 'A retained transcript'
        assert db.get(store.ChatSession, session.id)


def test_memory_management_uses_application_authentication(client):
    import main
    from conftest import API_BASE_URL, AUTH_HEADERS
    memory = save(client)
    application = TestClient(main.app, base_url=API_BASE_URL)
    url = f"/memory/{memory['id']}?username=local-user"
    assert application.get('/memory?username=local-user').status_code == 403
    assert application.patch(url, json={'version': 1, 'is_active': False}).status_code == 403
    assert application.delete(url + '&version=1').status_code == 403
    assert application.get('/memory?username=local-user', headers=AUTH_HEADERS).json()['count'] == 1
