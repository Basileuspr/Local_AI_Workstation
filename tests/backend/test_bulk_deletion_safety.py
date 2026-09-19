"""Exercise the deletion primitives used by bulk UI actions on temporary data."""
import base64
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import image_store, session_store as store
from routes.sessions import router


@pytest.fixture
def isolated(sessions_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(image_store, "BLOBS_DIR", tmp_path / "blobs")
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield client


def test_failed_trash_move_preserves_original_and_reports_failure(isolated, monkeypatch):
    session = store.create_session("Keep on disk failure")
    path = store.SESSIONS_DIR / f"{session['id']}.json"
    original = path.read_bytes()
    replace = Path.replace
    def fail_source(self, target):
        if self == path:
            raise PermissionError("Read-only trash")
        return replace(self, target)
    monkeypatch.setattr(Path, "replace", fail_source)
    response = isolated.delete(f"/sessions/{session['id']}")
    assert response.status_code == 500
    assert "preserved" in response.json()["detail"]
    assert path.read_bytes() == original
    assert store.list_deleted_sessions() == []


def test_partial_batch_keeps_successes_recoverable_and_failure_live(isolated, monkeypatch):
    sessions = [store.create_session(f"Chat {i}") for i in range(3)]
    failed_path = store.SESSIONS_DIR / f"{sessions[1]['id']}.json"
    replace = Path.replace
    def fail_one(self, target):
        if self == failed_path:
            raise PermissionError("Locked")
        return replace(self, target)
    monkeypatch.setattr(Path, "replace", fail_one)
    responses = [isolated.delete(f"/sessions/{session['id']}").status_code for session in sessions]
    assert responses == [200, 500, 200]
    assert [item["id"] for item in store.list_sessions()] == [sessions[1]["id"]]
    trash = store.list_deleted_sessions()
    assert {item["id"] for item in trash} == {sessions[0]["id"], sessions[2]["id"]}
    for item in trash:
        assert isolated.post("/sessions/trash/restore", json={"file":item["file"]}).status_code == 200
    assert len(store.list_sessions()) == 3


def pictures():
    return [base64.b64encode(b"\x89PNG\r\n\x1a\n" + str(i).encode()).decode() for i in range(5)]


def test_raw_image_ids_and_hidden_images_survive_multiple_removals(isolated):
    session = store.create_session("Legacy raw images")
    store.update_session(session["id"], [{"id":"m", "role":"user", "images":pictures()}])
    original = store.list_session_images()
    by_id = {image["image_id"]: image for image in original}
    assert set(by_id) == {f"raw-m-{i}" for i in range(5)}
    assert store.hide_session_image(session["id"], "raw-m-4")
    assert store.get_session_image_by_id(session["id"], "m", "raw-m-4") is not None
    for image_id in ["raw-m-1", "raw-m-3"]:
        assert store.permanently_delete_session_image(session["id"], image_id)
    assert {image["image_id"] for image in store.list_session_images()} == {"raw-m-0", "raw-m-2"}
    assert store.get_session_image_by_id(session["id"], "m", "raw-m-2")[0].endswith(b"2")
    assert store.get_session_image_by_id(session["id"], "m", "raw-m-4")[0].endswith(b"4")
    assert store.get_session_image_by_id(session["id"], "m", "raw-m-1") is None
    loaded = store.get_session(session["id"])
    loaded["messages"][0]["images"].append(pictures()[1])
    store.update_session(session["id"], loaded["messages"])
    ids = store.get_session(session["id"])["messages"][0]["raw_image_ids"]
    assert ids[:3] == ["raw-m-0", "raw-m-2", "raw-m-4"]
    assert len(set(ids)) == 4


def test_preview_removal_keeps_other_raw_image_ids_stable(isolated):
    session = store.create_session("Mixed images")
    raw = pictures()[:3]
    store.update_session(session["id"], [{"id":"m", "role":"user", "images":raw,
        "imagePreviews":[{"id":"preview", "src":f"data:image/png;base64,{raw[0]}"}]}])
    assert store.permanently_delete_session_image(session["id"], "preview")
    assert {image["image_id"] for image in store.list_session_images()} == {"raw-m-1", "raw-m-2"}


def test_failed_session_replacement_never_truncates_the_original(isolated, monkeypatch):
    session = store.create_session("Preserved")
    path = store.SESSIONS_DIR / f"{session['id']}.json"
    before = path.read_bytes()
    replace = Path.replace
    def fail_pending(self, target):
        if self.name.startswith(".pending-"):
            raise PermissionError("Disk cannot replace file")
        return replace(self, target)
    monkeypatch.setattr(Path, "replace", fail_pending)
    with pytest.raises(PermissionError):
        store.update_session(session["id"], [{"id":"m", "role":"user", "content":"Changed"}])
    assert path.read_bytes() == before
    assert not list(store.SESSIONS_DIR.glob(".pending-*"))
