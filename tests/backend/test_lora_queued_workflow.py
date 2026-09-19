import asyncio
import io
import json
from types import SimpleNamespace

import pytest
from PIL import Image

from routes import lora
from services import lora_store, request_queue
from services.gpu_coordination import GpuCoordinator
from services.request_queue import RequestQueue


@pytest.fixture
def workflow(lora_paths, monkeypatch):
    gpu = GpuCoordinator()
    queue = RequestQueue(gpu)
    monkeypatch.setattr(lora, "queue", queue)
    monkeypatch.setattr(request_queue, "queue", queue)
    monkeypatch.setattr(lora, "discover_models", lambda: [{"id": "sdxl"}])
    monkeypatch.setattr(lora_store, "hardware_status", lambda: {"cuda_available": True})
    project = lora_store.create_project("Workflow test", base_model_id="sdxl", vision_model="vision", training_goal="style")
    images = []
    for color in ("red", "blue"):
        output = io.BytesIO()
        Image.new("RGB", (64, 64), color).save(output, format="PNG")
        images.append((f"{color}.png", output.getvalue()))
    project = lora_store.add_images(project["id"], images)["project"]
    project = lora_store.update_image_caption(project["id"], project["images"][1]["id"], "My edited caption")
    model = SimpleNamespace(project=project, gpu=gpu, queue=queue, started=asyncio.Event(), release=asyncio.Event(),
                            closed=False, mode="complete", training_starts=0, run=None, cancelled=False, preparations=[])

    async def prepare(kind):
        model.preparations.append(kind)
    monkeypatch.setattr(lora, "prepare_runtime", prepare)

    async def analyze(saved, selected_model):
        assert selected_model == "vision"
        owner = f"lora-vision:{saved['id']}"
        assert gpu.acquire(owner)
        model.started.set()
        try:
            await model.release.wait()
            if model.mode == "error":
                raise RuntimeError("Vision provider failed")
            results = [{"image_id": image["id"], "caption_suggestion": f"New caption {i}"} for i, image in enumerate(saved["images"])]
            if model.mode == "partial":
                results.pop()
            elif model.mode == "duplicate":
                results[1] = results[0]
            elif model.mode == "empty":
                results[0]["caption_suggestion"] = ""
            return {"model": selected_model, "images": results, "summary": "Complete analysis"}
        finally:
            model.closed = True
            gpu.release(owner)
    monkeypatch.setattr(lora.lora_vision, "analyze_project", analyze)

    def start(project_id, models, run_id, event):
        assert model.closed
        assert not event.is_set()
        assert gpu.acquire(f"lora:{run_id}")
        saved = lora_store.get_project(project_id)
        assert saved["identity_analysis"]["analyzed_image_count"] == 2
        assert saved["images"][0]["caption"] == "New caption 0"
        assert saved["images"][1]["caption"] == "My edited caption"
        model.training_starts += 1
        model.run = run_id
        return lora_store.update_training(project_id, {"status": "running"})["training"]

    def cancel(project_id):
        if not model.run:
            raise ValueError("No training worker")
        model.cancelled = True
    monkeypatch.setattr(lora, "manager", SimpleNamespace(start=start, cancel=cancel, is_run_pending=lambda run: model.run == run))
    return model


async def until(condition):
    async with asyncio.timeout(5):
        while not condition():
            await asyncio.sleep(0.01)


def finish_worker(model, status="completed"):
    lora_store.update_training(model.project["id"], {"status": status})
    model.gpu.release(f"lora:{model.run}")
    model.run = None


def test_analysis_then_training_holds_one_fifo_slot_and_preserves_edited_captions(workflow):
    async def scenario():
        saved = await lora.analyze_and_train(workflow.project["id"])
        assert saved["workflow"] == "analyze_train"
        await workflow.started.wait()
        job = workflow.queue.find(job_id=saved["queue_id"])
        later = workflow.queue.enqueue("chat", "Later chat")
        assert not workflow.queue.try_start(later)
        assert job.stage == "analysis"
        with pytest.raises(ValueError, match="cannot change"):
            lora_store.update_project(workflow.project["id"], {"name": "Changed"})
        # Repeated requests return the existing run instead of launching another.
        again = await lora.analyze_and_train(workflow.project["id"])
        assert again["queue_id"] == saved["queue_id"]
        workflow.release.set()
        await until(lambda: workflow.training_starts == 1)
        assert job.stage == "training"
        assert not workflow.queue.try_start(later)
        assert workflow.preparations == ["analysis", "training"]
        finish_worker(workflow)
        await until(lambda: job.status == "completed")
        assert workflow.queue.try_start(later)
        workflow.queue.finish(later)
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["error", "partial", "duplicate", "empty"])
def test_failed_or_incomplete_analysis_never_starts_training(workflow, mode):
    async def scenario():
        workflow.mode = mode
        saved = await lora.analyze_and_train(workflow.project["id"])
        job = workflow.queue.find(job_id=saved["queue_id"])
        workflow.release.set()
        await until(lambda: job.status == "failed")
        assert workflow.training_starts == 0
        assert workflow.gpu.current_owner() is None
        assert lora_store.get_project(workflow.project["id"])["training"]["status"] == "failed"
        assert job.error
    asyncio.run(scenario())


@pytest.mark.parametrize("stage", ["queued", "analysis", "training"])
def test_cancel_at_each_stage_stops_remaining_work_and_retains_lease_until_exit(workflow, stage):
    async def scenario():
        workflow.queue.paused = stage == "queued"
        saved = await lora.analyze_and_train(workflow.project["id"])
        job = workflow.queue.find(job_id=saved["queue_id"])
        if stage != "queued":
            await workflow.started.wait()
        if stage == "training":
            workflow.release.set()
            await until(lambda: workflow.training_starts == 1)
        # Exercise project cancellation and the same queue callback used by the queue page.
        if stage == "analysis":
            await lora.cancel_training(workflow.project["id"])
        else:
            await workflow.queue.cancel(job)
        if stage == "training":
            assert workflow.cancelled
            assert workflow.gpu.current_owner() == job.owner
            next_job = workflow.queue.enqueue("chat", "Wait for process cleanup")
            assert not workflow.queue.try_start(next_job)
            finish_worker(workflow, "cancelled")
        await until(lambda: lora_store.get_project(workflow.project["id"])["training"]["status"] == "cancelled" and workflow.queue.active is None)
        assert job.status == "cancelled"
        assert workflow.training_starts == (1 if stage == "training" else 0)
        assert workflow.gpu.current_owner() is None
    asyncio.run(scenario())


def test_restart_marks_waiting_workflow_interrupted_and_allows_editing(workflow, monkeypatch):
    async def scenario():
        workflow.queue.paused = True
        saved = await lora.analyze_and_train(workflow.project["id"])
        snapshot = lora_store.get_project(workflow.project["id"])
        job = workflow.queue.find(job_id=saved["queue_id"])
        await workflow.queue.cancel(job)
        await until(lambda: not lora.training_queue_tasks)
        lora_store._project_path(workflow.project["id"]).write_text(json.dumps(snapshot), encoding="utf-8")
        monkeypatch.setattr(request_queue, "queue", RequestQueue(GpuCoordinator()))
        assert lora_store.get_project(workflow.project["id"])["training"]["status"] == "interrupted"
        assert lora_store.update_project(workflow.project["id"], {"name": "Recovered"})["name"] == "Recovered"
    asyncio.run(scenario())


def test_http_admission_returns_202_and_rejects_missing_vision_model(workflow):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(lora.router)
    workflow.queue.paused = True
    with TestClient(app) as client:
        lora_store.update_project(workflow.project["id"], {"vision_model": ""})
        assert client.post(f"/lora/projects/{workflow.project['id']}/analyze-and-train").status_code == 400
        lora_store.update_project(workflow.project["id"], {"vision_model": "vision"})
        response = client.post(f"/lora/projects/{workflow.project['id']}/analyze-and-train")
        assert response.status_code == 202
        assert response.json()["status"] == "queued"
        client.post(f"/lora/projects/{workflow.project['id']}/cancel")
