import io
import json
from pathlib import Path

import pytest
from PIL import Image

from services import lora_store


def image_bytes(color="blue"):
    image = Image.new("RGB", (96, 96), color=color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def supported_model():
    return {"id": "local-sdxl", "name": "Local SDXL", "pipeline": "StableDiffusionXLPipeline"}


def test_older_package_uses_saved_output_name_without_modifying_manifest(lora_paths):
    package = lora_store.COMPLETE_LORAS_DIR / "renamed-12345678"
    model = package / "model"
    model.mkdir(parents=True)
    manifest = model / "adapter.json"
    original = json.dumps({"id": "12345678", "name": "Old project", "filename": "adapter.safetensors"})
    manifest.write_text(original, encoding="utf-8")
    (model / "adapter.safetensors").write_bytes(b"weights")
    (package / "project.json").write_text(json.dumps({"output_location": "Renamed adapter"}), encoding="utf-8")
    assert lora_store.list_adapters()[0]["name"] == "Renamed adapter"
    assert manifest.read_text(encoding="utf-8") == original


def test_create_multiple_projects_through_http(lora_paths):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes.lora import router

    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        first = client.post("/lora/projects", json={"name": "First character", "settings": {}})
        second = client.post("/lora/projects", json={"name": "Second character", "settings": {}})
        assert first.status_code == second.status_code == 200
        assert first.json()["id"] != second.json()["id"]
        assert {p["name"] for p in client.get("/lora/projects").json()["projects"]} == {"First character", "Second character"}


def test_project_copies_images_without_changing_the_source(lora_paths):
    project = lora_store.create_project("Character", trigger_word="charx", base_model_id="local-sdxl")
    source = image_bytes()

    result = lora_store.add_images(project["id"], [("source.png", source), ("copy.png", source)])

    assert len(result["added"]) == 1
    assert result["skipped"] == ["copy.png"]
    saved = lora_store.get_project(project["id"])
    assert saved["images"][0]["caption"] == "charx"
    copied = lora_store.image_path(project["id"], saved["images"][0]["id"])
    assert copied.read_bytes() == source
    assert copied.parent == lora_paths / "projects" / project["id"] / "dataset" / "originals"


def test_preflight_reports_settings_and_gpu_readiness(lora_paths, monkeypatch):
    project = lora_store.create_project("Style", base_model_id="local-sdxl", training_goal="style")
    lora_store.add_images(project["id"], [("style.png", image_bytes())])
    monkeypatch.setattr(lora_store, "hardware_status", lambda: {
        "cuda_available": True, "device": "Test GPU", "available_vram_gib": 8, "total_vram_gib": 8,
    })

    ready = lora_store.validate_project(lora_store.get_project(project["id"]), [supported_model()])
    assert ready["valid"]
    assert ready["estimated_steps"] == 10

    changed = lora_store.update_project(project["id"], {"settings": {"resolution": 510}})
    invalid = lora_store.validate_project(changed, [supported_model()])
    assert not invalid["valid"]
    assert "multiple of 64" in invalid["errors"][0]


def test_identity_preflight_requires_trigger_and_guides_dataset_size(lora_paths, monkeypatch):
    project = lora_store.create_project("Character", base_model_id="local-sdxl", training_goal="character_identity")
    lora_store.add_images(project["id"], [("identity.png", image_bytes())])
    monkeypatch.setattr(lora_store, "hardware_status", lambda: {
        "cuda_available": True, "device": "Test GPU", "available_vram_gib": 12, "total_vram_gib": 12,
    })

    blocked = lora_store.validate_project(lora_store.get_project(project["id"]), [supported_model()])

    assert not blocked["valid"]
    assert "trigger token" in " ".join(blocked["errors"]).lower()
    assert "varied images" in " ".join(blocked["warnings"]).lower()

    updated = lora_store.update_project(project["id"], {"trigger_word": "charx"})
    ready = lora_store.validate_project(updated, [supported_model()])
    assert ready["valid"]
    assert ready["training_goal"] == "character_identity"


def test_active_training_freezes_project_and_dataset(lora_paths):
    project = lora_store.create_project(
        "Frozen Character",
        trigger_word="freezechar",
        base_model_id="local-sdxl",
        training_goal="character_identity",
    )
    added = lora_store.add_images(project["id"], [("identity.png", image_bytes())])
    image_id = added["added"][0]["id"]
    lora_store.update_training(project["id"], {"status": "running", "run_id": "run-1"})

    operations = [
        lambda: lora_store.update_project(project["id"], {"name": "Changed"}),
        lambda: lora_store.add_images(project["id"], [("second.png", image_bytes("green"))]),
        lambda: lora_store.update_image_caption(project["id"], image_id, "changed"),
        lambda: lora_store.remove_image(project["id"], image_id),
        lambda: lora_store.clear_images(project["id"]),
    ]

    for operation in operations:
        with pytest.raises(ValueError, match="training is active"):
            operation()
    assert len(lora_store.get_project(project["id"])["images"]) == 1


def test_identity_analysis_suggestions_require_review_and_become_stale(lora_paths):
    project = lora_store.create_project(
        "Analyzed Character",
        trigger_word="anachar",
        base_model_id="local-sdxl",
        training_goal="character_identity",
        vision_model="qwen3-vl:8b",
    )
    added = lora_store.add_images(project["id"], [
        ("front.png", image_bytes("blue")),
        ("action.png", image_bytes("green")),
    ])
    image_ids = [item["id"] for item in added["added"]]

    analyzed = lora_store.save_identity_analysis(project["id"], {
        "model": "qwen3-vl:8b",
        "summary": "One recurring fictional character",
        "stable_traits": ["short dark hair", "round glasses"],
        "warnings": [],
        "images": [
            {"image_id": image_ids[0], "caption_suggestion": "anachar, front view", "analysis": {"view": "front"}},
            {"image_id": image_ids[1], "caption_suggestion": "anachar, running", "analysis": {"action": "running"}},
        ],
    })

    assert analyzed["identity_analysis"]["status"] == "ready"
    assert analyzed["images"][0]["caption"] == "anachar"
    assert analyzed["images"][0]["caption_suggestion"] == "anachar, front view"

    applied = lora_store.apply_caption_suggestions(project["id"])
    assert [item["caption"] for item in applied["images"]] == ["anachar, front view", "anachar, running"]

    changed = lora_store.add_images(project["id"], [("new-angle.png", image_bytes("red"))])["project"]
    assert changed["identity_analysis"]["status"] == "stale"
    with pytest.raises(ValueError, match="stale"):
        lora_store.apply_caption_suggestions(project["id"])


def test_completed_adapter_is_discoverable_and_dataset_can_clear(lora_paths):
    project = lora_store.create_project("Adapter", base_model_id="local-sdxl", output_location="my adapter")
    lora_store.add_images(project["id"], [("one.png", image_bytes())])
    adapter_dir = lora_store.ADAPTERS_DIR / "my-adapter-a1"
    adapter_dir.mkdir(parents=True)
    (adapter_dir / "adapter.safetensors").write_bytes(b"adapter")
    manifest = {"id": "a1", "name": "Adapter", "base_model_id": "local-sdxl", "filename": "adapter.safetensors", "created_at": "2026-01-01T00:00:00+00:00"}
    (adapter_dir / "adapter.json").write_text(json.dumps(manifest), encoding="utf-8")

    assert lora_store.list_adapters()[0]["path"] == str(adapter_dir)
    cleared = lora_store.clear_images(project["id"])
    assert cleared["images"] == []


def test_publish_completion_builds_self_contained_lora_folder(lora_paths):
    project = lora_store.create_project(
        "Story Character",
        trigger_word="storychar",
        base_model_id="local-sdxl",
        output_location="story character",
        training_goal="character_identity",
    )
    first = image_bytes("blue")
    second = image_bytes("green")
    added = lora_store.add_images(project["id"], [("front.png", first), ("action.png", second)])
    lora_store.update_image_caption(project["id"], added["added"][0]["id"], "storychar, front view")
    lora_store.update_image_caption(project["id"], added["added"][1]["id"], "storychar, running")

    run_dir = lora_store.RUNS_DIR / project["id"] / "run-1"
    model_source = run_dir / "model"
    weights_source = run_dir / "weights"
    model_source.mkdir(parents=True)
    checkpoint = weights_source / "checkpoint-10"
    checkpoint.mkdir(parents=True)
    (model_source / "adapter.safetensors").write_bytes(b"final-adapter")
    (checkpoint / "adapter.safetensors").write_bytes(b"checkpoint")

    adapter = lora_store.publish_completion(
        project["id"],
        run_id="run-1",
        adapter_id="a" * 32,
        model_source=model_source,
        weights_source=weights_source,
        training_seconds=12.5,
    )

    complete_dir = Path(adapter["complete_path"])
    assert adapter["name"] == "story-character"
    assert json.loads((complete_dir / "model" / "adapter.json").read_text(encoding="utf-8"))["name"] == "story-character"
    assert complete_dir.parent == lora_paths / "Complete LoRas"
    assert (complete_dir / "model" / "adapter.safetensors").read_bytes() == b"final-adapter"
    assert (complete_dir / "weights" / "checkpoint-10" / "adapter.safetensors").read_bytes() == b"checkpoint"
    assert sorted(path.read_bytes() for path in (complete_dir / "training-images").iterdir()) == sorted([first, second])
    assert sorted(path.read_text(encoding="utf-8") for path in (complete_dir / "captions").iterdir()) == [
        "storychar, front view", "storychar, running",
    ]
    assert json.loads((complete_dir / "completion.json").read_text(encoding="utf-8"))["layout"]["model"] == "model/"
    assert json.loads((complete_dir / "dataset.json").read_text(encoding="utf-8"))["image_count"] == 2
    assert json.loads((complete_dir / "project.json").read_text(encoding="utf-8"))["id"] == project["id"]
    assert lora_store.list_adapters()[0]["complete_path"] == str(complete_dir)


def test_training_subset_preserves_originals_and_publishes_only_selected_images(lora_paths):
    project = lora_store.create_project("Subset", trigger_word="subject", training_goal="character_identity")
    added = lora_store.add_images(project["id"], [("keep.png", image_bytes("blue")), ("skip.png", image_bytes("green"))])
    chosen = added["added"][0]["id"]
    project = lora_store.update_project(project["id"], {"settings": {"training_image_ids": [chosen]}})
    assert len(project["images"]) == 2
    assert [item["id"] for item in lora_store.training_images(project)] == [chosen]
    source = lora_store.RUNS_DIR / project["id"] / "fixture"
    source.mkdir(parents=True)
    (source / "adapter.safetensors").write_bytes(b"fixture")
    adapter = lora_store.publish_completion(project["id"], run_id="subset", adapter_id="b" * 32, model_source=source)
    assert adapter["dataset_count"] == 1
    package = Path(adapter["complete_path"])
    assert len(list((package / "training-images").iterdir())) == 1
    assert len(json.loads((package / "project.json").read_text())["images"]) == 1
    assert len(lora_store.get_project(project["id"])["images"]) == 2
    for item in project["images"]:
        assert lora_store.image_path(project["id"], item["id"]).is_file()


@pytest.mark.parametrize("selected", [[], ["missing"], ["one", "one"], "one"])
def test_training_subset_rejects_invalid_selection(selected):
    with pytest.raises(ValueError):
        lora_store.training_images({"images": [{"id": "one"}], "settings": {"training_image_ids": selected}})


def test_contended_read_is_retried_instead_of_reported_as_unreadable(lora_paths, monkeypatch):
    project = lora_store.create_project("Contended", trigger_word="subject")
    real_read = Path.read_text
    attempts = {"count": 0}

    def contended(self, *args, **kwargs):
        if self.name == "project.json":
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise PermissionError(13, "sharing violation")
        return real_read(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", contended)
    assert lora_store.get_project(project["id"])["name"] == "Contended"
    assert attempts["count"] == 2


def test_persistently_unreadable_project_still_fails(lora_paths, monkeypatch):
    project = lora_store.create_project("Unreadable", trigger_word="subject")
    monkeypatch.setattr(lora_store, "_READ_DELAYS", (0, 0))
    monkeypatch.setattr(Path, "read_text", lambda self, *a, **k: (_ for _ in ()).throw(PermissionError(13, "locked")))
    with pytest.raises(ValueError, match="could not be read"):
        lora_store.get_project(project["id"])


def test_corrupt_project_fails_immediately_without_retrying(lora_paths, monkeypatch):
    project = lora_store.create_project("Corrupt", trigger_word="subject")
    path = lora_store._project_path(project["id"])
    path.write_text("{ not json", encoding="utf-8")
    reads = {"count": 0}
    real_read = Path.read_text

    def counted(self, *args, **kwargs):
        if self.name == "project.json":
            reads["count"] += 1
        return real_read(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", counted)
    with pytest.raises(ValueError, match="could not be read"):
        lora_store.get_project(project["id"])
    # Damaged content is not contention; retrying it would only delay the error.
    assert reads["count"] == 1


def test_contended_replace_is_retried_so_training_progress_is_not_lost(lora_paths, monkeypatch):
    project = lora_store.create_project("Progress", trigger_word="subject")
    real_replace = Path.replace
    attempts = {"count": 0}

    def contended(self, target):
        if self.name.endswith(".partial"):
            attempts["count"] += 1
            if attempts["count"] <= 2:
                raise PermissionError(13, "sharing violation")
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", contended)
    lora_store.update_training(project["id"], {"status": "running", "step": 7})
    assert lora_store.get_project(project["id"])["training"]["step"] == 7
    assert attempts["count"] == 3


def test_failed_write_removes_its_partial_file_and_reports_the_error(lora_paths, monkeypatch):
    project = lora_store.create_project("Partial", trigger_word="subject")
    monkeypatch.setattr(lora_store, "_WRITE_DELAYS", (0, 0))
    monkeypatch.setattr(Path, "replace", lambda self, target: (_ for _ in ()).throw(PermissionError(13, "locked")))
    with pytest.raises(PermissionError):
        lora_store.update_training(project["id"], {"status": "running"})
    directory = lora_store._project_path(project["id"]).parent
    assert [item.name for item in directory.iterdir() if item.name.endswith(".partial")] == []
    assert lora_store.get_project(project["id"])["training"].get("status") != "running"
