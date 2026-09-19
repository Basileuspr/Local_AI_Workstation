"""Scene persistence/lineage use temporary storage and fake image inference."""
import asyncio
import hashlib
import io
import uuid
from pathlib import Path

import pytest
from PIL import Image
from services.image_workflows import store, scenes, runner
from services.image_workflows.contracts import UpdateRequest, ScenePatchRequest, SceneFrameRequest, SceneIdentityRequest
from services.image_workflows.scene_state import SceneState, patch_state, build_prompt
from services.image_workflows.providers import StageResult
from services.gpu_coordination import GpuCoordinator
from services.request_queue import RequestQueue


def initial_state():
    return SceneState.model_validate({
        "character": {"name": "Mira", "appearance": "short brown hair", "clothing": "blue work shirt"},
        "environment": {"location": "woodworking bench", "background": "plain brick wall"},
        "camera": {"framing": "waist-up", "angle": "eye level", "focal_length": "50 mm"},
        "lighting": {"source": "window", "direction": "left", "intensity": "soft"},
        "body": {"right_hand": "gripping screwdriver", "left_hand": "holding board"},
        "objects": [{"id": "driver", "name": "screwdriver", "position": "tip seated in screw", "contact": "right hand"},
                    {"id": "screw", "name": "screw", "progression": "50% inserted into board"}],
        "current_action": "right wrist aligned with screwdriver"})


def test_patch_preserves_every_unchanged_detail_and_describes_visible_result():
    before = initial_state()
    changed = patch_state(before, {"body": {"wrist_rotation": "further clockwise"},
        "objects": [{"id": "screw", "progression": "70% inserted into board"}],
        "current_action": "right hand grips screwdriver with wrist rotated clockwise"})
    assert changed.character == before.character and changed.environment == before.environment
    assert changed.camera == before.camera and changed.lighting == before.lighting
    assert changed.body.right_hand == before.body.right_hand
    assert changed.objects[0] == before.objects[0]
    assert before.objects[1].progression.startswith("50%")
    prompt = build_prompt(changed)
    for detail in ("blue work shirt", "tip seated in screw", "70% inserted", "further clockwise", "50 mm"):
        assert detail in prompt
    assert "50% inserted" not in prompt
    assert len(patch_state(changed, {}, ["driver"]).objects) == 1


@pytest.mark.parametrize("changes", [{"surprise": "value"}, {"body": {"unknown": "x"}},
    {"objects": [{"id":"x"}, {"id":"x"}]}, {"objects": [{"name": "no ID"}]}, {"character": None}])
def test_invalid_patches_do_not_change_original(changes):
    original = initial_state()
    with pytest.raises(ValueError): patch_state(original, changes)
    assert original == initial_state()


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    from services import image_generation
    monkeypatch.setattr(store, "ROOT", tmp_path / "workflows")
    gpu = GpuCoordinator()
    monkeypatch.setattr(runner, "queue", RequestQueue(gpu))
    monkeypatch.setattr(runner, "gpu_coordinator", gpu)
    monkeypatch.setattr(runner, "provider_catalog", lambda: {"providers": [{"id":"local-sdxl", "available":True,
        "operations":["txt2img", "img2img"], "models":[{"id":"local"}]}]})
    monkeypatch.setattr(image_generation, "prompt_token_status", lambda *args: {"prompt":{"chunks_required":1}, "negative_prompt":{"chunks_required":1}})
    async def prepare(kind): pass
    monkeypatch.setattr(runner, "prepare_runtime", prepare)
    requests = []
    class Provider:
        operations = {"txt2img", "img2img"}
        async def execute(self, request, context):
            requests.append(request)
            image = Image.new("RGB", (request.stage.width, request.stage.height), "blue" if request.source is None else "red")
            path = context.output_dir / f"{uuid.uuid4().hex}.png"
            image.save(path)
            return StageResult((path,), metadata={"seed":request.prompt_settings.seed})
    monkeypatch.setattr(runner, "provider_factory", lambda: {"local-sdxl":Provider()})
    workflow = store.create("Screwdriver scene", "scene")
    workflow.scene.state = initial_state()
    workflow.scene.model_id = "local"
    workflow.scene.width = workflow.scene.height = 256
    workflow.prompt_settings.seed = 42
    workflow = scenes.save(workflow)
    return workflow, runner.Runner(), requests


async def generate(workflow, manager):
    run = await manager.start(workflow.id, workflow.revision)
    await asyncio.wait_for(manager.active[(workflow.id, run["id"])].task, 4)
    record = runner.read_run(workflow.id, run["id"])
    assert record["status"] == "completed", record["error"]
    return {"workflow_id": workflow.id, "job_id": run["id"], "output_id": record["outputs"][0]["id"]}


def test_first_frame_continuation_restore_and_branch_preserve_snapshots(runtime):
    workflow, manager, requests = runtime
    async def scenario():
        first = await generate(workflow, manager)
        snapshot_path = runner._job_dir(workflow.id, first["job_id"]) / "job.json"
        immutable = snapshot_path.read_bytes()
        current = scenes.choose_frame(workflow.id, SceneFrameRequest(revision=workflow.revision, frame=first, action="continue"))
        assert current.scene.parent_frame.model_dump() == first
        current = scenes.patch(current.id, ScenePatchRequest(revision=current.revision, changes={"objects":[{"id":"screw", "progression":"70% inserted"}]}))
        assert current.scene.state.body.right_hand == "gripping screwdriver"
        second = await generate(current, manager)
        assert requests[0].source is None and requests[0].stage.operation == "txt2img"
        assert requests[1].source.is_file() and requests[1].stage.operation == "img2img"
        assert "70% inserted" in requests[1].prompt_settings.prompt
        assert requests[1].stage.strength == .25
        assert snapshot_path.read_bytes() == immutable
        frames = scenes.frames(workflow.id)["frames"]
        assert len(frames) == 2 and frames[0]["scene"]["parent_frame"] == first
        restored = scenes.choose_frame(current.id, SceneFrameRequest(revision=current.revision, frame=first, action="restore"))
        assert restored.scene.source_asset_id is None and restored.prompt_settings.seed == 42
        assert restored.scene.state.objects[1].progression.startswith("50%")
        branch = scenes.choose_frame(restored.id, SceneFrameRequest(revision=restored.revision, frame=second, action="branch"))
        assert branch.id != restored.id and branch.parent.workflow_id == restored.id
        assert branch.scene.parent_frame.model_dump() == second
        assert branch.scene.state.objects[1].progression == "70% inserted"
        owned, _ = store.asset_path(branch.id, branch.scene.source_asset_id)
        assert owned.is_relative_to(store._directory(branch.id))
        assert store.get(branch.id) == branch
        assert len(scenes.frames(workflow.id)["frames"]) == 2
    asyncio.run(scenario())


def test_revision_conflict_and_missing_source_block_without_resetting(runtime):
    workflow, manager, _ = runtime
    old = workflow.model_dump()
    with pytest.raises(store.Conflict):
        scenes.patch(workflow.id, ScenePatchRequest(revision=workflow.revision - 1, changes={"current_action":"other"}))
    assert store.get(workflow.id).model_dump() == old
    workflow.scene.source_asset_id = "a" * 64
    workflow = scenes.save(workflow)
    assert not runner.preflight(workflow)["ready"]
    with pytest.raises(ValueError): asyncio.run(manager.start(workflow.id, workflow.revision))
    assert scenes.frames(workflow.id)["frames"] == []


def test_identity_references_are_owned_copies_and_do_not_rewrite_descriptions(runtime, tmp_path, monkeypatch):
    from services.faces import bank, store as face_store
    workflow, _, _ = runtime
    crop = tmp_path / "crop.png"
    Image.new("RGB", (32, 32), "green").save(crop)
    entry = {"dataset_id":"a" * 32, "face_id":"b" * 32}
    monkeypatch.setattr(bank, "reference_bundle", lambda _: {"character_id":"c" * 32, "name":"Mira profile", "primary_reference":entry, "additional_references":[]})
    monkeypatch.setattr(face_store, "crop_path", lambda *_: crop)
    saved = scenes.attach_identity(workflow.id, SceneIdentityRequest(revision=workflow.revision, character_id="c" * 32))
    assert saved.scene.state.character.clothing == "blue work shirt"
    assert saved.scene.state.character.profile_id == "c" * 32
    copied, _ = store.asset_path(saved.id, saved.scene.identity_asset_ids[0])
    assert copied.read_bytes() == crop.read_bytes() and copied != crop
    assert saved.stages[0].reference_asset_ids == saved.scene.identity_asset_ids


def test_scene_routes_validate_state_and_keep_generated_prompt_authoritative(runtime):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes.image_workflows import router
    app = FastAPI()
    app.include_router(router)
    workflow, _, _ = runtime
    client = TestClient(app)
    prefix = f"/image-workflows/{workflow.id}"
    response = client.patch(prefix + "/scene", json={"revision":workflow.revision, "changes":{"body":{"wrist_rotation":"clockwise"}}})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert "clockwise" in saved["prompt_settings"]["prompt"]
    invalid = client.patch(prefix + "/scene", json={"revision":saved["revision"], "changes":{"lighting":{"intensity":{}}}})
    assert invalid.status_code == 422
    assert client.get(prefix).json() == saved
