from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.sessions import router
from services import session_store as store


@pytest.fixture
def client(sessions_dir):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as connection:
        yield connection


def seed():
    return store.append_messages(store.create_session()['id'], [
        {'id': 'message-a', 'role': 'assistant', 'content': 'Keep this answer',
         'artifacts': [{'id': 'keep-artifact'}]},
        {'id': 'message-b', 'role': 'user', 'content': 'Follow-up'},
    ])


def pin(client, session, value=True, message='message-a'):
    return client.patch(f"/sessions/{session['id']}/messages/{message}/pin", json={'pinned': value})


def test_pin_survives_reload_and_unpins_without_content_changes(client):
    session = seed()
    result = pin(client, session)
    assert result.status_code == 200
    assert result.json()['previous_revision'] == session['revision']
    saved = store.get_session(session['id'])
    assert saved['messages'][0] == {**session['messages'][0], 'pinned': True}
    assert saved['messages'][1] == session['messages'][1]
    assert saved['revision'] != session['revision']
    revision = saved['revision']
    assert pin(client, session).json()['revision'] == revision
    assert pin(client, session, False).status_code == 200
    assert store.get_session(session['id'])['messages'][0]['pinned'] is False


def test_pin_preserves_concurrent_append_rename_and_summary(client):
    session = seed()
    store.update_session_metadata(session['id'], memory_summary='continuity', summarized_message_count=1,
                                  expected_revision=session['revision'])
    with ThreadPoolExecutor(max_workers=3) as pool:
        actions = [pool.submit(pin, client, session),
                   pool.submit(store.append_messages, session['id'], [{'id': 'new', 'role': 'user', 'content': 'new turn'}]),
                   pool.submit(store.update_session_metadata, session['id'], title='Kept title')]
        for action in actions:
            assert action.result() is not None
    saved = store.get_session(session['id'])
    assert saved['messages'][0]['pinned'] is True
    assert [item['id'] for item in saved['messages']] == ['message-a', 'message-b', 'new']
    assert saved['title'] == 'Kept title'
    assert saved['memory_summary'] == 'continuity'
    assert saved['summarized_message_count'] == 1


def test_older_whole_chat_clients_cannot_erase_pin_flags(client):
    original = seed()
    pin(client, original)
    saved = store.get_session(original['id'])
    updated = store.update_session(original['id'], original['messages'], expected_revision=saved['revision'])
    assert updated['messages'][0]['pinned'] is True


@pytest.mark.parametrize('body', [{'pinned': 'true'}, {'pinned': 1}, {'pinned': True, 'content': 'overwrite'}, {}])
def test_pin_requires_narrow_boolean_request(client, body):
    session = seed()
    result = client.patch(f"/sessions/{session['id']}/messages/message-a/pin", json=body)
    assert result.status_code == 422
    assert store.get_session(session['id'])['revision'] == session['revision']


def test_unknown_messages_and_sessions_are_reported(client):
    session = seed()
    assert pin(client, session, message='missing').status_code == 404
    assert client.patch('/sessions/missing/messages/message-a/pin', json={'pinned': True}).status_code == 404
