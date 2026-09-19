import io
import json
import uuid
import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import image_library as library, image_vault as vault
from services.image_workflows import deletion, store, runner
from services.image_workflows.contracts import DeleteWorkflowRequest
from services.request_queue import RequestQueue
from routes.image_workflows import router


def picture(color):
    data = io.BytesIO()
    Image.new("RGB", (24, 24), color).save(data, "PNG")
    return data.getvalue()


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path / "workflows")
    monkeypatch.setattr(library, "ROOT", tmp_path / "library")
    monkeypatch.setattr(vault, "ROOT", tmp_path / "vault")
    monkeypatch.setattr(vault, "TOKENS", {})
    monkeypatch.setattr(deletion, "queue", RequestQueue())
    monkeypatch.setattr(runner.manager, "active", {})
    workflow = store.create("Delete this workflow")
    workflow = store.add_asset(workflow.id, workflow.revision, "reference.png", picture("red"))
    child = store.branch(workflow.id, workflow.revision)
    record = child.model_dump()
    record["assets"][0]["origin"] = {"workflow_id": workflow.id, "job_id": "a" * 32}
    store._write(store._directory(child.id) / "workflow.json", record)
    snapshot = store.prepare(child.id, child.revision)
    exclusive = library.folder("Workflow only")
    shared = library.folder("Shared images")
    origin = {"kind": "workflow", "workflow_id": workflow.id, "job_id": "b" * 32, "output_id": "c" * 32, "folder_id": exclusive["id"]}
    saved = library.import_image(picture("red"), "Saved result", origin, exclusive["id"])
    library.edit_image(saved["id"], rating="liked", set_rating=True, folder_ids=[exclusive["id"], shared["id"]], caption="Keep caption")
    unrelated = library.import_image(picture("blue"), "Unrelated", {"kind": "review"}, shared["id"])
    app = FastAPI(); app.include_router(router)
    with TestClient(app) as client:
        yield {"workflow": workflow, "child": child, "snapshot": snapshot, "saved": saved, "shared": shared, "exclusive": exclusive, "unrelated": unrelated, "client": client, "origin": origin}


def remove(s, token=None):
    workflow = s["workflow"]
    return deletion.delete_many([DeleteWorkflowRequest(id=workflow.id, revision=workflow.revision)], token)


def test_delete_removes_owned_tree_and_global_associations_but_keeps_saved_copies(setup):
    s = setup
    result = remove(s)
    assert result["deleted"] == [s["workflow"].id]
    assert not store._directory(s["workflow"].id).exists()
    index = library.read_index()
    saved = next(item for item in index["images"] if item["id"] == s["saved"]["id"])
    assert saved["origin"] == {"kind": "saved"}
    assert saved["rating"] == "liked" and saved["annotations"]["caption"] == "Keep caption"
    assert saved["folder_ids"] == [s["shared"]["id"]]
    assert [folder["id"] for folder in index["folders"]] == [s["shared"]["id"]]
    assert library.image_bytes(saved["id"])[0] == picture("red")
    assert library.image_bytes(s["unrelated"]["id"])[0] == picture("blue")
    child = store.get(s["child"].id)
    assert child.parent is None and child.assets[0].origin is None
    assert store.asset_path(child.id, child.assets[0].id)[0].exists()
    assert child.revision == s["child"].revision + 1
    snapshot = store.get_job(child.id, s["snapshot"]["id"])
    assert snapshot["snapshot"]["parent"] is None
    assert snapshot["snapshot"]["assets"][0]["origin"] is None
    assert s["client"].get(f'/image-workflows/{s["workflow"].id}').status_code == 404


def test_private_saved_copies_require_pin_and_stay_locked_after_detaching(setup):
    s = setup
    token = vault.setup("1234")["token"]
    private = vault.add(token, picture("red"), "Private result", s["origin"])
    hashes = vault.locked_hashes()
    response = s["client"].request("DELETE", f'/image-workflows/{s["workflow"].id}', json={"revision": s["workflow"].revision})
    assert response.status_code == 423
    assert store.get(s["workflow"].id)
    remove(s, token)
    assert vault.locked_hashes() == hashes
    assert vault.read_image(token, private["id"])[1]["origin"] == {"kind": "saved"}
    assert vault.read_image(token, private["id"])[0] == picture("red")
    assert s["saved"]["id"] not in {item["id"] for item in library.public_index()["images"]}


def test_conflicts_validate_before_any_changes(setup):
    s = setup
    request = DeleteWorkflowRequest(id=s["workflow"].id, revision=1)
    with pytest.raises(store.Conflict): deletion.delete_many([request])
    runner.manager.active[(s["workflow"].id, "preparing")] = None
    with pytest.raises(store.Conflict): remove(s)
    assert library.read_index()["images"][0]["origin"]["workflow_id"] == s["workflow"].id
    assert store.get(s["workflow"].id)


def test_partial_failure_is_visible_and_retryable(setup, monkeypatch):
    s = setup
    original = deletion.shutil.rmtree
    monkeypatch.setattr(deletion.shutil, "rmtree", lambda path: (_ for _ in ()).throw(PermissionError("busy")))
    with pytest.raises(OSError): remove(s)
    with pytest.raises(store.Conflict, match="incomplete"): store.get(s["workflow"].id)
    assert next(item for item in store.list_workflows()["workflows"] if item["id"] == s["workflow"].id)["deletion_pending"]
    monkeypatch.setattr(deletion.shutil, "rmtree", original)
    remove(s)
    assert not store._directory(s["workflow"].id).exists()
    assert library.image_bytes(s["saved"]["id"])


def test_bulk_delete_and_retries_do_not_leave_parent_links(setup):
    s = setup
    requests = [DeleteWorkflowRequest(id=item.id, revision=item.revision) for item in [s["workflow"], s["child"]]]
    result = deletion.delete_many(requests)
    assert set(result["deleted"]) == {item.id for item in requests}
    assert not store.list_workflows()["workflows"]
    assert deletion.delete_many(requests)["deleted"] == result["deleted"]


def test_late_import_cannot_recreate_deleted_workflow_links(setup):
    s = setup
    token = vault.setup("1234")["token"]
    remove(s)
    with pytest.raises(ValueError, match="deleted"):
        library.import_image(picture("green"), "Late copy", s["origin"])
    with pytest.raises(ValueError, match="deleted"):
        vault.add(token, picture("green"), "Late private copy", s["origin"])


def test_nested_link_validation_precedes_mutations(setup, monkeypatch):
    s = setup
    original = store.confined
    def blocked(path):
        if path.suffix == ".png": raise ValueError("linked path")
        return original(path)
    monkeypatch.setattr(store, "confined", blocked)
    with pytest.raises(ValueError, match="linked"): remove(s)
    assert not (store._directory(s["workflow"].id) / "deletion.json").exists()
    assert library.read_index()["images"][0]["origin"]["workflow_id"] == s["workflow"].id


def test_releasing_deletion_token_keeps_other_private_sessions(setup):
    other = vault.setup("1234")["token"]
    temporary = vault.unlock("1234", preserve_sessions=True)["token"]
    vault.revoke(temporary)
    with pytest.raises(vault.PinError): vault.key_for(temporary)
    assert vault.key_for(other)


def test_completed_queue_associations_removed(setup):
    s = setup
    snapshot = store.prepare(s["workflow"].id, s["workflow"].revision)
    job = deletion.queue.enqueue("workflow", "Temporary run", snapshot["id"])
    deletion.queue.finish(job)
    unrelated = deletion.queue.enqueue("chat", "Unrelated", "test-chat")
    deletion.queue.finish(unrelated)
    remove(s)
    assert deletion.queue.jobs == [unrelated]
