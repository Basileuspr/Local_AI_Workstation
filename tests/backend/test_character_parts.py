"""Character curation uses isolated images and fake vision; no model downloads or inference."""
import asyncio
import base64
import hashlib
import io
import json
import zipfile

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from services.character_parts import store, analysis
from services.character_parts.contracts import Analysis, AnalyzeRequest, Selection, StateRequest
from services import image_library, image_vault
from services.request_queue import RequestQueue
from services.gpu_coordination import GpuCoordinator


def picture():
    out = io.BytesIO()
    image = Image.new("RGB", (120, 180), "blue")
    image.paste("red", (30, 36, 90, 144))
    image.save(out, "PNG")
    return out.getvalue()


@pytest.fixture
def dataset(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path / "parts")
    monkeypatch.setattr(image_library, "ROOT", tmp_path / "library")
    monkeypatch.setattr(image_vault, "ROOT", tmp_path / "vault")
    data = store.create("Character training")
    store.import_image(data["id"], picture(), "character.png", {"kind": "upload"})
    return store.read(data["id"])


def region(data, **overrides):
    return Selection(source_id=data["sources"][0]["id"], part="hand", side="left", view="front",
                     box=[.25, .2, .75, .8], caption="Left hand", **overrides)


def test_import_preserves_source_and_deduplicates_across_datasets(dataset):
    other = store.create("Another dataset")
    assert not store.import_image(dataset["id"], picture(), "duplicate.png", {})
    assert store.import_image(other["id"], picture(), "same.png", {})
    assert len(list((store.ROOT / "sources").iterdir())) == 1
    assert store.source_bytes(dataset, dataset["sources"][0]["id"]) == picture()
    assert store.read(dataset["id"]) == dataset


def test_crop_export_and_rejection_preserve_original_and_do_not_duplicate_full_images(dataset):
    data = store.save_selection(dataset["id"], dataset["revision"], region(dataset, state="accepted"))
    second = region(data, state="accepted").model_copy(update={"part": "eye", "caption": "Eye close-up"})
    data = store.save_selection(data["id"], data["revision"], second)
    pending = region(data)
    data = store.save_selection(data["id"], data["revision"], pending)
    archive = store.export_dataset(data["id"])
    with archive, zipfile.ZipFile(archive) as content:
        assert len([name for name in content.namelist() if name.startswith("full_images/") and name.endswith(".png")]) == 1
        crops = [name for name in content.namelist() if name.startswith("crops/") and name.endswith(".png")]
        assert len(crops) == 2
        with Image.open(io.BytesIO(content.read(crops[0]))) as crop:
            assert crop.size == (60, 108)
            assert crop.getpixel((0, 0)) == (255, 0, 0)
        assert len(json.loads(content.read("manifest.json"))["selections"]) == 2
    ids = [item["id"] for item in data["selections"]]
    data = store.set_state(data["id"], StateRequest(revision=data["revision"], ids=ids, state="rejected"))
    assert len(data["selections"]) == 3 and all(item["state"] == "rejected" for item in data["selections"])
    assert store.source_bytes(data, data["sources"][0]["id"]) == picture()
    with pytest.raises(ValueError, match="Accept"):
        store.export_dataset(data["id"])


def test_stale_edits_and_foreign_sources_are_rejected_without_overwrite(dataset):
    data = store.save_selection(dataset["id"], dataset["revision"], region(dataset))
    with pytest.raises(store.Conflict):
        store.save_selection(data["id"], dataset["revision"], region(data))
    with pytest.raises(ValueError, match="belong"):
        store.save_selection(data["id"], data["revision"], region(data).model_copy(update={"source_id": "a" * 64}))
    assert store.read(data["id"]) == data


@pytest.mark.parametrize("box", [[0, 0, 0, 1], [0, .8, 1, .2], [-.1, 0, 1, 1], [0, 0, 1.1, 1], [0, 0, float("nan"), 1]])
def test_invalid_crop_rectangles_are_not_accepted(dataset, box):
    with pytest.raises(ValueError):
        Selection.model_validate({**region(dataset).model_dump(), "box": box})


def test_exif_rotation_uses_visible_dimensions_and_crop_coordinates(dataset):
    original = Image.new("RGB", (120, 80), "blue")
    original.paste("red", (0, 0, 60, 80))
    exif = original.getexif(); exif[274] = 6
    payload = io.BytesIO(); original.save(payload, "JPEG", exif=exif, quality=100)
    store.import_image(dataset["id"], payload.getvalue(), "rotated.jpg", {})
    data = store.read(dataset["id"])
    source = data["sources"][-1]
    assert (source["width"], source["height"]) == (80, 120)
    with Image.open(io.BytesIO(store.render(data, source["id"], [0, 0, 1, .4]))) as crop:
        assert crop.size == (80, 48)
        assert crop.getpixel((40, 20))[0] > 240


def test_locked_or_tampered_sources_cannot_be_viewed_cropped_or_exported(dataset, monkeypatch):
    data = store.save_selection(dataset["id"], dataset["revision"], region(dataset, state="accepted"))
    digest = data["sources"][0]["id"]
    assert store.render(data, digest, thumbnail=True)
    monkeypatch.setattr(image_vault, "is_locked", lambda value: value == digest)
    with pytest.raises(image_vault.LockedImageError): store.render(data, digest)
    with pytest.raises(image_vault.LockedImageError): store.render(data, digest, thumbnail=True)
    with pytest.raises(image_vault.LockedImageError): store.export_dataset(data["id"])
    monkeypatch.setattr(image_vault, "is_locked", lambda value: False)
    (store.ROOT / "sources" / f"{digest}.image").write_bytes(b"changed")
    with pytest.raises(ValueError, match="changed"):
        store.render(data, digest)


def test_analysis_does_not_replace_reviewed_work_or_full_image_caption(dataset):
    data = store.save_selection(dataset["id"], dataset["revision"], region(dataset, state="accepted"))
    data = store.edit_source(data["id"], data["sources"][0]["id"], data["revision"], "User-approved full image caption")
    old = data["selections"][0].copy()
    result = Analysis(caption="Model caption", warnings=["Tiny toes are uncertain"], regions=[
        {"part": "toe", "side": "right", "view": "right_side", "box": [.5, .5, .9, 1], "detail": "big toe"}])
    data = store.add_analysis(data["id"], old["source_id"], result, "local-vision", ["toe"])
    assert data["sources"][0]["caption"] == "User-approved full image caption"
    assert data["selections"][0] == old
    assert data["selections"][1]["state"] == "pending"
    data = store.add_analysis(data["id"], old["source_id"], result, "local-vision", ["toe"])
    assert len(data["selections"]) == 2


def test_structured_local_vision_request_and_incomplete_reply(dataset, monkeypatch):
    completed = True
    def transport(request):
        body = json.loads(request.content)
        if request.url.path == "/api/show": return httpx.Response(200, json={"capabilities": ["vision"]})
        assert body["format"]["type"] == "object"
        assert body["messages"][1]["images"]
        assert "CHARACTER'S own" in body["messages"][0]["content"]
        assert json.loads(body["messages"][1]["content"])["requested_regions"] == {"hand": "Hand"}
        report = {"caption": "Character on a plain background", "regions": [{"part": "hand", "box": [.1, .2, .3, .4]}]}
        return httpx.Response(200, text=json.dumps({"message": {"content": json.dumps(report)}, "done": completed}) + "\n")
    client = httpx.AsyncClient
    monkeypatch.setattr(analysis.httpx, "AsyncClient", lambda **kwargs: client(transport=httpx.MockTransport(transport), **kwargs))
    request = AnalyzeRequest(source_ids=[dataset["sources"][0]["id"]], model="local-vision", parts=["hand"])
    assert asyncio.run(analysis.suggest(dataset, request.source_ids[0], request)).regions[0].part == "hand"
    completed = False
    with pytest.raises(ValueError, match="ended early"):
        asyncio.run(analysis.suggest(dataset, request.source_ids[0], request))


def test_custom_areas_need_a_name_but_can_use_any_valid_rectangle(dataset):
    value = {**region(dataset).model_dump(), "part": "custom", "detail": "  "}
    with pytest.raises(ValueError, match="Name the custom area"):
        Selection.model_validate(value)
    value.update(detail="Hip-to-thigh transition", box=[0, .5, 1, .95])
    selected = Selection.model_validate(value)
    saved = store.save_selection(dataset["id"], dataset["revision"], selected)
    assert saved["selections"][0]["detail"] == "Hip-to-thigh transition"
    assert saved["selections"][0]["state"] == "pending"


def test_focused_vision_sends_reference_crop_then_full_target_and_keeps_coordinates(dataset, monkeypatch):
    reference = region(dataset).model_copy(update={"part": "buttocks", "view": "back"})
    data = store.save_selection(dataset["id"], dataset["revision"], reference)
    selected = data["selections"][0]
    def transport(request):
        if request.url.path == "/api/show": return httpx.Response(200, json={"capabilities": ["vision"]})
        body = json.loads(request.content)
        images = body["messages"][1]["images"]
        assert len(images) == 2
        with Image.open(io.BytesIO(base64.b64decode(images[0]))) as crop:
            assert crop.size == (60, 108) and crop.getpixel((0, 0)) == (255, 0, 0)
        with Image.open(io.BytesIO(base64.b64decode(images[1]))) as full:
            assert full.size == (120, 180)
        focus = json.loads(body["messages"][1]["content"])["focus_reference"]
        assert focus["selection_id"] == selected["id"] and focus["box"] == [.25, .2, .75, .8]
        assert focus["description"] == "Flow into the hips and upper thighs"
        assert "box uses the full dimensions of image 2" in body["messages"][0]["content"]
        result = {"caption": "Target", "regions": [{"part": "buttocks", "view": "back", "box": [.3, .4, .7, .6],
                  "notes": "The target has a similar transition into the upper thighs."}]}
        return httpx.Response(200, text=json.dumps({"message": {"content": json.dumps(result)}, "done": True}) + "\n")
    client = httpx.AsyncClient
    monkeypatch.setattr(analysis.httpx, "AsyncClient", lambda **kwargs: client(transport=httpx.MockTransport(transport), **kwargs))
    request = AnalyzeRequest(source_ids=[selected["source_id"]], model="local-vision", parts=["buttocks"],
                             reference_selection_id=selected["id"], focus_description="Flow into the hips and upper thighs")
    result = asyncio.run(analysis.suggest(data, selected["source_id"], request))
    assert result.regions[0].box == (.3, .4, .7, .6)
    assert "transition" in result.regions[0].notes


def test_focus_provenance_survives_review_and_custom_names_stay_consistent(dataset):
    selected = region(dataset).model_copy(update={"part": "custom", "detail": "Hip transition"})
    data = store.save_selection(dataset["id"], dataset["revision"], selected)
    reference = data["selections"][0].copy()
    request = AnalyzeRequest(source_ids=[reference["source_id"]], model="local", parts=["custom"], reference_selection_id=reference["id"])
    focus = analysis.reference_focus(data, request)
    result = Analysis(caption="Whole image", regions=[{"part": "custom", "detail": "Model renamed it", "box": [.3, .4, .7, .6], "notes": "Same flow"}])
    data = store.add_analysis(data["id"], reference["source_id"], result, "local", ["custom"], focus)
    candidate = data["selections"][-1]
    assert candidate["detail"] == "Hip transition" and candidate["state"] == "pending"
    assert candidate["focus"]["selection_id"] == reference["id"]
    assert data["selections"][0] == reference
    data = store.add_analysis(data["id"], reference["source_id"], result, "local", ["custom"], focus)
    assert len(data["selections"]) == 2
    updated = {**candidate, "state": "accepted", "notes": "Reviewed comparison"}
    editable = Selection.model_validate({key: updated[key] for key in Selection.model_fields})
    data = store.save_selection(data["id"], data["revision"], editable, candidate["id"])
    assert data["selections"][-1]["focus"] == focus
    archive = store.export_dataset(data["id"])
    with archive, zipfile.ZipFile(archive) as content:
        manifest = json.loads(content.read("manifest.json"))
        assert manifest["selections"][0]["focus"] == focus


def test_invalid_or_locked_focus_is_rejected_before_queueing(dataset, monkeypatch):
    data = store.save_selection(dataset["id"], dataset["revision"], region(dataset))
    selected = data["selections"][0]
    manager = analysis.Analyzer()
    request = AnalyzeRequest(source_ids=[selected["source_id"]], model="local", parts=["hand"], reference_selection_id="a" * 32)
    with pytest.raises(ValueError, match="Selection no longer exists"):
        manager.start(data["id"], request)
    request = request.model_copy(update={"reference_selection_id": selected["id"], "parts": ["buttocks"]})
    with pytest.raises(ValueError, match="same region"):
        manager.start(data["id"], request)
    request = request.model_copy(update={"reference_selection_id": None, "parts": ["custom"]})
    with pytest.raises(ValueError, match="Draw and name"):
        manager.start(data["id"], request)
    request = request.model_copy(update={"reference_selection_id": selected["id"], "parts": ["hand"]})
    monkeypatch.setattr(image_vault, "is_locked", lambda value: value == selected["source_id"])
    with pytest.raises(image_vault.LockedImageError):
        manager.start(data["id"], request)
    assert manager.task is None


def test_queue_cancellation_retains_gpu_until_inference_and_cleanup_exit(dataset, monkeypatch):
    fifo = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(analysis, "queue", fifo)
    async def prepared(_kind): pass
    monkeypatch.setattr(analysis, "prepare_runtime", prepared)
    async def scenario():
        entered, cleanup_started, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
        async def slow(*args):
            entered.set()
            await asyncio.Event().wait()
        async def cleanup(_model):
            cleanup_started.set()
            await release.wait()
        monkeypatch.setattr(analysis, "suggest", slow)
        monkeypatch.setattr(analysis, "unload_model", cleanup)
        manager = analysis.Analyzer()
        request = AnalyzeRequest(source_ids=[dataset["sources"][0]["id"]], model="local", parts=["hand"])
        manager.start(dataset["id"], request)
        await asyncio.wait_for(entered.wait(), 2)
        stopping = asyncio.create_task(manager.stop())
        await asyncio.wait_for(cleanup_started.wait(), 2)
        assert fifo.coordinator.current_owner() and not stopping.done()
        release.set(); await asyncio.wait_for(stopping, 2)
        assert fifo.coordinator.current_owner() is None and fifo.active is None
        assert manager.status(dataset["id"])["status"] == "cancelled"
        assert store.read(dataset["id"])["selections"] == []
    asyncio.run(scenario())


def test_queued_stop_never_runs_vision_and_startup_recovers_interrupted_jobs(dataset, monkeypatch):
    fifo = RequestQueue(GpuCoordinator()); fifo.paused = True
    monkeypatch.setattr(analysis, "queue", fifo)
    async def forbidden(*args): pytest.fail("Queued cancellation ran inference")
    monkeypatch.setattr(analysis, "suggest", forbidden)
    async def scenario():
        manager = analysis.Analyzer()
        manager.start(dataset["id"], AnalyzeRequest(source_ids=[dataset["sources"][0]["id"]], model="local", parts=["foot"]))
        await manager.stop()
        assert manager.status(dataset["id"])["status"] == "cancelled"
        manager.publish(status="running")
        recovered = analysis.Analyzer(); recovered.recover()
        assert recovered.status(dataset["id"])["status"] == "interrupted"
    asyncio.run(scenario())


def test_http_import_edit_export_and_validation(dataset, monkeypatch):
    from routes import character_parts as routes
    monkeypatch.setattr(routes, "analyzer", analysis.Analyzer())
    monkeypatch.setattr(routes, "vision_models", lambda: [])
    app = FastAPI(); app.include_router(routes.router)
    with TestClient(app) as client:
        base = f"/character-parts/datasets/{dataset['id']}"
        catalog = client.get("/character-parts/catalog").json()
        assert {"body", "arm", "leg", "hand", "foot", "finger", "toe", "eye", "mouth"} <= set(catalog["parts"])
        assert {"front", "back", "left_side", "right_side", "left_three_quarter", "right_three_quarter"} <= set(catalog["views"])
        assert client.post(base + "/import", json={"sources": [{"kind": "url", "url": "file:///secret"}]}).status_code == 422
        uploaded = client.post(base + "/upload", files=[("files", ("bad.png", b"bad", "image/png")), ("files", ("good.png", picture(), "image/png"))])
        assert uploaded.status_code == 200 and len(uploaded.json()["errors"]) == 1
        body = {"revision": dataset["revision"], "selection": region(dataset, state="accepted").model_dump()}
        added = client.post(base + "/selections", json=body)
        assert added.status_code == 200, added.text
        assert client.post(base + "/selections", json=body).status_code == 409
        selection = added.json()["selections"][0]
        assert client.get(base + f"/selections/{selection['id']}/crop").status_code == 200
        archive = client.get(base + "/export")
        assert archive.status_code == 200
        assert "manifest.json" in zipfile.ZipFile(io.BytesIO(archive.content)).namelist()


def test_export_scopes_are_exact_and_preserve_review_states(dataset):
    data = dataset
    for state in ("accepted", "rejected", "pending"):
        data = store.save_selection(data["id"], data["revision"], region(data, state=state))
    before = store.read(data["id"])
    chosen = [item["id"] for item in data["selections"] if item["state"] != "accepted"]
    for scope, ids, expected in [("approved", [], {"accepted"}), ("rejected", [], {"rejected"}), ("selected", chosen, {"rejected", "pending"})]:
        archive = store.export_dataset(data["id"], scope, ids, data["revision"])
        with archive, zipfile.ZipFile(archive) as zipped:
            manifest = json.loads(zipped.read("manifest.json"))
            assert manifest["export_scope"] == scope
            assert {item["state"] for item in manifest["selections"]} == expected
            assert len([name for name in zipped.namelist() if name.startswith("full_images/") and name.endswith(".png")]) == 1
            assert len([name for name in zipped.namelist() if name.startswith("crops/") and name.endswith(".png")]) == len(expected)
    assert store.read(data["id"]) == before
    assert store.source_bytes(data, data["sources"][0]["id"]) == picture()


def test_export_rejects_stale_empty_foreign_and_locked_selections(dataset, monkeypatch):
    data = store.save_selection(dataset["id"], dataset["revision"], region(dataset, state="rejected"))
    selection_id = data["selections"][0]["id"]
    with pytest.raises(store.Conflict):
        store.export_dataset(data["id"], "rejected", [], dataset["revision"])
    for ids in ([], ["f" * 32], [selection_id, "f" * 32]):
        with pytest.raises(ValueError, match="Choose selections"):
            store.export_dataset(data["id"], "selected", ids)
    monkeypatch.setattr(image_vault, "is_locked", lambda _: True)
    for scope, ids in (("rejected", []), ("selected", [selection_id])):
        with pytest.raises(image_vault.LockedImageError):
            store.export_dataset(data["id"], scope, ids)


def test_http_explicit_media_exports_and_validation(dataset, monkeypatch):
    from routes import character_parts as routes
    monkeypatch.setattr(routes, "analyzer", analysis.Analyzer())
    data = store.save_selection(dataset["id"], dataset["revision"], region(dataset, state="rejected"))
    app = FastAPI(); app.include_router(routes.router)
    with TestClient(app) as client:
        url = f"/character-parts/datasets/{data['id']}/export"
        request = {"scope": "rejected", "revision": data["revision"]}
        exported = client.post(url, json=request)
        assert exported.status_code == 200
        assert 'character-rejected-media.zip' in exported.headers['Content-Disposition']
        with zipfile.ZipFile(io.BytesIO(exported.content)) as zipped:
            assert json.loads(zipped.read('manifest.json'))['selections'][0]['state'] == 'rejected'
        assert client.post(url, json={**request, "revision": dataset["revision"]}).status_code == 409
        assert client.post(url, json={**request, "scope": "selected", "ids": []}).status_code == 400
        assert client.post(url, json={**request, "scope": "selected", "ids": ["../x"]}).status_code == 422
        assert client.post(url, json={**request, "scope": "everything"}).status_code == 422
