import asyncio
import threading
from types import SimpleNamespace

import pytest

from services.gpu_coordination import GpuCoordinator
from services.request_queue import QueueCancelled, RequestQueue


def test_fifo_reserves_gpu_and_hands_it_to_matching_service_once():
    gpu = GpuCoordinator()
    queue = RequestQueue(gpu)
    chat = queue.enqueue("chat", "first", "1")
    image = queue.enqueue("image", "second", "2", owner="image-generation:2")
    assert not queue.try_start(image)
    assert queue.try_start(chat)
    assert not gpu.acquire("outside-task")
    assert not queue.try_start(image)
    queue.finish(chat)
    assert queue.try_start(image)
    assert gpu.acquire("image-generation:2")
    assert not gpu.acquire("image-generation:2")
    gpu.release("image-generation:2")
    queue.finish(image)
    assert gpu.current_owner() is None
    assert [job["status"] for job in queue.snapshot()["jobs"]] == ["completed", "completed"]


def test_cancelled_waiter_is_skipped_and_running_cancel_retains_gpu():
    async def scenario():
        queue = RequestQueue(GpuCoordinator())
        stopped = []
        first = queue.enqueue("training", "running", "1", cancel=lambda: stopped.append(True))
        second = queue.enqueue("chat", "cancel me", "2")
        third = queue.enqueue("image", "next", "3")
        assert queue.try_start(first)
        assert await queue.cancel(second)
        with pytest.raises(QueueCancelled):
            await queue.wait(second)
        assert await queue.cancel(first)
        assert stopped == [True]
        assert first.status == "cancelling"
        assert not queue.try_start(third)
        queue.finish(first)
        assert queue.try_start(third)
        queue.finish(third, "provider failed")
        assert third.status == "failed"
    asyncio.run(scenario())


def test_external_gpu_owner_and_pause_hold_waiters():
    gpu = GpuCoordinator()
    queue = RequestQueue(gpu)
    gpu.acquire("pdf-ocr")
    job = queue.enqueue("chat", "waiting", "1")
    assert not queue.try_start(job)
    gpu.release("pdf-ocr")
    queue.paused = True
    assert not queue.try_start(job)
    queue.paused = False
    assert queue.try_start(job)
    queue.finish(job)


def test_cpu_jobs_do_not_reserve_gpu_or_block_gpu_fifo():
    gpu = GpuCoordinator()
    queue = RequestQueue(gpu)
    cpu = queue.enqueue("faces", "CPU faces", requires_gpu=False)
    first = queue.enqueue("image", "first GPU")
    second = queue.enqueue("chat", "second GPU")
    assert queue.try_start(first)  # A queued CPU job is not a GPU waiter.
    assert queue.try_start(cpu)
    assert cpu.status == "running" and cpu.started_at
    assert not queue.try_start(second)
    queue.finish(cpu)
    assert gpu.current_owner() == first.owner
    assert queue.active is first
    queue.finish(first)
    assert queue.try_start(second)
    queue.finish(second)
    assert not queue.try_start(cpu)  # Completed CPU work cannot restart.


def test_cpu_cancel_calls_provider_and_pause_holds_new_cpu_work():
    async def scenario():
        gpu = GpuCoordinator()
        queue = RequestQueue(gpu)
        stopped = []
        cpu = queue.enqueue("faces", "CPU faces", requires_gpu=False, cancel=lambda: stopped.append(True))
        queue.paused = True
        assert not queue.try_start(cpu)
        queue.paused = False
        assert queue.try_start(cpu)
        assert gpu.current_owner() is None
        image = queue.enqueue("image", "GPU image")
        assert queue.try_start(image)
        assert await queue.cancel(cpu)
        assert stopped == [True] and cpu.status == "cancelling"
        assert gpu.current_owner() == image.owner
        queue.finish(cpu)
        assert cpu.status == "cancelled" and queue.active is image
        queue.finish(image)
    asyncio.run(scenario())


def test_face_extractor_registers_cpu_work_without_delaying_gpu(monkeypatch):
    from services.faces import pipeline
    gpu = GpuCoordinator()
    queue = RequestQueue(gpu)
    monkeypatch.setattr(pipeline, "queue", queue)
    monkeypatch.setattr(pipeline, "get_provider", lambda: SimpleNamespace(uses_gpu=lambda: False))
    monkeypatch.setattr(pipeline.store, "mark_duplicates", lambda _id: None)
    monkeypatch.setattr(pipeline.store, "cluster", lambda _id: None)
    monkeypatch.setattr(pipeline.store, "save_run", lambda _snapshot: None)
    image = queue.enqueue("image", "active GPU")
    assert queue.try_start(image)
    extractor = pipeline.FaceExtractor()
    async def one_source(run, source, provider, job):
        assert job.status == "running" and not job.requires_gpu
        assert gpu.current_owner() == image.owner
    monkeypatch.setattr(extractor, "_one_source", one_source)
    run = pipeline.FaceRun("dataset", 1)
    asyncio.run(extractor._execute(run, [{}]))
    assert run.status == "complete"
    assert queue.active is image
    queue.finish(image)


@pytest.mark.parametrize("kind", ["image", "workflow", "training"])
def test_gpu_handoff_unloads_all_retained_ollama_models(monkeypatch, kind):
    import httpx
    import json
    from services.request_queue import prepare_runtime
    unloaded = []
    async def handler(request):
        if request.url.path == "/api/ps":
            return httpx.Response(200, json={"models": [{"name": "chat"}, {"model": "embedding"}]})
        assert request.url.path == "/api/generate"
        payload = json.loads(request.content)
        assert payload["keep_alive"] == 0
        unloaded.append(payload["model"])
        return httpx.Response(200, json={"done": True})
    client_type = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs:
        client_type(transport=httpx.MockTransport(handler), **kwargs))
    asyncio.run(prepare_runtime(kind))
    assert unloaded == ["chat", "embedding"]


@pytest.mark.parametrize("kind", ["chat", "compact", "analysis", "embedding"])
def test_ollama_handoff_releases_sdxl_off_the_event_loop(monkeypatch, kind):
    from services.request_queue import prepare_runtime
    from services.image_generation import manager
    caller = threading.get_ident()
    threads = []
    monkeypatch.setattr(manager, "unload_for_training", lambda: threads.append(threading.get_ident()))
    asyncio.run(prepare_runtime(kind))
    assert threads and threads[0] != caller


def test_disconnected_waiter_never_starts():
    async def scenario():
        queue = RequestQueue(GpuCoordinator())
        job = queue.enqueue("image", "closed window")
        class ClosedRequest:
            async def is_disconnected(self):
                return True
        with pytest.raises(QueueCancelled):
            await queue.wait(job, ClosedRequest())
        assert job.status == "cancelled"
        assert queue.active is None
    asyncio.run(scenario())


def test_history_bound_does_not_discard_pending_work():
    queue = RequestQueue(GpuCoordinator())
    pending = queue.enqueue("chat", "pending", "pending")
    for index in range(150):
        job = queue.enqueue("image", str(index), str(index))
        queue.finish(job, "invalid request")
    assert queue.find(job_id=pending.id) is pending
    assert len(queue.jobs) <= 101


def test_mixed_routes_run_in_order_and_training_holds_until_worker_exit(monkeypatch):
    # Full verification runs with LAW_DATA_DIR redirected to a temporary root.
    import main
    from fastapi.responses import StreamingResponse
    from routes import image_generation as images, lora
    from services import request_queue

    async def scenario():
        gpu = GpuCoordinator()
        queue = RequestQueue(gpu)
        for module in (main, images, lora, request_queue):
            monkeypatch.setattr(module, "queue", queue)
        async def prepare(_kind):
            pass
        for module in (main, images, lora):
            monkeypatch.setattr(module, "prepare_runtime", prepare)
        starts = []
        chat_release = asyncio.Event()
        image_release = threading.Event()
        project = {"id": "project", "name": "Test training", "training": {"status": "draft"}}
        monkeypatch.setattr(lora.lora_store, "get_project", lambda _id: project)
        def update(_id, changes):
            project["training"].update(changes)
            return project
        monkeypatch.setattr(lora.lora_store, "update_training", update)
        monkeypatch.setattr(lora.lora_store, "validate_project", lambda *_args: {"valid": True})
        monkeypatch.setattr(lora, "discover_models", lambda: [])
        trainer = SimpleNamespace(run=None)
        def train(_project, _models, run_id, event):
            assert gpu.acquire(f"lora:{run_id}")
            assert not event.is_set()
            trainer.run = run_id
            starts.append("training")
            update(_project, {"status": "running"})
            return project["training"]
        trainer.start = train
        trainer.is_run_pending = lambda run_id: trainer.run == run_id
        monkeypatch.setattr(lora, "manager", trainer)
        async def fake_chat(request, _client):
            async def tokens():
                starts.append(request.request_id)
                if request.request_id == "chat-1":
                    await chat_release.wait()
                yield 'data: {"token":"ok","done":true}\n\n'
            return StreamingResponse(tokens())
        monkeypatch.setattr(main, "_chat", fake_chat)
        def generate(request, event):
            assert gpu.acquire(f"image-generation:{request.request_id}")
            starts.append("image")
            assert image_release.wait(5)
            gpu.release(f"image-generation:{request.request_id}")
            return {"filename": "test.png"}
        monkeypatch.setattr(images, "_generate_image", generate)
        class Client:
            async def is_disconnected(self):
                return False
        client = Client()
        async def consume(response):
            return [chunk async for chunk in response.body_iterator]
        async def until(condition):
            async with asyncio.timeout(5):
                while not condition():
                    await asyncio.sleep(0.01)
        response = await main.chat(main.ChatRequest(request_id="chat-1", messages=[]), client)
        chat_task = asyncio.create_task(consume(response))
        await until(lambda: starts == ["chat-1"])
        image_task = asyncio.create_task(images.generate_image(images.ImageGenerationRequest(request_id="image", model_id="test", prompt="test"), client))
        await until(lambda: queue.find(kind="image", request_id="image") is not None)
        training = await lora.start_training("project")
        assert training["status"] == "queued"
        chat_release.set()
        await chat_task
        await until(lambda: starts == ["chat-1", "image"])
        assert trainer.run is None
        image_release.set()
        assert (await image_task)["filename"] == "test.png"
        await until(lambda: trainer.run is not None)
        response = await main.chat(main.ChatRequest(request_id="chat-2", messages=[]), client)
        last_chat = asyncio.create_task(consume(response))
        await asyncio.sleep(0.05)
        assert starts == ["chat-1", "image", "training"]
        assert "chat-2" not in main.active_generation_tasks
        update("project", {"status": "completed"})
        gpu.release(f"lora:{trainer.run}")
        trainer.run = None
        await asyncio.wait_for(last_chat, 5)
        await asyncio.gather(*list(lora.training_queue_tasks))
        assert starts == ["chat-1", "image", "training", "chat-2"]
        assert all(job.status == "completed" for job in queue.jobs)
        assert queue.active is None
    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_source", ["queue", "task", "disconnect"])
def test_image_cancellation_keeps_queue_slot_until_worker_cleanup(monkeypatch, cancel_source):
    from fastapi import HTTPException
    from routes import image_generation as images
    async def scenario():
        gpu = GpuCoordinator()
        queue = RequestQueue(gpu)
        monkeypatch.setattr(images, "queue", queue)
        async def prepare(_kind):
            pass
        monkeypatch.setattr(images, "prepare_runtime", prepare)
        started = threading.Event()
        cleanup = threading.Event()
        event_loop_thread = threading.get_ident()
        def generate(request, event):
            assert threading.get_ident() != event_loop_thread
            assert gpu.acquire(f"image-generation:{request.request_id}")
            started.set()
            assert event.wait(5)
            assert cleanup.wait(5)
            gpu.release(f"image-generation:{request.request_id}")
            return {"filename": "cancelled.png"}
        monkeypatch.setattr(images, "_generate_image", generate)
        monkeypatch.setattr(images.manager, "cancel", lambda _id: True)
        disconnected = False
        class Client:
            async def is_disconnected(self):
                return disconnected
        task = asyncio.create_task(images.generate_image(images.ImageGenerationRequest(request_id="cancel-image", model_id="test", prompt="test"), Client()))
        async with asyncio.timeout(5):
            while not started.is_set():
                await asyncio.sleep(0.01)
        job = queue.find(kind="image", request_id="cancel-image")
        next_job = queue.enqueue("chat", "next")
        if cancel_source == "task":
            task.cancel()
        elif cancel_source == "disconnect":
            disconnected = True
        else:
            await queue.cancel(job)
        async with asyncio.timeout(2):
            while not job.cancel_event.is_set():
                await asyncio.sleep(0.01)
        assert job.cancel_event.is_set()
        assert queue.active is job
        assert not queue.try_start(next_job)
        cleanup.set()
        with pytest.raises(HTTPException) as failure:
            await asyncio.wait_for(task, 5)
        assert failure.value.status_code == 499
        assert job.status == "cancelled"
        assert queue.try_start(next_job)
        queue.finish(next_job)
    asyncio.run(scenario())


@pytest.mark.parametrize("provider_error", [False, True])
def test_image_response_finishes_when_disconnect_probe_swallows_cancellation(monkeypatch, provider_error):
    from routes import image_generation as images

    async def scenario():
        queue = RequestQueue(GpuCoordinator())
        monkeypatch.setattr(images, "queue", queue)
        async def prepare(_kind):
            pass
        monkeypatch.setattr(images, "prepare_runtime", prepare)
        probing = threading.Event()
        disconnect = False
        calls = 0

        class Client:
            async def is_disconnected(self):
                nonlocal calls
                calls += 1
                if calls > 1:
                    probing.set()
                    # A cancelled receive probe may consume cancellation inside
                    # its own cancellation scope. It must not strand cleanup.
                    try:
                        await asyncio.sleep(0.03)
                    except asyncio.CancelledError:
                        pass
                return disconnect

        def generate(*_args):
            assert probing.wait(2)
            if provider_error:
                raise RuntimeError("fixture provider failed")
            return {"filename": "saved.png"}

        monkeypatch.setattr(images, "_generate_image", generate)
        task = asyncio.create_task(images.generate_image(
            images.ImageGenerationRequest(request_id="cleanup", model_id="test", prompt="test"), Client()))
        try:
            done, _ = await asyncio.wait([task], timeout=0.3)
            assert done, "Provider finished but response and queue cleanup are stuck"
            if provider_error:
                with pytest.raises(RuntimeError, match="fixture provider failed"):
                    task.result()
            else:
                assert task.result()["filename"] == "saved.png"
            assert queue.active is None
            assert queue.jobs[-1].status == ("failed" if provider_error else "completed")
            next_job = queue.enqueue("chat", "next")
            assert queue.try_start(next_job)
            queue.finish(next_job)
        finally:
            disconnect = True
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(scenario())


def test_queued_lora_is_immutable_and_restart_marks_it_interrupted(lora_paths, monkeypatch):
    from services import lora_store, request_queue
    queue = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(request_queue, "queue", queue)
    project = lora_store.create_project("Queued", training_goal="style")
    job = queue.enqueue("training", "Queued", project_id=project["id"])
    lora_store.update_training(project["id"], {"status": "queued", "queue_id": job.id})
    with pytest.raises(ValueError, match="cannot change"):
        lora_store.update_project(project["id"], {"name": "Changed"})
    monkeypatch.setattr(request_queue, "queue", RequestQueue(GpuCoordinator()))
    restored = lora_store.get_project(project["id"])
    assert restored["training"]["status"] == "interrupted"
    assert lora_store.update_project(project["id"], {"name": "Editable again"})["name"] == "Editable again"


@pytest.mark.parametrize("cancel", [False, True])
def test_real_chat_stream_wrapper_closes_upstream_before_queue_release(monkeypatch, cancel):
    import main
    async def scenario():
        queue = RequestQueue(GpuCoordinator())
        monkeypatch.setattr(main, "queue", queue)
        async def prepare(_kind):
            pass
        monkeypatch.setattr(main, "prepare_runtime", prepare)
        monkeypatch.setattr(main, "_append_thinking", lambda _text: None)
        monkeypatch.setattr(main, "create_user_if_missing", lambda _username: SimpleNamespace(id=1))
        monkeypatch.setattr(main, "get_or_create_memory_session", lambda **_kwargs: SimpleNamespace(id=1))
        monkeypatch.setattr(main, "save_message", lambda *_args: None)
        monkeypatch.setattr(main, "get_relevant_memories", lambda **_kwargs: [])
        opened = asyncio.Event()
        closed = []
        class Response:
            is_error = False
            async def __aenter__(self):
                opened.set()
                return self
            async def __aexit__(self, *_args):
                # Even a cancelled provider must still own its slot here.
                assert queue.active is not None
                closed.append(True)
            async def aiter_lines(self):
                yield '{"message":{"content":"Hello"},"done":false}'
                if cancel:
                    await asyncio.Event().wait()
                yield '{"message":{"content":" world"},"done":true}'
        class Provider:
            def __init__(self, **_kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *_args): pass
            def stream(self, _method, _url, json):
                assert json["keep_alive"] == main.settings.ollama_keep_alive_seconds
                return Response()
        monkeypatch.setattr(main.httpx, "AsyncClient", Provider)
        class Client:
            async def is_disconnected(self): return False
        response = await main.chat(main.ChatRequest(request_id="stream-test", messages=[main.ChatMessage(role="user", content="hi")]), Client())
        async def consume(): return [chunk async for chunk in response.body_iterator]
        task = asyncio.create_task(consume())
        await asyncio.wait_for(opened.wait(), 5)
        if cancel:
            await queue.cancel(queue.find(kind="chat", request_id="stream-test"))
        chunks = await asyncio.wait_for(task, 5)
        assert closed == [True]
        assert queue.active is None
        assert queue.jobs[-1].status == ("cancelled" if cancel else "completed")
        assert any('"cancelled": true' in chunk for chunk in chunks) if cancel else any('world' in chunk for chunk in chunks)
    asyncio.run(scenario())
