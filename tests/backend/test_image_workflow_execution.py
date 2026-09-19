"""Execution and cancellation tests use only owned temporary data and fake inference."""
import asyncio
import io
import threading
import uuid

import pytest
from PIL import Image

from services.image_workflows import runner, store
from services.image_workflows.contracts import UpdateRequest
from services.image_workflows.providers import StageResult
from services.image_workflows.adapters import PillowProvider, thread_work
from services.gpu_coordination import GpuCoordinator
from services.request_queue import RequestQueue


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "ROOT", tmp_path / "workflows")
    gpu = GpuCoordinator()
    fifo = RequestQueue(gpu)
    monkeypatch.setattr(runner, "queue", fifo)
    monkeypatch.setattr(runner, "gpu_coordinator", gpu)
    monkeypatch.setattr(runner, "provider_catalog", lambda: {"providers": [
        {"id": "test", "operations": ["upscale", "img2img", "inpaint", "describe"],
         "available": True, "models": [{"id": "test-model"}]}]})
    monkeypatch.setattr(runner, "provider_factory", lambda: {"test": PillowProvider()})
    return runner.Runner(), fifo, gpu


def project(operations=("upscale",), **changes):
    workflow = store.create("Execution test")
    data = io.BytesIO()
    Image.new("RGB", (32, 24), "blue").save(data, "PNG")
    workflow = store.add_asset(workflow.id, workflow.revision, "source.png", data.getvalue())
    stages = []
    for operation in operations:
        stages.append({"id": uuid.uuid4().hex, "operation": operation, "provider_slot": "test",
                       "model_id": "test-model", "source": {"kind": "stage", "id": stages[-1]["id"]} if stages else
                       {"kind": "asset", "id": workflow.assets[0].id}, **changes})
    return store.update(workflow.id, UpdateRequest(revision=workflow.revision, name=workflow.name,
                        stages=stages, prompt_settings={"prompt": "Test scene", "seed": 42}))


async def finish(manager, workflow, record):
    active = manager.active[(workflow.id, record["id"])]
    await asyncio.wait_for(asyncio.shield(active.task), 5)
    return runner.read_run(workflow.id, record["id"])


def test_chain_snapshot_review_and_lineage(runtime):
    manager, fifo, gpu = runtime
    workflow = project(("upscale", "upscale"))
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        snapshot = store.get_job(workflow.id, record["id"])
        completed = await finish(manager, workflow, record)
        assert completed["status"] == "completed", completed["error"]
        assert [(o["width"], o["height"]) for o in completed["outputs"]] == [(64, 48), (128, 96)]
        assert [r["effective_seed"] for r in completed["stage_results"]] == [42, 43]
        assert store.get_job(workflow.id, record["id"]) == snapshot
        assert len(store.get(workflow.id).assets) == 1
        output = completed["outputs"][-1]
        kept = runner.accept_output(workflow.id, record["id"], output["id"], workflow.revision)
        assert kept.assets[-1].origin["job_id"] == record["id"]
        assert len(kept.assets) == 2
        with pytest.raises(store.Conflict):
            runner.accept_output(workflow.id, record["id"], output["id"], workflow.revision)
        branch = store.branch(workflow.id, kept.revision)
        assert branch.assets[-1].origin == kept.assets[-1].origin
        assert fifo.active is None and gpu.current_owner() is None
    asyncio.run(scenario())


def test_queued_cancel_never_enters_provider(runtime, monkeypatch):
    manager, fifo, gpu = runtime
    fifo.paused = True
    workflow = project()
    monkeypatch.setattr(runner, "provider_factory", lambda: pytest.fail("Cancelled queued job executed"))
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        second = await manager.start(workflow.id, workflow.revision)
        assert second["id"] != record["id"]
        await manager.cancel(workflow.id, record["id"])
        result = await finish(manager, workflow, record)
        assert result["status"] == "cancelled"
        assert result["outputs"] == []
        assert runner.read_run(workflow.id, second["id"])["status"] == "queued"
        await manager.cancel(workflow.id, second["id"])
        assert (await finish(manager, workflow, second))["status"] == "cancelled"
        assert gpu.current_owner() is None
    asyncio.run(scenario())


def test_cancel_waits_for_native_worker_before_releasing_lease(runtime, monkeypatch):
    manager, fifo, gpu = runtime
    entered, release, exited = threading.Event(), threading.Event(), threading.Event()
    class Slow(PillowProvider):
        async def execute(self, request, context):
            def native(request, context):
                entered.set()
                release.wait(4)
                exited.set()
                context.check_cancelled()
            return await thread_work(native, request, context)
    monkeypatch.setattr(runner, "provider_factory", lambda: {"test": Slow()})
    workflow = project()
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        assert await asyncio.to_thread(entered.wait, 2)
        try:
            await manager.cancel(workflow.id, record["id"])
            await asyncio.sleep(.05)
            assert gpu.current_owner() == f"workflow:{record['id']}"
            assert runner.read_run(workflow.id, record["id"])["status"] == "cancelling"
            assert not exited.is_set()
        finally:
            release.set()
        result = await finish(manager, workflow, record)
        assert result["status"] == "cancelled" and result["outputs"] == []
        assert exited.is_set() and gpu.current_owner() is None and fifo.active is None
    asyncio.run(scenario())


@pytest.mark.parametrize("bad", ["escape", "size", "failure"])
def test_bad_provider_outputs_are_never_published(runtime, monkeypatch, tmp_path, bad):
    manager, fifo, gpu = runtime
    class Bad(PillowProvider):
        async def execute(self, request, context):
            if bad == "failure":
                raise RuntimeError("Inference failed")
            path = (tmp_path if bad == "escape" else context.output_dir) / f"{uuid.uuid4().hex}.png"
            Image.new("RGB", (1, 1)).save(path)
            return StageResult((path,))
    monkeypatch.setattr(runner, "provider_factory", lambda: {"test": Bad()})
    workflow = project()
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        result = await finish(manager, workflow, record)
        assert result["status"] == "failed" and result["outputs"] == []
        assert gpu.current_owner() is None and fifo.active is None
        with pytest.raises(store.NotFound):
            runner.output_path(workflow.id, record["id"], "a" * 32)
    asyncio.run(scenario())


@pytest.mark.parametrize("change,code", [({"provider_slot": "absent"}, "provider_unavailable"),
                                      ({"model_id": "missing"}, "model_unavailable")])
def test_missing_provider_or_model_blocks_admission(runtime, change, code):
    manager, fifo, gpu = runtime
    workflow = project(("img2img",), **change)
    assert code in {issue["code"] for issue in runner.preflight(workflow)["issues"]}
    with pytest.raises(ValueError, match="Cannot run"):
        asyncio.run(manager.start(workflow.id, workflow.revision))
    assert not fifo.jobs and not manager.active


def test_tampered_input_and_kept_output_rejected(runtime):
    manager, _, _ = runtime
    workflow = project()
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        result = await finish(manager, workflow, record)
        output = result["outputs"][0]
        path, _ = runner.output_path(workflow.id, record["id"], output["id"])
        path.write_bytes(b"changed")
        with pytest.raises(store.Conflict):
            runner.accept_output(workflow.id, record["id"], output["id"], workflow.revision)
    asyncio.run(scenario())
    runner._asset(workflow, workflow.assets[0].id).write_bytes(b"changed")
    assert "asset_integrity" in {i["code"] for i in runner.preflight(workflow)["issues"]}


def test_shutdown_and_restart_do_not_publish_partial_outputs(runtime):
    manager, fifo, gpu = runtime
    workflow = project()
    fifo.paused = True
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        await manager.shutdown()
        assert runner.read_run(workflow.id, record["id"])["status"] == "cancelled"
        runner._patch(workflow.id, record["id"], status="running")
        assert runner.Runner().recover() == 1
        recovered = runner.read_run(workflow.id, record["id"])
        assert recovered["status"] == "interrupted" and recovered["outputs"] == []
        assert gpu.current_owner() is None
    asyncio.run(scenario())


def test_failed_later_stage_preserves_committed_output_and_recovery(runtime, monkeypatch):
    manager, _, _ = runtime
    workflow = project(("upscale", "upscale"))
    class FailSecond(PillowProvider):
        async def execute(self, request, context):
            if request.stage.id == workflow.stages[1].id:
                raise RuntimeError("second stage failed")
            return await super().execute(request, context)
    monkeypatch.setattr(runner, "provider_factory", lambda: {"test": FailSecond()})
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        result = await finish(manager, workflow, record)
        assert result["status"] == "failed" and len(result["outputs"]) == 1
        output = result["outputs"][0]
        assert runner.output_path(workflow.id, record["id"], output["id"])[0].is_file()
        runner._patch(workflow.id, record["id"], status="running")
        assert runner.Runner().recover() == 1
        recovered = runner.read_run(workflow.id, record["id"])
        assert recovered["status"] == "interrupted" and recovered["outputs"] == result["outputs"]
        kept = runner.accept_output(workflow.id, record["id"], output["id"], workflow.revision)
        assert output["sha256"] in {a.id for a in kept.assets}
    asyncio.run(scenario())


def test_random_seed_persisted_before_admission(runtime):
    manager, fifo, _ = runtime
    workflow = project()
    workflow.prompt_settings.seed = -1
    store._write(store._directory(workflow.id) / "workflow.json", workflow.model_dump())
    fifo.paused = True
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        assert 0 <= record["seed"] < 2**32
        assert runner.read_run(workflow.id, record["id"])["seed"] == record["seed"]
        await manager.shutdown()
    asyncio.run(scenario())


def test_stage_input_dimensions_validate_masks_and_resize_limit(runtime):
    workflow = project(("upscale", "inpaint"))
    workflow.stages[-1].mask_asset_id = workflow.assets[0].id
    assert "mask_size_mismatch" in {i["code"] for i in runner.preflight(workflow)["issues"]}
    workflow = project(("upscale",) * 8)
    assert "output_too_large" in {i["code"] for i in runner.preflight(workflow)["issues"]}


def test_confined_paths_reject_parent_escape(runtime, tmp_path):
    with pytest.raises(ValueError, match="escapes"):
        store.confined(store.ROOT / ".." / "outside.png")


def test_description_requires_manual_prompt_adoption(runtime, monkeypatch):
    manager, _, _ = runtime
    class Vision:
        operations = {"describe"}
        async def execute(self, request, context):
            return StageResult(text="A blue rectangle", metadata={"provider": "test"})
    monkeypatch.setattr(runner, "provider_factory", lambda: {"test": Vision()})
    workflow = project(("describe",))
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        result = await finish(manager, workflow, record)
        assert result["status"] == "completed"
        assert result["stage_results"][0]["text"] == "A blue rectangle"
        assert store.get(workflow.id).prompt_settings.prompt == "Test scene"
    asyncio.run(scenario())


def test_exif_oriented_source_uses_display_dimensions(runtime):
    manager, _, _ = runtime
    workflow = store.create("Rotated photograph")
    image = Image.new("RGB", (32, 24), "blue")
    exif = image.getexif()
    exif[274] = 6
    data = io.BytesIO()
    image.save(data, "JPEG", exif=exif)
    workflow = store.add_asset(workflow.id, workflow.revision, "rotated.jpg", data.getvalue())
    assert (workflow.assets[0].width, workflow.assets[0].height) == (24, 32)
    workflow = store.update(workflow.id, UpdateRequest(revision=workflow.revision, name=workflow.name,
        stages=[{"id": "a" * 32, "operation": "upscale", "provider_slot": "test",
                 "source": {"kind": "asset", "id": workflow.assets[0].id}}]))
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        result = await finish(manager, workflow, record)
        assert result["status"] == "completed", result["error"]
        assert (result["outputs"][0]["width"], result["outputs"][0]["height"]) == (48, 64)
    asyncio.run(scenario())


def test_global_reset_cancels_workflow_before_unloading(runtime, monkeypatch):
    import main
    from services import gpu_coordination
    manager, fifo, gpu = runtime
    entered = asyncio.Event()
    class Waiting(PillowProvider):
        async def execute(self, request, context):
            entered.set()
            await asyncio.Event().wait()
    monkeypatch.setattr(runner, "provider_factory", lambda: {"test": Waiting()})
    monkeypatch.setattr(main, "queue", fifo)
    monkeypatch.setattr(gpu_coordination, "gpu_coordinator", gpu)
    async def unload():
        assert gpu.current_owner() is None and fifo.active is None
        return {"reset": True}
    monkeypatch.setattr(main, "_reset_runtime", unload)
    workflow = project()
    async def scenario():
        record = await manager.start(workflow.id, workflow.revision)
        await asyncio.wait_for(entered.wait(), 2)
        result = await asyncio.wait_for(main.reset_runtime(), 3)
        assert result["reset"] is True
        assert runner.read_run(workflow.id, record["id"])["status"] == "cancelled"
        assert not fifo.paused
    asyncio.run(scenario())


def test_multiple_revisions_queue_with_independent_snapshots(runtime):
    manager, fifo, gpu = runtime
    fifo.paused = True
    workflow = project()
    async def scenario():
        first = await manager.start(workflow.id, workflow.revision)
        revised = store.update(workflow.id, UpdateRequest(revision=workflow.revision, name=workflow.name,
            stages=[stage.model_dump() for stage in workflow.stages], prompt_settings={"prompt": "Second scene", "seed": 77}))
        second = await manager.start(revised.id, revised.revision)
        assert first["id"] != second["id"]
        assert store.get_job(workflow.id, first["id"])["snapshot"]["prompt_settings"]["prompt"] == "Test scene"
        assert store.get_job(workflow.id, second["id"])["snapshot"]["prompt_settings"]["prompt"] == "Second scene"
        tasks = [manager.active[(workflow.id, record["id"])].task for record in (first, second)]
        fifo.paused = False
        await asyncio.wait_for(asyncio.gather(*tasks), 5)
        assert runner.read_run(workflow.id, first["id"])["status"] == "completed"
        assert runner.read_run(workflow.id, second["id"])["status"] == "completed"
        assert runner.read_run(workflow.id, first["id"])["stage_results"][0]["effective_seed"] == 42
        assert runner.read_run(workflow.id, second["id"])["stage_results"][0]["effective_seed"] == 77
        assert not manager.active and gpu.current_owner() is None
    asyncio.run(scenario())
