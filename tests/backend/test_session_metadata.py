"""Revision cache correctness, privacy, and preservation using scratch data."""
import base64
import hashlib
import json
import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import session_store as store, image_store, image_vault as vault
from routes import sessions

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


@pytest.fixture(autouse=True)
def isolated(sessions_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(image_store, "BLOBS_DIR", tmp_path / "blobs")
    monkeypatch.setattr(vault, "ROOT", tmp_path / "vault")
    store.clear_session_metadata_cache()
    yield
    store.clear_session_metadata_cache()


def chat(title="Pictures"):
    session = store.create_session(title)
    store.append_messages(session["id"], [{"id": "m", "role": "assistant", "content": "keep me",
        "generatedImages": [{"id": "p", "src": image_store.put_bytes(PNG), "seed": 123}]}])
    return session["id"]


def count_json_reads(monkeypatch):
    reads = []
    original = store.json.load
    def counted(stream, *args, **kwargs):
        if Path(stream.name).parent == store.SESSIONS_DIR:
            reads.append(Path(stream.name).name)
        return original(stream, *args, **kwargs)
    monkeypatch.setattr(store.json, "load", counted)
    return reads


def test_warm_consumers_share_inventory_and_only_reparse_saved_chat(monkeypatch):
    first, second = chat(), chat()
    reads = count_json_reads(monkeypatch)
    assert len(store.list_sessions()) == 2
    assert len(reads) == 2
    assert len(store.list_session_images()) == 2
    assert store.list_session_images(True) == []
    assert len(reads) == 2
    before = store.get_session(first)
    store.update_session(first, before["messages"], title="Renamed", expected_revision=(store.get_session(first) or {}).get("revision"))
    reads.clear()
    assert {image["session_title"] for image in store.list_session_images()} == {"Renamed", "Pictures"}
    assert reads == [f"{first}.json"]
    assert store.get_session(second)["messages"][0]["content"] == "keep me"


def test_append_hide_restore_and_remove_refresh_warm_metadata():
    sid = chat()
    store.list_session_image_inventory()
    store.append_messages(sid, [{"id": "new", "role": "user", "content": "additional turn",
        "imagePreviews": [{"id": "new-image", "src": image_store.put_bytes(PNG + b"other")}]}])
    assert store.list_sessions()[0]["message_count"] == 2
    assert len(store.list_session_images()) == 2
    assert store.hide_session_image(sid, "p")
    groups = store.list_session_image_inventory()
    assert [image["image_id"] for image in groups["images"]] == ["new-image"]
    assert [image["image_id"] for image in groups["hidden_images"]] == ["p"]
    assert store.hide_session_image(sid, "p", False)
    assert len(store.list_session_images()) == 2
    assert store.permanently_delete_session_image(sid, "p")
    assert [image["image_id"] for image in store.list_session_images()] == ["new-image"]
    assert [m["content"] for m in store.get_session(sid)["messages"]] == ["keep me", "additional turn"]


def test_trash_restore_rebuild_and_shared_blob_survive():
    first, second = chat(), chat()
    reference = store.get_session(first)["messages"][0]["generatedImages"][0]["src"]
    store.list_session_images()
    assert store.delete_session(first)
    assert {image["session_id"] for image in store.list_session_images()} == {second}
    trashed = store.list_deleted_sessions()[0]["file"]
    assert image_store.exists(reference)
    assert store.restore_session(trashed)["id"] == first
    assert len(store.list_session_images()) == 2
    store.clear_session_metadata_cache()
    assert len(store.list_session_images()) == 2
    assert store.permanently_delete_session_image(first, "p")
    assert image_store.get_bytes(reference)[0] == PNG  # Second chat still owns it.


def test_external_replace_remove_and_repair_are_detected(sessions_dir):
    sid = chat()
    path = sessions_dir / f"{sid}.json"
    store.list_sessions()
    session = json.loads(path.read_text(encoding="utf-8"))
    session["title"] = "External restore"
    replacement = path.with_suffix(".tmp")
    replacement.write_text(json.dumps(session), encoding="utf-8")
    # Even an importer preserving mtime cannot reuse the old entry.
    os.utime(replacement, ns=(path.stat().st_atime_ns, path.stat().st_mtime_ns))
    replacement.replace(path)
    assert store.list_sessions()[0]["title"] == "External restore"
    path.write_text("{broken", encoding="utf-8")
    assert store.list_session_images() == []
    path.write_text(json.dumps(session), encoding="utf-8")
    assert len(store.list_session_images()) == 1
    path.unlink()
    assert store.list_sessions() == []
    assert store._metadata_entries == {}


@pytest.mark.parametrize("hidden", [False, True])
@pytest.mark.parametrize("inline", [False, True])
def test_lock_unlock_and_corrupt_vault_never_reuse_public_decision(monkeypatch, hidden, inline):
    sid = chat()
    if hidden:
        store.hide_session_image(sid, "p")
    if inline:
        path = store.SESSIONS_DIR / f"{sid}.json"
        session = json.loads(path.read_text(encoding="utf-8"))
        session["messages"][0]["generatedImages"][0]["src"] = base64.b64encode(PNG).decode()
        path.write_text(json.dumps(session), encoding="utf-8")
    assert len(store.list_session_images(hidden)) == 1
    reads = count_json_reads(monkeypatch)
    value = {"version": 1, "locks": {"a" * 32: [hashlib.sha256(PNG).hexdigest()]}}
    vault.save_config(value)
    assert store.list_session_image_inventory() == {"images": [], "hidden_images": []}
    value["locks"] = {}
    vault.save_config(value)
    assert len(store.list_session_images(hidden)) == 1
    assert reads == []  # Lock decisions refreshed without reparsing chats.
    (vault.ROOT / "vault.json").write_text("{bad", encoding="utf-8")
    with pytest.raises(vault.LockedImageError):
        store.list_session_image_inventory()


def test_lock_changes_during_cold_rebuild_are_applied(monkeypatch):
    chat()
    locked = set()
    original = store._metadata_for_session
    def build(session):
        result = original(session)
        locked.add(hashlib.sha256(PNG).hexdigest())
        return result
    monkeypatch.setattr(store, "_metadata_for_session", build)
    monkeypatch.setattr(vault, "locked_hashes", lambda: locked)
    assert store.list_session_images() == []


def test_legacy_lists_do_not_write_and_urls_survive_bounded_migration(sessions_dir):
    original = {"id": "legacy", "title": "Old", "created_at": "2020", "updated_at": "2020",
        "messages": [{"role": "user", "content": "preserved", "images": [base64.b64encode(PNG).decode()],
                      "imagePreviews": [{"src": "data:image/png;base64," + base64.b64encode(PNG).decode()}]}]}
    path = sessions_dir / "legacy.json"
    path.write_text(json.dumps(original), encoding="utf-8")
    bytes_before, modified = path.read_bytes(), path.stat().st_mtime_ns
    images = store.list_session_images()
    store.clear_session_metadata_cache()
    assert store.list_session_images() == images
    assert path.read_bytes() == bytes_before and path.stat().st_mtime_ns == modified
    assert not store.BACKUPS_DIR.exists()
    assert store.migrate_session_metadata(["legacy", "missing"]) == {"processed": ["legacy"], "missing": ["missing"]}
    assert store.list_session_images() == images
    image = images[0]
    assert store.get_session_image_by_id("legacy", image["message_id"], image["image_id"])[0] == PNG
    assert (store.BACKUPS_DIR / "legacy.pre-blob.json").read_bytes() == bytes_before
    assert store.get_session("legacy")["messages"][0]["content"] == "preserved"


def test_returned_metadata_cannot_poison_cache():
    chat()
    store.list_sessions()[0]["title"] = "poison"
    images = store.list_session_images()
    images[0]["url"] = "bad"
    images[0]["seed"] = -1
    assert store.list_sessions()[0]["title"] == "Pictures"
    assert store.list_session_images()[0]["url"].startswith("/sessions/")
    assert store.list_session_images()[0]["seed"] == 123
    assert "keep me" not in repr(store._metadata_entries)
    assert base64.b64encode(PNG).decode() not in repr(store._metadata_entries)
    assert not any(key.startswith("_") for key in store.list_session_images()[0])


def test_combined_route_compatibility_and_migration_bounds():
    sid = chat()
    store.hide_session_image(sid, "p")
    app = FastAPI()
    app.include_router(sessions.router)
    with TestClient(app) as client:
        assert client.get("/sessions/images").json() == {"images": []}
        hidden = client.get("/sessions/images?hidden=true").json()["images"]
        combined = client.get("/sessions/images?include_hidden=true")
        assert combined.json() == {"images": [], "hidden_images": hidden}
        assert combined.headers["cache-control"] == "no-store"
        assert client.post("/sessions/metadata/migrate", json={"session_ids": [sid]}).json()["processed"] == [sid]
        for ids in ([], [sid] * 26, ["../escape"]):
            assert client.post("/sessions/metadata/migrate", json={"session_ids": ids}).status_code == 422


def test_bad_image_metadata_does_not_hide_chat_or_modify_source(sessions_dir):
    sid = chat()
    path = sessions_dir / f"{sid}.json"
    session = json.loads(path.read_text(encoding="utf-8"))
    session["hidden_gallery_image_ids"] = [{}]
    path.write_text(json.dumps(session), encoding="utf-8")
    original = path.read_bytes()
    assert store.list_sessions()[0]["id"] == sid
    assert store.list_session_images() == []
    assert path.read_bytes() == original


def test_unverifiable_legacy_source_fails_closed_with_locks_without_erasure(sessions_dir):
    sid = chat()
    path = sessions_dir / f"{sid}.json"
    session = json.loads(path.read_text(encoding="utf-8"))
    session["messages"][0]["generatedImages"][0]["src"] = "/image-generation/outputs/legacy.png"
    path.write_text(json.dumps(session), encoding="utf-8")
    original = path.read_bytes()
    assert len(store.list_session_images()) == 1
    policy = {"version": 1, "locks": {"a" * 32: [hashlib.sha256(PNG).hexdigest()]}}
    vault.save_config(policy)
    assert store.list_session_images() == []
    assert store.list_sessions()[0]["id"] == sid
    assert path.read_bytes() == original
    policy["locks"] = {}
    vault.save_config(policy)
    assert len(store.list_session_images()) == 1
