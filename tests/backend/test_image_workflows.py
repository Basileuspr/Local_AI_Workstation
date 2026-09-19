"""Model-free workflow contracts. All storage belongs to pytest's temp directory."""

import io
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture
def client(tmp_path, monkeypatch):
    from routes.image_workflows import router
    from services.image_workflows import store, adapters

    monkeypatch.setattr(store, "ROOT", tmp_path / "image_workflows")
    monkeypatch.setattr(adapters, "vision_models", lambda: [])
    monkeypatch.setattr(adapters, "sdxl_models", lambda: [])
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as test_client:
        yield test_client


def create(client):
    response = client.post("/image-workflows", json={"name": "Test scene"})
    assert response.status_code == 201
    return response.json()


def picture():
    payload = io.BytesIO()
    Image.new("RGB", (32, 24), "blue").save(payload, "PNG")
    return payload.getvalue()


def update(client, project, **changes):
    fields = ("name", "scene_notes", "prompt_settings", "stages")
    body = {key: project[key] for key in fields}
    body.update(changes)
    body["revision"] = project["revision"]
    return client.put(f"/image-workflows/{project['id']}", json=body)


def upload(client, project):
    response = client.post(
        f"/image-workflows/{project['id']}/assets",
        data={"revision": project["revision"]},
        files={"file": ("reference.png", picture(), "image/png")},
    )
    assert response.status_code == 201
    return response.json()


def test_catalog_is_read_only_and_exposes_local_providers(client, tmp_path):
    catalog = client.get("/image-workflows/capabilities").json()
    assert catalog["execution_enabled"] is True
    assert {p["id"] for p in catalog["providers"]} == {"local-sdxl", "ollama-vision", "pillow-lanczos"}
    assert {item["id"] for item in catalog["operations"]} == {
        "describe", "txt2img", "img2img", "inpaint", "controlnet", "upscale", "multi_reference"
    }
    assert client.get("/image-workflows").json() == {"workflows": [], "warnings": []}
    assert not (tmp_path / "image_workflows").exists()


def test_create_update_reload_and_revision_guard(client):
    project = create(client)
    changed = update(client, project, name="Renamed", scene_notes="Same coat, next shot")
    assert changed.status_code == 200
    assert changed.json()["revision"] == 2
    assert update(client, project, name="Stale overwrite").status_code == 409
    reloaded = client.get(f"/image-workflows/{project['id']}").json()
    assert reloaded["name"] == "Renamed"
    assert reloaded["scene_notes"] == "Same coat, next shot"


def test_prompt_settings_accept_only_the_five_profile_fields(client):
    project = create(client)
    settings = {"prompt": "A lighthouse", "negative_prompt": "blur", "seed": 7, "steps": 20, "guidance": 4.5}
    saved = update(client, project, prompt_settings=settings)
    assert saved.status_code == 200
    assert saved.json()["prompt_settings"] == settings
    assert update(client, saved.json(), prompt_settings={**settings, "model": "anything"}).status_code == 422


def test_upload_is_verified_owned_and_deduplicated(client, tmp_path):
    project = upload(client, create(client))
    asset = project["assets"][0]
    assert asset["width"] == 32 and asset["height"] == 24
    response = client.get(f"/image-workflows/{project['id']}/assets/{asset['id']}")
    assert response.content == picture()
    assert response.headers["content-type"] == "image/png"
    again = upload(client, project)
    assert len(again["assets"]) == 1
    assert len(list((tmp_path / "image_workflows").rglob("*.png"))) == 1


@pytest.mark.parametrize("name,content", [("fake.png", b"not an image"), ("image.svg", b"<svg/>"), ("image.png", b"")])
def test_invalid_images_never_become_assets(client, name, content):
    project = create(client)
    response = client.post(f"/image-workflows/{project['id']}/assets", data={"revision": 1}, files={"file": (name, content)})
    assert response.status_code == 422
    assert client.get(f"/image-workflows/{project['id']}").json()["assets"] == []


def stage(kind="img2img", **changes):
    return {"id": "a" * 32, "operation": kind, **changes}


def test_preflight_explains_missing_inputs_and_never_runs(client):
    project = create(client)
    project = update(client, project, stages=[stage("inpaint")]).json()
    report = client.post(f"/image-workflows/{project['id']}/preflight", json={"revision": 2}).json()
    codes = {issue["code"] for issue in report["issues"]}
    assert {"provider_unavailable", "source_required", "mask_required"} <= codes
    assert report["ready"] is False
    assert client.post(f"/image-workflows/{project['id']}/execute", json={"revision": 2}).status_code == 422


def test_pipeline_allows_only_earlier_image_outputs(client):
    project = upload(client, create(client))
    asset_id = project["assets"][0]["id"]
    stages = [stage(source={"kind": "asset", "id": asset_id}), stage("upscale", id="b" * 32, source={"kind": "stage", "id": "a" * 32})]
    project = update(client, project, stages=stages).json()
    report = client.post(f"/image-workflows/{project['id']}/preflight", json={"revision": project["revision"]}).json()
    assert report["inputs_valid"] is True
    stages[0]["source"] = {"kind": "stage", "id": "b" * 32}
    project = update(client, project, stages=stages).json()
    report = client.post(f"/image-workflows/{project['id']}/preflight", json={"revision": project["revision"]}).json()
    assert "source_invalid" in {issue["code"] for issue in report["issues"]}


def test_snapshot_is_immutable_and_does_not_create_outputs(client, tmp_path):
    project = create(client)
    project = update(client, project, stages=[stage()]).json()
    job = client.post(f"/image-workflows/{project['id']}/jobs", json={"revision": project["revision"]})
    assert job.status_code == 201
    record = job.json()
    assert record["status"] == "blocked"
    assert record["outputs"] == []
    assert update(client, project, name="Later draft").status_code == 200
    reloaded = client.get(f"/image-workflows/{project['id']}/jobs/{record['id']}").json()
    assert reloaded["snapshot"]["name"] == "Test scene"
    assert not list((tmp_path / "image_workflows").rglob("outputs"))
    assert client.post(f"/image-workflows/{project['id']}/jobs", json={"revision": project["revision"]}).status_code == 409


def test_next_scene_copies_assets_and_records_lineage(client):
    project = upload(client, create(client))
    branch = client.post(f"/image-workflows/{project['id']}/branch", json={"revision": project["revision"]})
    assert branch.status_code == 201
    child = branch.json()
    assert child["parent"] == {"workflow_id": project["id"], "revision": project["revision"]}
    assert child["id"] != project["id"]
    assert client.get(f"/image-workflows/{child['id']}/assets/{child['assets'][0]['id']}").content == picture()


def test_unknown_ids_and_corruption_do_not_overwrite_data(client, tmp_path):
    assert client.get("/image-workflows/not-an-id").status_code == 404
    project = create(client)
    path = tmp_path / "image_workflows" / project["id"] / "workflow.json"
    path.write_text("broken JSON", encoding="utf-8")
    assert client.get(f"/image-workflows/{project['id']}").status_code == 409
    listed = client.get("/image-workflows").json()
    assert listed["workflows"] == [] and len(listed["warnings"]) == 1
    assert update(client, project, name="Must not overwrite").status_code == 409
    assert path.read_text() == "broken JSON"


def test_parallel_saves_reject_one_stale_writer(client):
    project = create(client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(lambda name: update(client, project, name=name).status_code, ["A", "B"]))
    assert sorted(statuses) == [200, 409]


@pytest.mark.parametrize("operation,code", [("controlnet", "control_required"), ("multi_reference", "references_required")])
def test_operation_specific_missing_inputs(client, operation, code):
    project = upload(client, create(client))
    project = update(client, project, stages=[stage(operation, source={"kind": "asset", "id": project["assets"][0]["id"]})]).json()
    report = client.post(f"/image-workflows/{project['id']}/preflight", json={"revision": project["revision"]}).json()
    assert code in {issue["code"] for issue in report["issues"]}


def test_mask_size_and_text_outputs_are_not_image_sources(client):
    project = upload(client, create(client))
    small = io.BytesIO()
    Image.new("L", (8, 8), 255).save(small, "PNG")
    project = client.post(f"/image-workflows/{project['id']}/assets", data={"revision": project["revision"]}, files={"file": ("mask.png", small.getvalue())}).json()
    stages = [stage("inpaint", source={"kind": "asset", "id": project["assets"][0]["id"]}, mask_asset_id=project["assets"][1]["id"])]
    project = update(client, project, stages=stages).json()
    report = client.post(f"/image-workflows/{project['id']}/preflight", json={"revision": project["revision"]}).json()
    assert "mask_size_mismatch" in {item["code"] for item in report["issues"]}
    stages = [stage("describe", source={"kind": "asset", "id": project["assets"][0]["id"]}), stage("img2img", id="b" * 32, source={"kind": "stage", "id": "a" * 32})]
    project = update(client, project, stages=stages).json()
    report = client.post(f"/image-workflows/{project['id']}/preflight", json={"revision": project["revision"]}).json()
    assert "source_invalid" in {item["code"] for item in report["issues"]}


def test_asset_ownership_and_missing_file_validation(client, tmp_path):
    project = upload(client, create(client))
    other = create(client)
    asset = project["assets"][0]
    assert client.get(f"/image-workflows/{other['id']}/assets/{asset['id']}").status_code == 404
    # Delete only pytest-owned bytes to simulate loss outside the app.
    (tmp_path / "image_workflows" / project["id"] / "assets" / f"{asset['id']}{asset['suffix']}").unlink()
    report = client.post(f"/image-workflows/{project['id']}/preflight", json={"revision": project["revision"]}).json()
    assert "asset_missing" in {item["code"] for item in report["issues"]}
    assert client.get(f"/image-workflows/{project['id']}/assets/{asset['id']}").status_code == 404


def test_stale_upload_and_branch_are_rejected(client):
    project = create(client)
    assert update(client, project, name="Changed").status_code == 200
    assert client.post(f"/image-workflows/{project['id']}/assets", data={"revision": 1}, files={"file": ("image.png", picture())}).status_code == 409
    assert client.post(f"/image-workflows/{project['id']}/branch", json={"revision": 1}).status_code == 409


def test_limits_and_filename_paths(client, monkeypatch):
    from services.image_workflows import store

    project = create(client)
    response = client.post(f"/image-workflows/{project['id']}/assets", data={"revision": 1}, files={"file": ("C:\\secret\\..\\reference.png", picture())})
    assert response.status_code == 201
    assert response.json()["assets"][0]["name"] == "reference.png"
    monkeypatch.setattr(store, "MAX_UPLOAD_BYTES", 1)
    assert client.post(f"/image-workflows/{project['id']}/assets", data={"revision": 2}, files={"file": ("too-large.png", picture())}).status_code == 413
    monkeypatch.setattr(store, "MAX_UPLOAD_BYTES", 20 * 1024 * 1024)
    monkeypatch.setattr(store, "MAX_IMAGE_PIXELS", 1)
    assert client.post(f"/image-workflows/{project['id']}/assets", data={"revision": 2}, files={"file": ("too-many-pixels.png", picture())}).status_code == 422


@pytest.mark.parametrize("changes", [{"name": "   "}, {"stages": [stage(), stage()]}, {"stages": [stage("unknown")]}, {"prompt_settings": {"guidance": 100}}, {"assets": []}])
def test_invalid_and_server_owned_fields_are_rejected(client, changes):
    assert update(client, create(client), **changes).status_code == 422


def test_corrupt_snapshot_is_preserved(client, tmp_path):
    project = create(client)
    job = client.post(f"/image-workflows/{project['id']}/jobs", json={"revision": 1}).json()
    path = tmp_path / "image_workflows" / project["id"] / "jobs" / job["id"] / "job.json"
    path.write_text("{}", encoding="utf-8")
    assert client.get(f"/image-workflows/{project['id']}/jobs/{job['id']}").status_code == 409
    assert path.read_text() == "{}"


def test_provider_contract_observes_cancellation(tmp_path):
    from threading import Event
    from services.image_workflows.providers import ExecutionContext, WorkflowCancelled

    event = Event()
    context = ExecutionContext("request", tmp_path, event)
    context.check_cancelled()
    event.set()
    with pytest.raises(WorkflowCancelled):
        context.check_cancelled()
