"""Exports use isolated owned runs; no inference or live user data."""
import hashlib
import io
import json
import uuid
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from routes.image_workflows import router
from services.image_workflows import exports, runner, store
from services.image_workflows.contracts import RunRecord, UpdateRequest


@pytest.fixture
def saved_run(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path / "workflows")
    workflow = store.create("Progressive scene")
    stages = [{"id": uuid.uuid4().hex, "operation": "upscale"} for _ in range(3)]
    workflow = store.update(workflow.id, UpdateRequest(revision=workflow.revision, name=workflow.name, stages=stages))
    snapshot = store.prepare(workflow.id, workflow.revision)
    outputs = []
    for number, (stage, color, size) in enumerate(zip(stages, ["red", "green", "blue"], [(80, 40), (40, 80), (80, 80)]), 1):
        output_id = uuid.uuid4().hex
        data = io.BytesIO()
        Image.new("RGB", size, color).save(data, "PNG")
        name = f"outputs/{stage['id']}/{output_id}.png"
        store._atomic_bytes(runner._job_dir(workflow.id, snapshot["id"]) / name, data.getvalue())
        outputs.append({"id": output_id, "stage_id": stage["id"], "filename": name,
                        "sha256": hashlib.sha256(data.getvalue()).hexdigest(), "width": size[0], "height": size[1]})
    record = RunRecord(id=snapshot["id"], workflow_id=workflow.id, request_id=snapshot["id"],
                       created_at=store._now(), updated_at=store._now(), status="completed", seed=42,
                       stage_count=3, outputs=list(reversed(outputs)))
    store._write(runner._job_dir(workflow.id, record.id) / "run.json", record.model_dump())
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        yield workflow, record.id, outputs, client


def test_zip_retains_original_bytes_and_snapshot_order(saved_run):
    workflow, job, outputs, client = saved_run
    response = client.get(f"/image-workflows/{workflow.id}/jobs/{job}/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["access-control-expose-headers"] == "Content-Disposition"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == [f"stage-{i:02d}-{output['id'][:8]}.png" for i, output in enumerate(outputs, 1)] + ["workflow-manifest.json"]
        for name, output in zip(archive.namelist(), outputs):
            assert hashlib.sha256(archive.read(name)).hexdigest() == output["sha256"]
        manifest = json.loads(archive.read("workflow-manifest.json"))
        assert manifest["run"]["seed"] == 42
        assert manifest["snapshot"] == store.get_job(workflow.id, job)
    assert store.get(workflow.id).revision == workflow.revision
    assert runner.read_run(workflow.id, job)["accepted_output_ids"] == []


@pytest.mark.parametrize("layout,centers", [
    ("row", [(48, 48), (136, 48), (224, 48)]),
    ("column", [(48, 48), (48, 160), (48, 272)]),
    ("grid", [(48, 48), (136, 48), (48, 160)]),
])
def test_stitch_order_aspect_ratio_metadata_and_download(saved_run, layout, centers):
    workflow, job, outputs, client = saved_run
    url = f"/image-workflows/{workflow.id}/jobs/{job}/stitched/{layout}"
    response = client.post(url)
    assert response.status_code == 200
    metadata = response.json()
    download = client.get(url + "?download=true")
    assert download.status_code == 200 and "attachment" in download.headers["content-disposition"]
    with Image.open(io.BytesIO(download.content)) as image:
        assert image.size == (metadata["width"], metadata["height"])
        assert [image.getpixel(center) for center in centers] == [(255, 0, 0), (0, 128, 0), (0, 0, 255)]
        assert image.getpixel((9, 9)) == (23, 27, 36)  # landscape source is letterboxed, not stretched
        provenance = json.loads(image.info["workflow"])
        assert [o["id"] for o in provenance["outputs"]] == [o["id"] for o in outputs]
        assert provenance["job_id"] == job
    assert client.post(url).json() == metadata  # stable cache, no duplicates
    assert len(store.get(workflow.id).assets) == 0


def test_kept_composite_is_revision_checked_deduplicated_and_branches(saved_run):
    workflow, job, _, client = saved_run
    url = f"/image-workflows/{workflow.id}/jobs/{job}/stitched/grid"
    assert client.post(url).status_code == 200
    response = client.post(url + "/accept", json={"revision": workflow.revision})
    assert response.status_code == 200
    kept = response.json()
    assert kept["assets"][0]["origin"] == {"workflow_id": workflow.id, "job_id": job, "kind": "stitched", "layout": "grid"}
    assert client.post(url + "/accept", json={"revision": workflow.revision}).status_code == 409
    assert client.post(url + "/accept", json={"revision": kept["revision"]}).json() == kept
    branch = store.branch(workflow.id, kept["revision"])
    path, _ = store.asset_path(branch.id, kept["assets"][0]["id"])
    assert path.is_file() and branch.assets[0].origin["job_id"] == job


@pytest.mark.parametrize("status", ["queued", "running", "cancelling"])
def test_unfinished_runs_are_not_gallery_entries_or_exports(saved_run, status):
    workflow, job, _, client = saved_run
    runner._patch(workflow.id, job, status=status)
    assert client.get("/image-workflows/images").json()["runs"] == []
    base = f"/image-workflows/{workflow.id}/jobs/{job}"
    assert client.get(base + "/download").status_code == 409
    assert client.post(base + "/stitched/grid").status_code == 409


@pytest.mark.parametrize("status", ["cancelled", "failed", "interrupted"])
def test_terminal_runs_keep_committed_images_reviewable_and_exportable(saved_run, status):
    workflow, job, outputs, client = saved_run
    runner._patch(workflow.id, job, status=status)
    gallery = client.get("/image-workflows/images").json()["runs"]
    assert len(gallery) == 1 and gallery[0]["status"] == status
    assert len(gallery[0]["outputs"]) == len(outputs)
    base = f"/image-workflows/{workflow.id}/jobs/{job}"
    assert client.get(base + "/download").status_code == 200
    assert client.post(base + "/stitched/grid").status_code == 200


def test_gallery_includes_old_runs_and_composites_without_touching_drafts(saved_run):
    workflow, job, outputs, client = saved_run
    before = store.get(workflow.id).model_dump()
    gallery = client.get("/image-workflows/images").json()
    assert len(gallery["runs"]) == 1 and not gallery["warnings"]
    assert [image["id"] for image in gallery["runs"][0]["outputs"]] == [o["id"] for o in outputs]
    assert not gallery["runs"][0]["composites"]
    exports.stitch(workflow.id, job, "row")
    gallery = client.get("/image-workflows/images").json()
    composite = gallery["runs"][0]["composites"][0]
    assert composite["layout"] == "row" and client.get(composite["url"]).status_code == 200
    assert store.get(workflow.id).model_dump() == before


def test_changed_missing_and_corrupt_files_are_reported(saved_run):
    workflow, job, outputs, client = saved_run
    exports.stitch(workflow.id, job, "grid")
    path, _ = runner.output_path(workflow.id, job, outputs[0]["id"])
    path.write_bytes(b"changed")
    base = f"/image-workflows/{workflow.id}/jobs/{job}"
    assert client.get(base + "/download").status_code == 409
    assert client.post(base + "/stitched/grid").status_code == 409
    composite, _ = exports.stitched_path(workflow.id, job, "grid")
    composite.write_bytes(b"changed")
    assert client.get(base + "/stitched/grid").status_code == 409
    composite.unlink()
    assert client.get("/image-workflows/images").json()["warnings"]
    run_path = runner._job_dir(workflow.id, job) / "run.json"
    run_path.write_bytes(b"broken json")
    assert client.get("/image-workflows/images").json()["warnings"]
    assert run_path.read_bytes() == b"broken json"


def test_empty_runs_bad_layouts_and_foreign_ids(saved_run):
    workflow, job, _, client = saved_run
    base = f"/image-workflows/{workflow.id}/jobs/{job}"
    assert client.post(base + "/stitched/invalid").status_code == 422
    assert client.get(base.replace(workflow.id, "a" * 32) + "/download").status_code == 404
    runner._patch(workflow.id, job, outputs=[])
    assert client.get(base + "/download").status_code == 422
    assert client.post(base + "/stitched/grid").status_code == 422
    assert client.get("/image-workflows/images").json()["runs"] == []


@pytest.mark.parametrize("layout", ["row", "column", "grid"])
def test_composite_canvas_is_bounded_for_many_large_stages(layout):
    _, _, _, size = exports._canvas_size([{"width": 12000, "height": 2000}] * 24, layout)
    assert size[0] * size[1] <= store.MAX_IMAGE_PIXELS
    assert max(size) <= 16384


def test_png_size_limit_is_applied_before_reference_import(saved_run, monkeypatch):
    workflow, job, _, _ = saved_run
    monkeypatch.setattr(store, "MAX_UPLOAD_BYTES", 3000)
    metadata = exports.stitch(workflow.id, job, "grid")
    assert metadata["size_bytes"] <= 3000
    kept = exports.accept_stitched(workflow.id, job, "grid", workflow.revision)
    assert kept.assets[0].size_bytes <= 3000
