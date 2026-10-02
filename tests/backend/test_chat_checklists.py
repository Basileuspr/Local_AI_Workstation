from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.sessions import router
from services import session_store as store
from services.chat_checklists import set_task_checked, edit_checklist


@pytest.fixture
def client(sessions_dir):
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


def seed(content="- [ ] Buy milk\n  - [X] Nested task"):
    session = store.create_session()
    return store.append_messages(session["id"], [{"id": "tasks", "role": "assistant", "content": content,
                                                "artifacts": [{"id": "keep-me"}]}])


def patch(client, session, line=0, checked=True, content=None):
    return client.patch(f"/sessions/{session['id']}/messages/tasks/checklist", json={
        "line_index": line, "checked": checked,
        "expected_content": session["messages"][0]["content"] if content is None else content,
    })


@pytest.mark.parametrize("source,line,expected", [
    ("- [ ] One\r\n  + [X] Two\r", 0, "- [x] One\r\n  + [X] Two\r"),
    ("## List\n\n1. [ ] **One**\n2) [ ] Two", 3, "## List\n\n1. [ ] **One**\n2) [x] Two"),
    ("- [ ]", 0, "- [x]"),
])
def test_only_selected_marker_changes(source, line, expected):
    assert set_task_checked(source, line, True) == expected


@pytest.mark.parametrize("source,line", [
    ("```markdown\n- [ ] Example\n```", 1),
    ("   ~~~~md\n- [ ] Example\n~~~\n- [ ] Still code", 3),
    ("````\n```\n- [ ] Still code", 2),
    ("> - [ ] Quoted", 0), ("plain text", 0), ("- [ ] Task", 9),
])
def test_examples_and_non_tasks_cannot_be_edited(source, line):
    with pytest.raises(ValueError):
        set_task_checked(source, line, True)


def test_round_trip_nested_toggle_and_copyable_markdown(client):
    session = seed()
    response = patch(client, session)
    assert response.status_code == 200
    saved = store.get_session(session["id"])
    assert saved["messages"][0]["content"] == "- [x] Buy milk\n  - [X] Nested task"
    assert response.json()["previous_revision"] == session["revision"]
    assert response.json()["revision"] == saved["revision"]
    assert patch(client, saved, line=1, checked=False).status_code == 200
    assert store.get_session(session["id"])["messages"][0]["content"] == "- [x] Buy milk\n  - [ ] Nested task"
    assert saved["messages"][0]["artifacts"] == [{"id": "keep-me"}]


def test_concurrent_append_and_rename_survive_checking_old_message(client):
    session = seed()
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = [pool.submit(patch, client, session),
                pool.submit(store.append_messages, session["id"], [{"id": "new", "role": "user", "content": "Newer reply"}]),
                pool.submit(store.update_session_metadata, session["id"], title="My list")]
        assert jobs[0].result().status_code == 200
        for job in jobs[1:]:
            job.result()
    saved = store.get_session(session["id"])
    assert saved["title"] == "My list"
    assert len(saved["messages"]) == 2
    assert saved["messages"][0]["content"].startswith("- [x]")
    assert saved["messages"][1]["content"] == "Newer reply"


def test_stale_message_and_invalid_requests_preserve_disk(client, sessions_dir):
    session = seed()
    assert patch(client, session).status_code == 200
    path = sessions_dir / f"{session['id']}.json"
    before = path.read_bytes()
    assert patch(client, session, line=1).status_code == 409
    current = store.get_session(session["id"])
    assert patch(client, current, line=99).status_code == 422
    assert patch(client, current, line=-1).status_code == 422
    assert path.read_bytes() == before
    assert client.patch(f"/sessions/{session['id']}/messages/missing/checklist", json={
        "line_index": 0, "checked": True, "expected_content": "- [ ] Missing"}).status_code == 404


def test_editing_summarized_task_invalidates_old_summary(client):
    session = seed()
    store.update_session_metadata(session["id"], memory_summary="Milk is pending", summarized_message_count=1,
                                  expected_revision=session["revision"])
    assert patch(client, session).status_code == 200
    saved = store.get_session(session["id"])
    assert saved["memory_summary"] == ""
    assert saved["summarized_message_count"] == 0
    assert saved["messages"][0]["content"].startswith("- [x]")


def test_failed_write_leaves_original_checklist(sessions_dir, monkeypatch):
    session = seed()
    before = (sessions_dir / f"{session['id']}.json").read_bytes()
    def fail(*args):
        raise OSError("Simulated disk failure")
    monkeypatch.setattr(store.os, "fsync", fail)
    with pytest.raises(OSError):
        store.update_checklist_item(session["id"], "tasks", line_index=0, checked=True,
                                    expected_content=session["messages"][0]["content"])
    assert (sessions_dir / f"{session['id']}.json").read_bytes() == before


def test_edit_add_remove_preserves_prose_code_and_line_endings(client):
    content = "# Today\r\n\r\n- [ ] Milk\r\n  - [X] Old task\r\n\r\nKeep this paragraph.\r\n~~~\r\n- [ ] Code example\r\n~~~"
    session = seed(content)
    url = f"/sessions/{session['id']}/messages/tasks/checklist"
    response = client.put(url, json={"expected_content": content, "items": [
        {"line_index": 2, "text": "Buy **bread**", "checked": True},
        {"line_index": None, "text": "Call Sam", "checked": False},
    ]})
    assert response.status_code == 200
    saved = store.get_session(session["id"])
    assert saved["messages"][0]["content"] == "# Today\r\n\r\n- [x] Buy **bread**\r\n- [ ] Call Sam\r\n\r\nKeep this paragraph.\r\n~~~\r\n- [ ] Code example\r\n~~~"
    assert saved["messages"][0]["artifacts"] == [{"id": "keep-me"}]
    assert saved["messages"][0]["checklist_editable"]
    assert client.put(url, json={"expected_content": content, "items": []}).status_code == 409


def test_remove_all_tasks_can_add_again_after_reloading(client):
    session = seed("- [ ] Task")
    url = f"/sessions/{session['id']}/messages/tasks/checklist"
    removed = client.put(url, json={"expected_content": "- [ ] Task", "items": []})
    assert removed.status_code == 200
    assert removed.json()["content"] == ""
    reloaded = store.get_session(session["id"])
    assert reloaded["messages"][0]["checklist_editable"]
    added = client.put(url, json={"expected_content": "", "items": [{"text": "New item", "checked": False}]})
    assert added.status_code == 200
    assert added.json()["content"] == "- [ ] New item"


@pytest.mark.parametrize("items", [
    [{"line_index": 1, "text": "Overwrite prose", "checked": False}],
    [{"line_index": 0, "text": "One\n- [ ] Injection", "checked": False}],
    [{"line_index": 0, "text": "One", "checked": False}] * 2,
])
def test_editor_cannot_edit_prose_or_inject_lines(client, sessions_dir, items):
    content = "- [ ] Task\nParagraph"
    session = seed(content)
    before = (sessions_dir / f"{session['id']}.json").read_bytes()
    response = client.put(f"/sessions/{session['id']}/messages/tasks/checklist", json={"expected_content": content, "items": items})
    assert response.status_code == 422
    assert (sessions_dir / f"{session['id']}.json").read_bytes() == before


def test_edit_preserves_newer_appends_and_clears_obsolete_summary(client):
    session = seed()
    store.update_session_metadata(session['id'], memory_summary='Old tasks', summarized_message_count=1, expected_revision=session['revision'])
    store.append_messages(session['id'], [{'id': 'new', 'role': 'user', 'content': 'Keep me'}])
    result = client.put(f"/sessions/{session['id']}/messages/tasks/checklist", json={
        'expected_content': session['messages'][0]['content'], 'items': [{'line_index': 0, 'text': 'New task', 'checked': True}]})
    assert result.status_code == 200
    saved = store.get_session(session['id'])
    assert saved['messages'][1]['content'] == 'Keep me'
    assert saved['memory_summary'] == ''
    assert saved['summarized_message_count'] == 0


def test_manual_changes_keep_snapshots_and_precise_history_with_duplicate_text(client):
    content = '# Tasks\n- [ ] Same task\n- [x] Same task\n- [ ] Rename me\n```\n- [ ] Example\n```'
    session = seed(content)
    response = client.put(f"/sessions/{session['id']}/messages/tasks/checklist", json={
        'expected_content': content, 'items': [
            {'line_index': 2, 'text': 'Same task', 'checked': True},
            {'line_index': 3, 'text': 'Renamed task', 'checked': True},
            {'text': 'Added task', 'checked': False},
        ]})
    assert response.status_code == 200
    saved = store.get_session(session['id'])
    history = saved['messages'][0]['checklist_history']
    assert response.json()['checklist_history'] == history and len(history) == 1
    entry = history[0]
    assert entry['id'] and datetime.fromisoformat(entry['at']).tzinfo
    assert entry['action'] == 'edit'
    assert [change['kind'] for change in entry['changes']] == ['removed', 'edited', 'completed', 'added']
    assert entry['changes'][0]['before']['line_index'] == 1
    assert entry['changes'][0]['before']['checked'] is False
    assert entry['changes'][1]['before']['text'] == 'Rename me'
    assert entry['changes'][1]['after']['text'] == 'Renamed task'
    assert [item['text'] for item in entry['before']] == ['Same task', 'Same task', 'Rename me']
    assert [item['text'] for item in entry['after']] == ['Same task', 'Renamed task', 'Added task']
    assert '- [ ] Example' in saved['messages'][0]['content']
    assert saved['messages'][0]['artifacts'] == [{'id': 'keep-me'}]
    # Reopen and edit another item: older entries and their IDs remain unchanged.
    response = patch(client, saved, line=1, checked=False)
    assert response.status_code == 200
    history = store.get_session(session['id'])['messages'][0]['checklist_history']
    assert history[0] == entry and len(history) == 2
    assert history[1]['changes'][0]['kind'] == 'reopened'


def test_empty_list_history_survives_additions_and_whole_chat_saves(client):
    session = seed('- [ ] Retain deleted item')
    url = f"/sessions/{session['id']}/messages/tasks/checklist"
    assert client.put(url, json={'expected_content': session['messages'][0]['content'], 'items': []}).status_code == 200
    removed = store.get_session(session['id'])
    assert removed['messages'][0]['checklist_history'][0]['after'] == []
    # An older client replaces this chat without checklist metadata.
    saved = store.update_session(session['id'], [{'id': 'tasks', 'role': 'assistant', 'content': ''}], expected_revision=removed['revision'])
    assert saved['messages'][0]['checklist_history'] == removed['messages'][0]['checklist_history']
    assert saved['messages'][0]['checklist_editable']
    added = client.put(url, json={'expected_content': '', 'items': [{'text': 'New item', 'checked': False}]})
    assert added.status_code == 200
    assert len(added.json()['checklist_history']) == 2
    assert added.json()['checklist_history'][1]['changes'][0]['kind'] == 'added'


def test_noops_and_rejected_edits_do_not_append_history(client, sessions_dir):
    session = seed('- [ ] Task')
    assert patch(client, session).status_code == 200
    saved = store.get_session(session['id'])
    before = (sessions_dir / f"{session['id']}.json").read_bytes()
    noop = patch(client, saved)
    assert noop.status_code == 200 and len(noop.json()['checklist_history']) == 1
    assert patch(client, session).status_code == 409
    assert patch(client, saved, line=42).status_code == 422
    assert (sessions_dir / f"{session['id']}.json").read_bytes() == before
