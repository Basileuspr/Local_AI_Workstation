"""Opt-in real SDXL smoke test. All writes require an isolated LAW_DATA_DIR."""
import asyncio
import json
import os
from pathlib import Path
import sys
import time

if not os.environ.get("LAW_DATA_DIR") or not os.environ.get("LAW_QA_MODEL_ID"):
    raise RuntimeError("Set isolated LAW_DATA_DIR and explicit LAW_QA_MODEL_ID")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from services.image_workflows import store, scenes, runner
from services.image_workflows.contracts import SceneFrameRequest, ScenePatchRequest
from services.image_generation import manager as image_manager


async def run_frame(workflow):
    record = await runner.manager.start(workflow.id, workflow.revision)
    await runner.manager.active[(workflow.id, record["id"])].task
    record = runner.read_run(workflow.id, record["id"])
    print(json.dumps({"stage": "frame", "status": record["status"], "error": record["error"]}), flush=True)
    assert record["status"] == "completed", record["error"]
    return {"workflow_id": workflow.id, "job_id": record["id"], "output_id": record["outputs"][0]["id"]}


async def main():
    workflow = store.create("Isolated continuity verification", "scene")
    workflow.scene.model_id = os.environ["LAW_QA_MODEL_ID"]
    workflow.scene.width = workflow.scene.height = 512
    workflow.scene.state.environment.location = "wooden workbench with one red ceramic cup"
    workflow.scene.state.lighting.style = "soft daylight"
    workflow.scene.state.camera.framing = "close-up still life"
    workflow.prompt_settings.steps = 8
    workflow.prompt_settings.seed = 42
    workflow = scenes.save(workflow)
    first = await run_frame(workflow)
    unet = image_manager._pipeline.unet
    workflow = scenes.choose_frame(workflow.id, SceneFrameRequest(revision=workflow.revision, frame=first, action="continue"))
    workflow = scenes.patch(workflow.id, ScenePatchRequest(revision=workflow.revision, changes={"current_action":"cup handle points slightly to the right"}))
    second = await run_frame(workflow)
    assert image_manager._pipeline.unet is unet
    workflow = scenes.choose_frame(workflow.id, SceneFrameRequest(revision=workflow.revision, frame=first, action="restore"))
    await run_frame(workflow)
    assert image_manager._pipeline.unet is unet
    normal = await asyncio.to_thread(image_manager.generate, model_id=workflow.scene.model_id,
        prompt="A red ceramic cup on a wooden table, daylight", negative_prompt="", width=512, height=512,
        steps=4, guidance_scale=5, seed=42, request_id="scene-qa-normal-generate")
    assert image_manager._pipeline.unet is unet
    # Real cancellation must exit the native worker before releasing its lease.
    workflow.prompt_settings.steps = 40
    workflow = scenes.save(workflow)
    record = await runner.manager.start(workflow.id, workflow.revision)
    task = runner.manager.active[(workflow.id, record["id"])].task
    deadline = time.monotonic() + 120
    while not task.done() and time.monotonic() < deadline:
        progress = runner.read_run(workflow.id, record["id"])
        if progress["step"] >= 1:
            await runner.manager.cancel(workflow.id, record["id"])
            break
        await asyncio.sleep(.1)
    await task
    cancelled = runner.read_run(workflow.id, record["id"])
    assert cancelled["status"] == "cancelled" and not cancelled["outputs"]
    assert runner.gpu_coordinator.current_owner() is None
    result = {"first":first, "second":second, "frames":len(scenes.frames(workflow.id)["frames"]),
              "shared_unet":True, "normal_generate":bool(normal), "cancellation":cancelled["status"]}
    Path(os.environ["LAW_DATA_DIR"]).joinpath("real-sdxl-result.json").write_text(json.dumps(result,indent=2))
    image_manager.unload_for_training()
    print(json.dumps(result),flush=True)


asyncio.run(main())
