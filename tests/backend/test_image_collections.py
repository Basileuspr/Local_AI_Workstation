import base64
import hashlib
import io
import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from PIL import Image
from services import image_library as library, image_vault as vault, image_store, session_store, lora_store
from services.image_workflows import store, runner, exports
from services.image_workflows.contracts import UpdateRequest, RunRecord
from routes import image_library as routes, sessions, image_generation, export


def picture(color="red"):
    stream = io.BytesIO(); Image.new("RGB", (24, 16), color).save(stream, "PNG"); return stream.getvalue()


@pytest.fixture
def isolated(tmp_path, monkeypatch, sessions_dir, lora_paths):
    monkeypatch.setattr(library, "ROOT", tmp_path / "library")
    monkeypatch.setattr(vault, "ROOT", tmp_path / "vault")
    monkeypatch.setattr(image_store, "BLOBS_DIR", tmp_path / "blobs")
    monkeypatch.setattr(store, "ROOT", tmp_path / "workflows")
    monkeypatch.setattr(image_generation, "OUTPUT_DIR", tmp_path / "generated")
    vault.TOKENS.clear()
    app = FastAPI()
    for router in (routes.router, sessions.router, image_generation.router, export.router): app.include_router(router)
    @app.exception_handler(vault.LockedImageError)
    async def blocked(request, error): return JSONResponse(status_code=403, content={"detail": str(error)})
    with TestClient(app) as client: yield client
    vault.TOKENS.clear()


def chat(data=None):
    data = data or picture()
    reference = image_store.put_bytes(data)
    session = session_store.create_session("Source chat")
    session_store.append_messages(session["id"], [{"id":"message", "role":"assistant", "content":"Image", "generatedImages":[{"id":"image", "name":"private-name.png", "src":reference}]}])
    return session, reference, {"kind":"session", "session_id":session["id"], "message_id":"message", "image_id":"image", "name":"private-name.png"}


def auth(client):
    result = client.post("/image-library/vault/setup", json={"pin":"12345678"})
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    return {"Authorization": "Bearer " + result.json()["token"]}


def test_hidden_images_are_listed_and_restored_without_touching_chat(isolated):
    session, reference, source = chat()
    original = session_store.get_session(session["id"])["messages"]
    path = f"/sessions/{session['id']}/gallery-images/image"
    assert isolated.delete(path).status_code == 200
    assert isolated.get("/sessions/images").json()["images"] == []
    assert len(isolated.get("/sessions/images?hidden=true").json()["images"]) == 1
    assert isolated.post(path + "/restore").status_code == 200
    assert len(isolated.get("/sessions/images").json()["images"]) == 1
    assert session_store.get_session(session["id"])["messages"] == original


def test_folder_copy_survives_source_deletion_and_folder_removal(isolated):
    session, reference, source = chat()
    folder = isolated.post("/image-library/folders", json={"name":"🌲 Scene"}).json()
    image = isolated.post("/image-library/import", json={**source, "folder_id":folder["id"]}).json()
    assert image["origin"]["session_id"] == session["id"]
    session_store.delete_session(session["id"])
    assert isolated.get(image["url"]).content == picture()
    assert isolated.patch(f"/image-library/images/{image['id']}", json={"rating":"liked"}).json()["rating"] == "liked"
    assert isolated.patch(f"/image-library/images/{image['id']}", json={"rating":"disliked"}).json()["rating"] == "disliked"
    isolated.delete(f"/image-library/folders/{folder['id']}")
    assert library.public_index()["images"][0]["folder_ids"] == []
    assert isolated.get(image["url"]).status_code == 200


def test_batch_upload_retains_good_files_and_reuses_duplicates(isolated):
    response = isolated.post("/image-library/upload", files=[("files",("a.png",picture(),"image/png")),("files",("bad.png",b"bad","image/png")),("files",("b.png",picture("blue"),"image/png"))])
    assert response.status_code == 200
    assert len(response.json()["images"]) == 2 and len(response.json()["errors"]) == 1
    first = response.json()["images"][0]
    library.edit_image(first["id"], rating="liked", set_rating=True)
    duplicate = isolated.post("/image-library/upload", files={"files":("again.png",picture(),"image/png")}).json()["images"][0]
    assert duplicate["id"] == first["id"] and duplicate["rating"] == "liked"


def test_vault_blocks_originals_copies_and_direct_urls(isolated):
    session, reference, source = chat()
    duplicate = isolated.post("/image-library/import", json=source).json()
    image_generation.OUTPUT_DIR.mkdir()
    (image_generation.OUTPUT_DIR / "original.png").write_bytes(picture())
    headers = auth(isolated)
    locked = isolated.post("/image-library/vault/import", headers=headers, json=source)
    assert locked.status_code == 200, locked.text
    item = locked.json()
    assert image_store.get_bytes(reference) is None
    assert isolated.get("/sessions/images").json()["images"] == []
    assert isolated.get(f"/sessions/{session['id']}/images/by-id/message/image").status_code == 404
    assert isolated.get(f"/sessions/{session['id']}/images/0/0").status_code == 404
    assert isolated.get(duplicate["url"]).status_code == 403
    assert isolated.get("/image-generation/outputs/original.png").status_code == 403
    assert isolated.get("/image-library").json()["images"] == []
    private_url = f"/image-library/vault/images/{item['id']}/content"
    assert isolated.get(private_url).status_code == 401
    assert isolated.get(private_url + "?token=" + headers["Authorization"][7:]).status_code == 401
    response = isolated.get(private_url, headers=headers)
    assert response.content == picture() and response.headers["cache-control"] == "no-store"
    assert isolated.get("/image-library/vault/images").status_code == 401
    for path in vault.ROOT.glob("*"):
        assert b"private-name.png" not in path.read_bytes()
        assert picture() not in path.read_bytes()
    assert b"12345678" not in (vault.ROOT / "vault.json").read_bytes()


def test_restore_unlocks_originals_without_losing_ratings_or_folders(isolated):
    session, reference, source = chat()
    folder = library.folder("Saved")
    copy = library.import_image(picture(), "Named", source, folder["id"])
    library.edit_image(copy["id"], rating="liked", set_rating=True)
    headers = auth(isolated)
    locked = isolated.post("/image-library/vault/import", headers=headers, json=source).json()
    response = isolated.post(f"/image-library/vault/images/{locked['id']}/restore", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["rating"] == "liked" and response.json()["folder_ids"] == [folder["id"]]
    assert image_store.get_bytes(reference)[0] == picture()
    assert len(isolated.get("/sessions/images").json()["images"]) == 1
    assert isolated.get("/image-library/vault/images", headers=headers).json()["images"] == []


def test_pin_wrong_attempts_persist_and_throttle(isolated):
    auth(isolated)
    for _ in range(5): assert isolated.post("/image-library/vault/unlock", json={"pin":"999999"}).status_code == 401
    response = isolated.post("/image-library/vault/unlock", json={"pin":"12345678"})
    assert response.status_code == 401 and "Wait a minute" in response.json()["detail"]
    assert vault.config()["failures"] == 5
    assert isolated.post("/image-library/vault/setup", json={"pin":"999999"}).status_code == 401


def test_relocking_expiration_and_restart_revoke_access(isolated, monkeypatch):
    headers = auth(isolated)
    isolated.post("/image-library/vault/lock")
    assert isolated.get("/image-library/vault/images", headers=headers).status_code == 401
    credentials = isolated.post("/image-library/vault/unlock", json={"pin":"12345678"}).json()
    token = credentials["token"]
    vault.TOKENS[token] = (vault.TOKENS[token][0], 0)
    assert isolated.get("/image-library/vault/images", headers={"Authorization":"Bearer " + token}).status_code == 401
    vault.TOKENS.clear()
    assert isolated.post("/image-library/vault/unlock", json={"pin":"12345678"}).status_code == 200


def test_pin_change_preserves_encrypted_images_and_revokes_old_token(isolated):
    headers = auth(isolated)
    item = vault.add(headers["Authorization"][7:], picture(), "secret.png")
    result = isolated.post("/image-library/vault/pin", headers=headers, json={"old_pin":"12345678", "new_pin":"87654321"})
    assert result.status_code == 200
    assert isolated.get("/image-library/vault/images", headers=headers).status_code == 401
    assert isolated.post("/image-library/vault/unlock", json={"pin":"12345678"}).status_code == 401
    token = isolated.post("/image-library/vault/unlock", json={"pin":"87654321"}).json()["token"]
    assert vault.read_image(token, item["id"])[0] == picture()


def test_locked_workflow_output_blocks_assets_stitches_archives_and_duplicates(isolated):
    workflow = store.create("Private workflow")
    workflow = store.add_asset(workflow.id, workflow.revision, "source.png", picture())
    stage_id = uuid.uuid4().hex
    workflow = store.update(workflow.id, UpdateRequest(revision=workflow.revision, name=workflow.name, stages=[{"id":stage_id,"operation":"upscale","provider_slot":"pillow-lanczos","source":{"kind":"asset","id":workflow.assets[0].id}}]))
    snapshot = store.prepare(workflow.id, workflow.revision)
    output_id = uuid.uuid4().hex; filename = f"outputs/{stage_id}/{output_id}.png"
    store._atomic_bytes(runner._job_dir(workflow.id, snapshot["id"]) / filename, picture())
    record = RunRecord(id=snapshot["id"], workflow_id=workflow.id, request_id=snapshot["id"], status="completed", created_at=store._now(), updated_at=store._now(), seed=1, stage_count=1,
        outputs=[{"id":output_id,"stage_id":stage_id,"filename":filename,"sha256":hashlib.sha256(picture()).hexdigest(),"width":24,"height":16}])
    store._write(runner._job_dir(workflow.id, record.id) / "run.json", record.model_dump())
    exports.stitch(workflow.id, record.id, "row")
    composite_path, _ = exports.stitched_path(workflow.id, record.id, "row")
    copied = library.import_image(composite_path.read_bytes(), "Already stitched.png")
    token = auth(isolated)["Authorization"][7:]
    vault.add(token, picture(), "Locked output")
    with pytest.raises(vault.LockedImageError): runner.output_path(workflow.id, record.id, output_id)
    with pytest.raises(vault.LockedImageError): store.asset_path(workflow.id, workflow.assets[0].id)
    with pytest.raises(vault.LockedImageError): exports.archive(workflow.id, record.id)
    with pytest.raises(vault.LockedImageError): exports.stitched_path(workflow.id, record.id, "row")
    assert isolated.get(copied["url"]).status_code == 403
    assert exports.gallery()["runs"] == []


def test_locked_lora_original_cannot_be_opened(isolated):
    project = lora_store.create_project("Private data")
    data = io.BytesIO(); Image.new("RGB", (128, 128), "red").save(data, "PNG")
    lora_store.add_images(project["id"], [("source.png", data.getvalue())])
    project = lora_store.get_project(project["id"])
    image = project["images"][0]
    path = lora_store.image_path(project["id"], image["id"])
    token = auth(isolated)["Authorization"][7:]
    vault.add(token, path.read_bytes(), "Private dataset")
    with pytest.raises(vault.LockedImageError): lora_store.image_path(project["id"], image["id"])


def test_confined_ids_and_corrupt_policy_fail_closed(isolated):
    assert isolated.post("/image-library/import", json={"kind":"session","session_id":"../../secret"}).status_code == 422
    with pytest.raises(ValueError): library.image_bytes("../outside")
    headers = auth(isolated)
    session, reference, _ = chat()
    (vault.ROOT / "vault.json").write_text("broken")
    assert isolated.get("/image-library/vault/status").status_code == 403
    with pytest.raises(vault.LockedImageError): image_store.get_bytes(reference)
    assert (vault.ROOT / "vault.json").read_text() == "broken"


def test_failed_lock_commit_is_not_shown_as_protected_and_retry_succeeds(isolated, monkeypatch):
    session, reference, source = chat()
    token = auth(isolated)["Authorization"][7:]
    save = vault.save_config
    def fail(value): raise OSError("Disk full")
    monkeypatch.setattr(vault, "save_config", fail)
    with pytest.raises(OSError): vault.add(token, picture(), "Private")
    assert vault.list_images(token) == []
    assert image_store.get_bytes(reference)[0] == picture()
    monkeypatch.setattr(vault, "save_config", save)
    item = vault.add(token, picture(), "Private")
    assert [image["id"] for image in vault.list_images(token)] == [item["id"]]
    assert image_store.get_bytes(reference) is None


def test_unmigrated_locked_inline_payload_never_leaks_in_session_or_export(isolated, monkeypatch):
    session, reference, source = chat()
    token = auth(isolated)["Authorization"][7:]
    vault.add(token, picture(), "Private")
    payload = "data:image/png;base64," + base64.b64encode(picture()).decode()
    path = session_store.SESSIONS_DIR / (session["id"] + ".json")
    legacy = json.loads(path.read_text())
    legacy["messages"][0]["generatedImages"][0]["src"] = payload
    path.write_text(json.dumps(legacy))
    def fail(value): raise OSError("Disk full")
    monkeypatch.setattr(image_store, "put_payload", fail)
    assert isolated.get(f"/sessions/{session['id']}").status_code == 403
    assert isolated.get(f"/export/{session['id']}/json").status_code == 403
    assert json.loads(path.read_text())["messages"][0]["generatedImages"][0]["src"] == payload


def test_atomic_write_retries_windows_sharing_errors_without_losing_old_record(tmp_path, monkeypatch):
    from pathlib import Path
    target = tmp_path / "record.json"
    target.write_bytes(b"old")
    replace, attempts = Path.replace, []
    def transient(path, destination):
        attempts.append(destination)
        if len(attempts) < 3:
            assert target.read_bytes() == b"old"
            raise PermissionError("Sharing violation")
        return replace(path, destination)
    monkeypatch.setattr(Path, "replace", transient)
    monkeypatch.setattr(library.time, "sleep", lambda seconds: None)
    library.atomic(target, b"new")
    assert target.read_bytes() == b"new" and len(attempts) == 3
    assert not list(tmp_path.glob(".pending-*"))


def test_review_upload_separation_includes_old_uploads_and_preserves_duplicate_metadata(isolated):
    image = library.import_image(picture(), "Old upload")
    assert image["review_only"] is True
    face = library.tag("GOOD FACE")
    library.edit_image(image["id"], rating="liked", set_rating=True, caption="A caption", tag_ids=[face["id"]])
    response = isolated.post("/image-library/upload", files={"files": ("again.png", picture(), "image/png")})
    duplicate = response.json()["images"][0]
    assert duplicate["id"] == image["id"] and duplicate["review_only"]
    assert duplicate["annotations"]["caption"] == "A caption"
    assert duplicate["rating"] == "liked" and duplicate["tag_ids"] == [face["id"]]
    source_copy = library.import_image(picture("blue"), "Chat copy", {"kind":"session"})
    assert not source_copy["review_only"]
    uploaded = isolated.post("/image-library/upload", files={"files": ("chat-copy.png", picture("blue"), "image/png")}).json()["images"][0]
    assert uploaded["id"] == source_copy["id"] and uploaded["review_only"]


def test_tags_captions_and_renames_persist_without_changing_image_bytes(isolated):
    item = library.import_image(picture(), "Review")
    face = isolated.post("/image-library/tags", json={"name":" GOOD FACE "}).json()
    light = isolated.post("/image-library/tags", json={"name":"GOOD LIGHTING"}).json()
    endpoint = f"/image-library/images/{item['id']}"
    result = isolated.patch(endpoint, json={"caption":"🌲 Identity notes\nMorning light", "tag_ids":[face["id"],light["id"],face["id"]]})
    assert result.status_code == 200
    assert result.json()["tag_ids"] == [face["id"],light["id"]]
    assert isolated.put(f"/image-library/tags/{face['id']}", json={"name":"GREAT FACE"}).status_code == 200
    assert isolated.post("/image-library/tags", json={"name":"great face"}).status_code == 422
    assert isolated.patch(endpoint, json={"caption":"Should not save", "tag_ids":["unknown"]}).status_code == 422
    saved = isolated.get("/image-library").json()["images"][0]
    assert saved["annotations"]["caption"] == "🌲 Identity notes\nMorning light"
    isolated.delete(f"/image-library/tags/{light['id']}")
    saved = isolated.get("/image-library").json()["images"][0]
    assert saved["tag_ids"] == [face["id"]]
    assert isolated.get(item["url"]).content == picture()
    assert isolated.patch(endpoint, json={"caption":"x" * 10001}).status_code == 422
    assert isolated.patch(endpoint, json={"caption":"", "tag_ids":[]}).json()["annotations"]["caption"] == ""


def test_four_digit_pin_setup_unlock_and_change_preserve_locked_content(isolated):
    assert isolated.post("/image-library/vault/setup", json={"pin":"123"}).status_code == 422
    setup = isolated.post("/image-library/vault/setup", json={"pin":"0123"})
    assert setup.status_code == 200
    token = setup.json()["token"]
    item = vault.add(token, picture(), "Secret")
    isolated.post("/image-library/vault/lock")
    assert isolated.post("/image-library/vault/unlock", json={"pin":"9999"}).status_code == 401
    token = isolated.post("/image-library/vault/unlock", json={"pin":"0123"}).json()["token"]
    result = isolated.post("/image-library/vault/pin", headers={"Authorization":"Bearer " + token}, json={"old_pin":"0123", "new_pin":"4567"})
    assert result.status_code == 200
    assert vault.read_image(result.json()["token"], item["id"])[0] == picture()
    assert isolated.post("/image-library/vault/unlock", json={"pin":"0123"}).status_code == 401


def test_locked_liked_review_image_is_absent_everywhere_and_restores_its_metadata(isolated):
    item = library.import_image(picture(), "Review", {"kind":"review"})
    face = library.tag("GOOD FACE")
    library.edit_image(item["id"], rating="liked", set_rating=True, caption="Private notes", tag_ids=[face["id"]])
    headers = auth(isolated)
    private = isolated.post("/image-library/vault/import", headers=headers, json={"kind":"library", "id":item["id"]}).json()
    assert isolated.get("/image-library").json()["images"] == []
    assert isolated.get(item["url"]).status_code == 403
    assert isolated.patch(f"/image-library/images/{item['id']}", json={"caption":"overwrite"}).status_code == 403
    restored = isolated.post(f"/image-library/vault/images/{private['id']}/restore", headers=headers).json()
    assert restored["review_only"] and restored["rating"] == "liked"
    assert restored["annotations"]["caption"] == "Private notes" and restored["tag_ids"] == [face["id"]]
