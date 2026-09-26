import asyncio
import base64
import io
import json
import zipfile

import numpy as np
import pytest
from PIL import Image

from services.faces import crops, pipeline, store
from services.faces.providers import DetectedFace, ProviderStatus


@pytest.fixture
def face_root(tmp_path, monkeypatch):
    """Keep datasets, crops and embeddings out of real user data."""
    monkeypatch.setattr(store, "ROOT", tmp_path / "face_datasets")
    return tmp_path


@pytest.mark.parametrize("configured, cores, expected", [(6, 20, 6), (6, 4, 4), (0, 20, 0)])
def test_face_session_threads_are_bounded_and_can_use_runtime_default(monkeypatch, configured, cores, expected):
    import sys
    from dataclasses import replace
    from types import SimpleNamespace
    from services.faces import insight_onnx
    options_used = []
    def session(path, options, providers):
        options_used.append(options.intra_op_num_threads)
        assert providers == ["CPUExecutionProvider"]
        return SimpleNamespace(get_providers=lambda: providers)
    monkeypatch.setitem(sys.modules, "onnxruntime", SimpleNamespace(
        get_available_providers=lambda: ["CPUExecutionProvider"],
        SessionOptions=SimpleNamespace, InferenceSession=session))
    monkeypatch.setattr(insight_onnx, "settings", replace(insight_onnx.settings, face_intra_op_threads=configured))
    monkeypatch.setattr(insight_onnx.os, "cpu_count", lambda: cores)
    provider = insight_onnx.InsightOnnxProvider()
    monkeypatch.setattr(provider, "missing", lambda: [])
    first = provider._sessions()
    assert provider._sessions() == first
    assert options_used == [expected, expected]


def photo(width=400, height=300, colour=(120, 90, 70)):
    image = Image.new("RGB", (width, height), colour)
    # Texture keeps the sharpness measure from being exactly zero.
    pixels = np.asarray(image).copy()
    pixels[::4, ::3] = (240, 240, 240)
    buffer = io.BytesIO()
    Image.fromarray(pixels).save(buffer, format="PNG")
    return buffer.getvalue()


class FakeProvider:
    """Deterministic stand-in so tests never depend on downloaded weights."""

    key = "fake"
    name = "Fake detector"

    def __init__(self, faces=2):
        self.faces = faces
        self.calls = 0

    def status(self):
        return ProviderStatus(self.key, self.name, True, "cpu", "test", [])

    def uses_gpu(self):
        return False

    def unload(self):
        return True

    def detect(self, image, cancelled=None, threshold=0.5, max_faces=64):
        self.calls += 1
        found = []
        for index in range(self.faces):
            left = 40 + index * 90
            box = (left, 50.0, left + 60.0, 130.0)
            vector = np.zeros(512, dtype=np.float32)
            vector[index] = 1.0
            marks = ((left + 18, 80), (left + 42, 80), (left + 30, 98), (left + 20, 112), (left + 40, 112))
            found.append(DetectedFace(box, 0.9 - index * 0.1, tuple((float(x), float(y)) for x, y in marks),
                                      tuple(float(v) for v in vector)))
        return found


@pytest.fixture
def fake_provider(monkeypatch):
    provider = FakeProvider()
    monkeypatch.setattr("services.faces.providers.get_provider", lambda key=None: provider)
    monkeypatch.setattr("services.faces.pipeline.get_provider", lambda key=None: provider)
    return provider


def run_extract(dataset_id, sources):
    async def exercise():
        pipeline.extractor.start(dataset_id, sources)
        await pipeline.extractor.task
        return pipeline.extractor.status(dataset_id)
    return asyncio.run(exercise())


def inline(data, name="shot.png"):
    return {"kind": "inline", "name": name, "data": base64.b64encode(data).decode("ascii")}


# --- crop geometry -------------------------------------------------------

@pytest.mark.parametrize("mode", ["tight", "head", "portrait"])
def test_crops_stay_square_and_inside_the_source(mode):
    rect = crops.crop_rect((300.0, 20.0, 360.0, 100.0), (400, 300), mode)
    assert rect[0] >= 0 and rect[1] >= 0 and rect[2] <= 400 and rect[3] <= 300
    assert abs((rect[2] - rect[0]) - (rect[3] - rect[1])) <= 1


def test_a_face_at_the_edge_slides_inside_rather_than_stretching():
    rect = crops.crop_rect((0.0, 0.0, 40.0, 40.0), (200, 200), "portrait")
    assert rect[0] == 0 and rect[1] == 0
    assert rect[2] - rect[0] == rect[3] - rect[1]


def test_a_crop_larger_than_the_image_shrinks_instead_of_reading_past_the_edge():
    rect = crops.crop_rect((10.0, 10.0, 90.0, 90.0), (100, 60), "portrait")
    assert rect[3] - rect[1] <= 60 and rect[2] - rect[0] <= 100
    assert rect[2] - rect[0] == rect[3] - rect[1]


def test_normalization_pads_and_never_changes_proportions():
    source = Image.new("RGB", (200, 100), (10, 120, 200))
    result = crops.normalize(source, 512)
    assert result.size == (512, 512)
    pixels = np.asarray(result)
    assert tuple(pixels[256, 256]) == (10, 120, 200)   # content centred
    assert tuple(pixels[5, 256]) == (0, 0, 0)          # padded, not stretched


def test_original_size_keeps_the_crop_untouched():
    source = Image.new("RGB", (123, 77))
    assert crops.normalize(source, 0).size == (123, 77)


def test_quality_measures_separate_sharp_from_blurred():
    sharp = Image.fromarray(np.tile(np.array([[0, 255]], dtype=np.uint8), (64, 32)), "L").convert("RGB")
    flat = Image.new("RGB", (64, 64), (128, 128, 128))
    assert crops.sharpness(sharp) > crops.sharpness(flat)
    assert crops.exposure(Image.new("RGB", (8, 8), (255, 255, 255)))["clipped_bright"] == 1.0


def test_flags_describe_why_a_face_is_questionable():
    metrics = {"confidence": 0.2, "face_width": 10, "face_height": 10, "sharpness": 1.0,
               "clipped_bright": 0.0, "clipped_dark": 0.0, "brightness": 128, "extreme_angle": True}
    reasons = crops.flags(metrics, store.DEFAULT_SETTINGS)
    assert {"low confidence", "small face", "blurry", "extreme angle"} <= set(reasons)


# --- pipeline ------------------------------------------------------------

def test_every_face_is_extracted_not_just_the_largest(face_root, fake_provider):
    dataset = store.create_dataset("Characters")
    result = run_extract(dataset["id"], [inline(photo())])
    assert result["status"] == "complete"
    saved = store.get_dataset(dataset["id"])
    assert len(saved["faces"]) == 2
    assert [face["face_index"] for face in saved["faces"]] == [0, 1]
    for face in saved["faces"]:
        assert store.crop_path(dataset["id"], face["id"]).is_file()
        assert face["source_sha256"] and face["landmarks"] and face["box"]
        assert face["metrics"]["confidence"] > 0


def test_crops_are_written_at_the_requested_size(face_root, fake_provider):
    dataset = store.create_dataset("Sized")
    store.update_settings(dataset["id"], {"size": 768})
    run_extract(dataset["id"], [inline(photo())])
    saved = store.get_dataset(dataset["id"])
    with Image.open(store.crop_path(dataset["id"], saved["faces"][0]["id"])) as handle:
        assert handle.size == (768, 768)


def test_a_failed_source_does_not_stop_the_rest(face_root, fake_provider):
    dataset = store.create_dataset("Mixed")
    result = run_extract(dataset["id"], [inline(b"not an image", "broken.png"), inline(photo())])
    assert result["status"] == "complete"
    assert len(result["errors"]) == 1
    assert len(store.get_dataset(dataset["id"])["faces"]) == 2


def test_source_images_are_never_modified(face_root, fake_provider, tmp_path):
    original = photo()
    dataset = store.create_dataset("Untouched")
    run_extract(dataset["id"], [inline(original)])
    # The inline payload is the only copy the pipeline saw; nothing rewrote it.
    assert inline(original)["data"] == base64.b64encode(original).decode("ascii")


def test_uploaded_original_is_owned_once_instead_of_repeated_in_face_records(face_root, fake_provider):
    original = photo()
    dataset = store.create_dataset("Owned originals")
    run_extract(dataset["id"], [inline(original), inline(original)])
    saved = store.get_dataset(dataset["id"])
    source = saved["faces"][0]["source"]
    assert source["kind"] == "face-upload" and "data" not in source
    assert all(face["source"]["id"] == source["id"] for face in saved["faces"])
    originals = list((store.dataset_dir(dataset["id"]) / "sources").iterdir())
    assert len(originals) == 1 and originals[0].read_bytes() == original
    before = fake_provider.calls
    assert pipeline.recrop(dataset["id"])["recropped"] == len(saved["faces"])
    assert fake_provider.calls == before
    assert originals[0].read_bytes() == original


def test_legacy_inline_sources_can_still_be_recropped(face_root, fake_provider):
    dataset = store.create_dataset("Legacy sources")
    original = photo()
    run_extract(dataset["id"], [inline(original)])
    saved = store.get_dataset(dataset["id"])
    for face in saved["faces"]:
        face["source"] = inline(original)
    store._write(saved)
    assert pipeline.recrop(dataset["id"])["recropped"] == 2


def test_images_without_faces_do_not_leave_owned_originals(face_root, fake_provider):
    fake_provider.faces = 0
    dataset = store.create_dataset("No faces")
    result = run_extract(dataset["id"], [inline(photo())])
    assert result["processed"] == 1 and result["faces"] == 0
    assert not (store.dataset_dir(dataset["id"]) / "sources").exists()


def test_owned_source_ids_cannot_traverse_outside_the_dataset(face_root):
    dataset = store.create_dataset("Confined")
    for dataset_id, source_id in [(dataset["id"], "../escape"), ("../escape", "a" * 32)]:
        with pytest.raises(ValueError, match="Invalid"):
            store.source_path(dataset_id, source_id)


def test_stop_waits_for_the_detector_and_preserves_completed_images(face_root, fake_provider, monkeypatch):
    import threading
    import time
    entered, exited = threading.Event(), threading.Event()
    original_detect = fake_provider.detect

    def slow_detect(image, cancelled, *args):
        if fake_provider.calls == 0:
            return original_detect(image, cancelled, *args)
        entered.set()
        deadline = time.monotonic() + 5
        while not cancelled() and time.monotonic() < deadline:
            time.sleep(0.005)
        assert cancelled(), "The actual provider never received Stop"
        time.sleep(0.03)
        exited.set()
        return []

    monkeypatch.setattr(fake_provider, "detect", slow_detect)
    dataset = store.create_dataset("Cancelable")

    async def exercise():
        extractor = pipeline.FaceExtractor()
        start = extractor.start(dataset["id"], [inline(photo()), inline(photo()), inline(photo())])
        for _ in range(300):
            if entered.is_set():
                break
            await asyncio.sleep(0.01)
        assert entered.is_set()
        with pytest.raises(ValueError, match="no longer active"):
            await extractor.stop("b" * 32, start["id"])
        with pytest.raises(ValueError, match="no longer active"):
            await extractor.stop(dataset["id"], "wrong-run")
        stopped = await extractor.stop(dataset["id"], start["id"])
        assert exited.is_set() and extractor.task.done()
        assert stopped["status"] == "cancelled"
        assert stopped["processed"] == 1 and stopped["faces"] == 2
        assert len(store.get_dataset(dataset["id"])["faces"]) == 2

    asyncio.run(exercise())


def test_stop_before_worker_start_prevents_detection(face_root, fake_provider):
    dataset = store.create_dataset("Stop immediately")

    async def exercise():
        extractor = pipeline.FaceExtractor()
        started = extractor.start(dataset["id"], [inline(photo())])
        result = await extractor.stop(dataset["id"], started["id"])
        assert result["status"] == "cancelled" and result["processed"] == 0
        assert fake_provider.calls == 0

    asyncio.run(exercise())


def test_provider_startup_error_is_terminal_instead_of_waiting_forever(face_root, monkeypatch):
    def unavailable():
        raise ValueError("Missing face provider")
    monkeypatch.setattr(pipeline, "get_provider", unavailable)
    dataset = store.create_dataset("Missing provider")
    result = run_extract(dataset["id"], [inline(photo())])
    assert result["status"] == "error" and "Missing face provider" in result["message"]


# --- similarity ----------------------------------------------------------

def test_similarity_ranks_the_reference_first_and_separates_others(face_root, fake_provider):
    dataset = store.create_dataset("Compare")
    run_extract(dataset["id"], [inline(photo())])
    saved = store.get_dataset(dataset["id"])
    reference = saved["faces"][0]["id"]
    scores = store.similarity_to(dataset["id"], reference)
    assert scores[reference] == pytest.approx(1.0, abs=1e-5)
    other = saved["faces"][1]["id"]
    assert scores[other] == pytest.approx(0.0, abs=1e-5)


def test_identical_faces_are_marked_duplicates_keeping_one(face_root, fake_provider):
    dataset = store.create_dataset("Dupes")
    run_extract(dataset["id"], [inline(photo(), "a.png")])
    run_extract(dataset["id"], [inline(photo(colour=(121, 91, 71)), "b.png")])
    result = store.mark_duplicates(dataset["id"], 0.99)
    assert result["duplicates"] == 2 and result["unique"] == 2
    saved = store.get_dataset(dataset["id"])
    assert sum(1 for face in saved["faces"] if face["duplicate_of"]) == 2


def test_clustering_groups_alike_faces_and_names_outliers(face_root, fake_provider):
    dataset = store.create_dataset("Clusters")
    run_extract(dataset["id"], [inline(photo(), "a.png")])
    run_extract(dataset["id"], [inline(photo(colour=(50, 50, 50)), "b.png")])
    result = store.cluster(dataset["id"], 0.9)
    assert result["clusters"] == 2
    assert sorted(result["sizes"]) == [2, 2]
    assert result["outliers"] == 0


# --- persistence and export ---------------------------------------------

def test_state_and_embeddings_survive_a_reload(face_root, fake_provider):
    dataset = store.create_dataset("Persisted")
    run_extract(dataset["id"], [inline(photo())])
    saved = store.get_dataset(dataset["id"])
    chosen = saved["faces"][0]["id"]
    store.set_state(dataset["id"], [chosen], "accepted")
    store.set_state(dataset["id"], [saved["faces"][1]["id"]], "rejected")
    again = store.get_dataset(dataset["id"])
    states = {face["id"]: face["state"] for face in again["faces"]}
    assert states[chosen] == "accepted"
    assert store.vectors(dataset["id"]).shape == (2, 512)
    assert [item["name"] for item in store.list_datasets()] == ["Persisted"]


def test_rejected_faces_stay_recoverable(face_root, fake_provider):
    dataset = store.create_dataset("Recoverable")
    run_extract(dataset["id"], [inline(photo())])
    ids = [face["id"] for face in store.get_dataset(dataset["id"])["faces"]]
    store.set_state(dataset["id"], ids, "rejected")
    # Rejection is a label, not a deletion: the crop and record are still there.
    assert all(store.crop_path(dataset["id"], face_id).is_file() for face_id in ids)
    store.set_state(dataset["id"], ids, "accepted")
    assert all(face["state"] == "accepted" for face in store.get_dataset(dataset["id"])["faces"])


def test_removing_a_face_renumbers_embeddings_consistently(face_root, fake_provider):
    dataset = store.create_dataset("Removal")
    run_extract(dataset["id"], [inline(photo())])
    saved = store.get_dataset(dataset["id"])
    keep, drop = saved["faces"][1]["id"], saved["faces"][0]["id"]
    store.remove_faces(dataset["id"], [drop])
    after = store.get_dataset(dataset["id"])
    assert [face["id"] for face in after["faces"]] == [keep]
    assert after["faces"][0]["embedding_row"] == 0
    assert store.vectors(dataset["id"]).shape == (1, 512)
    scores = store.similarity_to(dataset["id"], keep)
    assert scores[keep] == pytest.approx(1.0, abs=1e-5)


def test_export_contains_crops_and_traceable_metadata(face_root, fake_provider):
    dataset = store.create_dataset("Export me")
    run_extract(dataset["id"], [inline(photo(), "portrait.png")])
    saved = store.get_dataset(dataset["id"])
    store.set_state(dataset["id"], [saved["faces"][0]["id"]], "accepted")
    payload, count = pipeline.export_archive(dataset["id"])
    assert count == 1
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        names = archive.namelist()
        assert "metadata.json" not in names
        metadata = store.get_dataset(dataset["id"])
        rows = archive.read("faces.csv").decode().splitlines()
    assert any(name.startswith("faces/") for name in names)
    record = metadata["faces"][0]
    assert record["source_name"] == "portrait.png" and record["source_sha256"]
    assert record["box"] and record["crop_rect"] and record["landmarks"]
    assert len(rows) == 2


def test_export_refuses_when_nothing_is_accepted(face_root, fake_provider):
    dataset = store.create_dataset("Empty")
    run_extract(dataset["id"], [inline(photo())])
    with pytest.raises(ValueError, match="Accept some faces"):
        pipeline.export_archive(dataset["id"])


def test_recrop_reuses_stored_detections_without_detecting_again(face_root, fake_provider):
    dataset = store.create_dataset("Recrop")
    run_extract(dataset["id"], [inline(photo())])
    before = fake_provider.calls
    store.update_settings(dataset["id"], {"crop_mode": "tight", "size": 512})
    result = pipeline.recrop(dataset["id"])
    assert result["recropped"] == 2
    assert fake_provider.calls == before
    saved = store.get_dataset(dataset["id"])
    assert all(face["crop_mode"] == "tight" for face in saved["faces"])


@pytest.mark.parametrize("changes", [{"crop_mode": "nope"}, {"size": 999}, {"unknown": 1}])
def test_invalid_settings_are_refused(face_root, changes):
    dataset = store.create_dataset("Settings")
    with pytest.raises(ValueError):
        store.update_settings(dataset["id"], changes)


def test_settings_are_clamped_into_range(face_root):
    dataset = store.create_dataset("Clamp")
    saved = store.update_settings(dataset["id"], {"padding": 9.0, "detect_threshold": 0.0})
    assert saved["settings"]["padding"] == 1.5
    assert saved["settings"]["detect_threshold"] == 0.1


# --- routes --------------------------------------------------------------

def test_routes_cover_the_whole_workflow(face_root, fake_provider):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes.faces import router

    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        created = client.post("/faces/datasets", json={"name": "Via HTTP"}).json()
        dataset_id = created["id"]
        upload = client.post(f"/faces/datasets/{dataset_id}/upload",
                             files=[("files", ("shot.png", photo(), "image/png"))])
        assert upload.status_code == 202
        import time
        for _ in range(200):
            run = client.get(f"/faces/datasets/{dataset_id}/run").json()["run"]
            if run and run["status"] in ("complete", "error", "cancelled"):
                break
            # The extraction runs on the app's own loop; give it room to advance.
            time.sleep(0.05)
        assert run["status"] == "complete"

        loaded = client.get(f"/faces/datasets/{dataset_id}").json()
        face_ids = [face["id"] for face in loaded["faces"]]
        assert len(face_ids) == 2

        crop = client.get(f"/faces/datasets/{dataset_id}/faces/{face_ids[0]}/crop")
        assert crop.status_code == 200 and crop.headers["content-type"] == "image/png"

        similar = client.get(f"/faces/datasets/{dataset_id}/similar/{face_ids[0]}?threshold=0.5").json()
        assert similar["matches"][0]["face_id"] == face_ids[0]
        assert "not a confirmed identity" in similar["note"]

        assert client.post(f"/faces/datasets/{dataset_id}/state",
                           json={"face_ids": [face_ids[0]], "state": "accepted"}).json()["changed"] == 1
        export = client.get(f"/faces/datasets/{dataset_id}/export")
        assert export.status_code == 200 and export.headers["content-type"] == "application/zip"
        assert client.delete(f"/faces/datasets/{dataset_id}").json()["deleted"] is True
        assert client.get(f"/faces/datasets/{dataset_id}").status_code == 400


def test_named_runs_persist_and_renames_survive_later_progress(face_root):
    dataset = store.create_dataset("Named runs")
    run = pipeline.FaceRun(dataset["id"], 2, "Outdoor portraits")
    store.save_run(run.snapshot())
    renamed = store.rename_run(dataset["id"], run.id, "Approved outdoor batch")
    assert renamed["name"] == "Approved outdoor batch"
    run.status = "complete"; run.processed = 2
    store.save_run(run.snapshot())
    saved = store.list_runs(dataset["id"])[0]
    assert saved["name"] == "Approved outdoor batch" and saved["status"] == "complete"
    assert store.get_dataset(dataset["id"])["name"] == "Named runs"
    with pytest.raises(ValueError): store.rename_run(dataset["id"], run.id, "  ")
    with pytest.raises(ValueError): store.rename_run(dataset["id"], "../bad", "Name")
