"""
Tests for image blob storage and session migration.

This is the riskiest change in the project: it rewrites session files that may
hold months of conversation. The rules it must never break are that a payload
is only removed from the JSON once its bytes are safely stored, and that the
original file is preserved before the first rewrite.
"""

import base64
import json

import pytest

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff" + b"\x00" * 32
PNG_B64 = base64.b64encode(PNG).decode("ascii")
JPEG_B64 = base64.b64encode(JPEG).decode("ascii")
PNG_DATA_URL = f"data:image/png;base64,{PNG_B64}"


@pytest.fixture
def blobs(tmp_path, monkeypatch):
    from services import image_store

    target = tmp_path / "blobs"
    monkeypatch.setattr(image_store, "BLOBS_DIR", target)
    return target


@pytest.fixture
def store(blobs, tmp_path, monkeypatch):
    """Session store pointed at throwaway directories, blobs included."""
    from services import session_store

    sessions = tmp_path / "sessions"
    sessions.mkdir()
    monkeypatch.setattr(session_store, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(session_store, "BACKUPS_DIR", tmp_path / "backups")
    monkeypatch.setattr(session_store, "TRASH_DIR", tmp_path / "trash")
    monkeypatch.setattr(session_store, "GENERATED_IMAGES_DIR", tmp_path / "generated_images")
    return session_store


# --- blob store ------------------------------------------------------------

def test_stored_bytes_round_trip(blobs):
    from services import image_store

    reference = image_store.put_bytes(PNG)

    assert image_store.is_reference(reference)
    assert image_store.get_bytes(reference) == (PNG, "image/png")


def test_identical_content_stores_one_copy(blobs):
    """Content addressing: the same picture attached twice costs one file."""
    from services import image_store

    first = image_store.put_bytes(PNG)
    second = image_store.put_bytes(PNG)

    assert first == second
    assert len(list(blobs.glob("*.png"))) == 1


def test_different_content_stores_separately(blobs):
    from services import image_store

    assert image_store.put_bytes(PNG) != image_store.put_bytes(JPEG)


def test_data_urls_and_bare_base64_produce_the_same_reference(blobs):
    """The two forms an upload saves are the same picture and must converge."""
    from services import image_store

    assert image_store.put_payload(PNG_DATA_URL) == image_store.put_payload(PNG_B64)


def test_unreadable_payloads_are_rejected_rather_than_stored(blobs):
    from services import image_store

    assert image_store.put_payload("not base64 at all!!") is None
    assert image_store.put_payload("") is None


def test_missing_reference_reads_as_none(blobs):
    from services import image_store

    assert image_store.get_bytes("blob:" + "0" * 64) is None


@pytest.mark.parametrize(
    "value",
    ["blob:../../etc/passwd", "blob:zz", "blob:", "not-a-reference", "", None, 123],
)
def test_malformed_references_are_refused(blobs, value):
    """A reference must never be able to address a file outside the store."""
    from services import image_store

    assert image_store.is_reference(value) is False
    if isinstance(value, str):
        assert image_store.get_bytes(value) is None


def test_no_partial_file_is_left_behind(blobs):
    from services import image_store

    image_store.put_bytes(PNG)

    assert list(blobs.glob("*.partial")) == []


def test_base64_read_back_matches_the_original(blobs):
    """Vision models receive base64, so the round trip has to be exact."""
    from services import image_store

    reference = image_store.put_bytes(PNG)

    assert image_store.get_base64(reference) == PNG_B64


# --- session migration -----------------------------------------------------

def legacy_session_with_images():
    return [
        {
            "id": "m1",
            "role": "user",
            "content": "[Image uploaded: cat.png (1 KB)]",
            "images": [PNG_B64],
            "imagePreviews": [{"id": "p1", "src": PNG_DATA_URL, "name": "cat.png"}],
        }
    ]


def test_saving_moves_payloads_out_of_the_json(store):
    from services import image_store

    session = store.create_session()
    store.update_session(session["id"], legacy_session_with_images())

    raw = (store.SESSIONS_DIR / f"{session['id']}.json").read_text(encoding="utf-8")

    assert PNG_B64 not in raw, "the payload is still inline"
    assert "blob:" in raw
    message = json.loads(raw)["messages"][0]
    assert image_store.is_reference(message["images"][0])
    assert image_store.is_reference(message["imagePreviews"][0]["src"])


def test_migration_shrinks_the_session_file_dramatically(store):
    big = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 200_000).decode("ascii")
    session = store.create_session()

    store.update_session(
        session["id"],
        [{"id": "m1", "role": "user", "content": "x", "images": [big]}],
    )

    size = (store.SESSIONS_DIR / f"{session['id']}.json").stat().st_size
    assert size < 1000, f"session JSON is still {size} bytes"


def test_the_picture_is_still_retrievable_after_migration(store):
    session = store.create_session()
    store.update_session(session["id"], legacy_session_with_images())

    found = store.get_session_image_by_id(session["id"], "m1", "p1")

    assert found is not None
    assert found == (PNG, "image/png")


def test_legacy_session_is_migrated_when_it_is_opened(store):
    session = store.create_session()
    # Write inline payloads directly, as an older build would have.
    path = store.SESSIONS_DIR / f"{session['id']}.json"
    session["messages"] = legacy_session_with_images()
    path.write_text(json.dumps(session), encoding="utf-8")

    store.get_session(session["id"])

    assert PNG_B64 not in path.read_text(encoding="utf-8")


def test_the_original_file_is_backed_up_before_migration(store):
    """Months of conversation are being rewritten; keep the original."""
    session = store.create_session()
    path = store.SESSIONS_DIR / f"{session['id']}.json"
    session["messages"] = legacy_session_with_images()
    original = json.dumps(session)
    path.write_text(original, encoding="utf-8")

    store.get_session(session["id"])

    backup = store.BACKUPS_DIR / f"{session['id']}.pre-blob.json"
    assert backup.exists()
    assert PNG_B64 in backup.read_text(encoding="utf-8")


def test_backup_is_not_overwritten_by_later_saves(store):
    session = store.create_session()
    path = store.SESSIONS_DIR / f"{session['id']}.json"
    session["messages"] = legacy_session_with_images()
    path.write_text(json.dumps(session), encoding="utf-8")

    store.get_session(session["id"])
    first = (store.BACKUPS_DIR / f"{session['id']}.pre-blob.json").read_bytes()
    store.update_session(session["id"], [{"id": "m2", "role": "user", "content": "later"}])
    store.get_session(session["id"])

    assert (store.BACKUPS_DIR / f"{session['id']}.pre-blob.json").read_bytes() == first


def test_migration_is_idempotent(store):
    session = store.create_session()
    store.update_session(session["id"], legacy_session_with_images())
    first = (store.SESSIONS_DIR / f"{session['id']}.json").read_text(encoding="utf-8")

    store.get_session(session["id"])
    store.get_session(session["id"])

    assert (store.SESSIONS_DIR / f"{session['id']}.json").read_text(encoding="utf-8") == first


def test_served_paths_are_left_alone(store):
    """A URL is already external; it is not a payload to move."""
    session = store.create_session()
    store.update_session(
        session["id"],
        [{
            "id": "m1",
            "role": "assistant",
            "content": "generated",
            "generatedImages": [{"id": "g1", "url": "/image-generation/outputs/a.png"}],
        }],
    )

    loaded = store.get_session(session["id"])
    assert loaded["messages"][0]["generatedImages"][0]["url"] == "/image-generation/outputs/a.png"


def test_undecodable_values_are_preserved_not_discarded(store):
    """If we cannot store it, we must not remove it either."""
    session = store.create_session()
    store.update_session(
        session["id"],
        [{"id": "m1", "role": "user", "content": "x", "images": ["!!!not base64!!!"]}],
    )

    loaded = store.get_session(session["id"])
    assert loaded["messages"][0]["images"] == ["!!!not base64!!!"]


def test_gallery_still_lists_migrated_images(store):
    session = store.create_session()
    store.update_session(session["id"], legacy_session_with_images())

    images = store.list_session_images()

    assert len(images) == 1
    assert images[0]["name"] == "cat.png"


def test_the_duplicate_upload_pair_still_lists_once(store):
    """
    An upload saves the payload twice. Content addressing collapses both to the
    same reference, so the gallery shows one picture without the positional
    matching the inline format needed.
    """
    session = store.create_session()
    store.update_session(session["id"], legacy_session_with_images())

    assert len(store.list_session_images()) == 1


# --- deletion is recoverable ----------------------------------------------

def test_deleting_a_session_moves_it_to_the_trash(store):
    session = store.create_session(title="Important")
    store.update_session(session["id"], [{"id": "m1", "role": "user", "content": "keep me"}])

    assert store.delete_session(session["id"]) is True
    assert store.get_session(session["id"]) is None

    trashed = store.list_deleted_sessions()
    assert len(trashed) == 1
    assert trashed[0]["title"] == "Important"


def test_a_deleted_session_can_be_restored(store):
    session = store.create_session(title="Important")
    store.update_session(session["id"], [{"id": "m1", "role": "user", "content": "keep me"}])
    store.delete_session(session["id"])

    restored = store.restore_session(store.list_deleted_sessions()[0]["file"])

    assert restored["id"] == session["id"]
    assert store.get_session(session["id"])["messages"][0]["content"] == "keep me"
    assert store.list_deleted_sessions() == []


def test_restoring_an_unknown_file_returns_none(store):
    assert store.restore_session("nope.json") is None


def test_restore_refuses_to_escape_the_trash_directory(store):
    """A crafted filename must not be able to read arbitrary files."""
    assert store.restore_session("../../../etc/passwd") is None


def test_deleting_a_missing_session_still_reports_failure(store):
    assert store.delete_session("does-not-exist") is False


def test_permanently_deleting_an_image_removes_its_record_blob_and_backup(store):
    from services import image_store

    session = store.create_session()
    path = store.SESSIONS_DIR / f"{session['id']}.json"
    session["messages"] = legacy_session_with_images()
    path.write_text(json.dumps(session), encoding="utf-8")
    migrated = store.get_session(session["id"])
    reference = migrated["messages"][0]["imagePreviews"][0]["src"]
    assert (store.BACKUPS_DIR / f"{session['id']}.pre-blob.json").exists()

    assert store.permanently_delete_session_image(session["id"], "p1") is True

    saved = store.get_session(session["id"])["messages"][0]
    assert saved["imagePreviews"] == []
    assert saved["images"] == []
    assert image_store.exists(reference) is False
    assert not (store.BACKUPS_DIR / f"{session['id']}.pre-blob.json").exists()


def test_permanently_deleting_one_shared_image_keeps_the_other_chat_intact(store):
    from services import image_store

    reference = image_store.put_bytes(PNG)
    first = store.create_session()
    second = store.create_session()
    message = lambda message_id, image_id: [{
        "id": message_id,
        "role": "user",
        "content": "image",
        "imagePreviews": [{"id": image_id, "src": reference, "name": "shared.png"}],
    }]
    store.update_session(first["id"], message("m1", "p1"))
    store.update_session(second["id"], message("m2", "p2"))

    assert store.permanently_delete_session_image(first["id"], "p1") is True

    assert image_store.exists(reference) is True
    assert store.get_session_image_by_id(second["id"], "m2", "p2") == (PNG, "image/png")


def test_permanently_deleting_a_trashed_session_removes_its_blob_and_backup(store, monkeypatch):
    from services import image_store, memory_store

    monkeypatch.setattr(memory_store, "delete_chat_session_data", lambda _session_id: None)
    session = store.create_session()
    path = store.SESSIONS_DIR / f"{session['id']}.json"
    session["messages"] = legacy_session_with_images()
    path.write_text(json.dumps(session), encoding="utf-8")
    migrated = store.get_session(session["id"])
    reference = migrated["messages"][0]["imagePreviews"][0]["src"]
    store.delete_session(session["id"])
    filename = store.list_deleted_sessions()[0]["file"]

    assert store.permanently_delete_trashed_session(filename) is True

    assert store.list_deleted_sessions() == []
    assert image_store.exists(reference) is False
    assert not (store.BACKUPS_DIR / f"{session['id']}.pre-blob.json").exists()
