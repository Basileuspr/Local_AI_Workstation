import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.sessions import router
from services import session_store as store


def message(identity, content=None):
    return {"id": identity, "role": "user", "content": content or identity}


@pytest.fixture
def client(sessions_dir):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


def test_two_clients_reject_stale_replacement_and_keep_both_appends(client, sessions_dir):
    initial = client.post('/sessions/new', json={}).json()
    url = '/sessions/' + initial['id']
    left = client.get(url).json()
    right = client.get(url).json()
    first = client.put(url, json={"messages": [message('left')], "expected_revision": left['revision']})
    assert first.status_code == 200
    before = (sessions_dir / (initial['id'] + '.json')).read_bytes()
    stale = client.put(url, json={"messages": [message('right')], "expected_revision": right['revision']})
    assert stale.status_code == 409
    assert stale.json()['detail']['code'] == 'session_conflict'
    assert stale.json()['detail']['current_revision'] == first.json()['revision']
    assert (sessions_dir / (initial['id'] + '.json')).read_bytes() == before
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda value: client.post(url + '/messages/append', json={"messages": [message(value)]}), ['a', 'b']))
    assert all(response.status_code == 200 for response in responses)
    assert {item['id'] for item in client.get(url).json()['messages']} == {'left', 'a', 'b'}


def test_old_clients_cannot_replace_without_revision(client, sessions_dir):
    session = store.create_session()
    before = (sessions_dir / (session['id'] + '.json')).read_bytes()
    response = client.put('/sessions/' + session['id'], json={"messages": []})
    assert response.status_code == 428
    assert response.json()['detail']['code'] == 'session_revision_required'
    assert (sessions_dir / (session['id'] + '.json')).read_bytes() == before
    with pytest.raises(store.SessionConflict):
        store.update_session(session['id'], [])


def test_rename_and_summary_metadata_preserve_newer_history(client):
    session = store.create_session()
    url = '/sessions/' + session['id']
    newer = store.append_messages(session['id'], [message('newer')])
    renamed = client.patch(url + '/metadata', json={"title": "Chosen name"})
    assert renamed.status_code == 200
    assert renamed.json()['previous_revision'] == newer['revision']
    assert renamed.json()['messages'] == newer['messages']
    stale = client.patch(url + '/metadata', json={"memory_summary": "outdated summary", "summarized_message_count": 1,
                                                "expected_revision": session['revision']})
    assert stale.status_code == 409
    assert client.get(url).json()['memory_summary'] == ''
    current = client.get(url).json()
    summary = client.patch(url + '/metadata', json={"memory_summary": "accepted summary", "summarized_message_count": 1,
                                                  "expected_revision": current['revision']})
    assert summary.status_code == 200
    assert summary.json()['messages'] == newer['messages']
    assert summary.json()['title'] == 'Chosen name'
    assert client.patch(url + '/metadata', json={"messages": []}).status_code == 422


def test_summary_conflict_does_not_remove_independently_appended_reply(client):
    session = store.create_session()
    reply = store.append_messages(session['id'], [message('reply')])
    url = '/sessions/' + session['id']
    stale = client.post(url + '/messages/append', json={"messages": [], "memory_summary": "stale",
                                                     "expected_revision": session['revision']})
    assert stale.status_code == 409
    assert client.get(url).json()['messages'] == reply['messages']


def test_existing_message_changes_require_revision_and_identical_retry_is_safe(sessions_dir):
    session = store.create_session()
    first = store.append_messages(session['id'], [message('same')])
    store.append_messages(session['id'], [message('same')])
    with pytest.raises(store.SessionConflict):
        store.append_messages(session['id'], [message('same', 'different')], expected_revision=first['revision'])
    current = store.get_session(session['id'])
    updated = store.append_messages(session['id'], [message('same', 'different')], expected_revision=current['revision'])
    assert updated['messages'] == [message('same', 'different')]


def test_restore_changes_revision_and_preserves_recoverable_image_references(sessions_dir, monkeypatch):
    from services import memory_store
    monkeypatch.setattr(memory_store, 'delete_chat_session_data', lambda _: None)
    session = store.create_session()
    reference = 'blob:' + 'a' * 64
    saved = store.append_messages(session['id'], [{**message('image'), 'images': [reference]}])
    store.delete_session(session['id'])
    restored = store.restore_session(store.list_deleted_sessions()[0]['file'])
    assert restored['revision'] != saved['revision']
    assert restored['messages'][0]['images'] == [reference]
    with pytest.raises(store.SessionConflict):
        store.update_session(session['id'], [], expected_revision=saved['revision'])


def test_legacy_revision_can_be_read_without_rewriting_valid_history(sessions_dir):
    path = sessions_dir / 'legacy.json'
    path.write_text(json.dumps({"id": "legacy", "title": "Old", "messages": [message('old')], 'hidden_gallery_image_ids': []}))
    before = path.read_bytes()
    first = store.get_session('legacy')
    assert first['revision'] == store.get_session('legacy')['revision']
    assert path.read_bytes() == before
    path.write_text(json.dumps({**first, "revision": "external-edit", "messages": [message('external')]}))
    with pytest.raises(store.SessionConflict):
        store.update_session('legacy', [], expected_revision=first['revision'])
