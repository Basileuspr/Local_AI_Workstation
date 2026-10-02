import asyncio
import json

import httpx
import pytest

from services import chat_model_runtime as runtime
from services.gpu_coordination import GpuCoordinator
from services.request_queue import QueueCancelled, RequestQueue


def provider(monkeypatch, loaded, fail_unload=False, ignore_unload=False):
    calls = []
    async def handle(request):
        if request.url.path == "/api/ps":
            return httpx.Response(200, json={"models": [{"name": name} for name in loaded]})
        body = json.loads(request.content)
        calls.append(body)
        if body.get("keep_alive") == 0:
            if fail_unload:
                return httpx.Response(500, json={"error": "Unload failed"})
            if not ignore_unload:
                loaded.remove(body["model"])
        else:
            loaded.append(runtime.canonical_model(body["model"]))
        return httpx.Response(200, json={"done": True})
    original = httpx.AsyncClient
    transport = httpx.MockTransport(handle)
    monkeypatch.setattr(runtime.httpx, "AsyncClient", lambda **kw: original(transport=transport, **kw))
    return calls


def test_two_chats_switch_only_after_admission_and_reuse_matching_model(monkeypatch):
    loaded = ["alpha:latest"]
    calls = provider(monkeypatch, loaded)
    async def scenario():
        queue = RequestQueue(GpuCoordinator())
        first = queue.enqueue("chat", "A", model="alpha", session_id="chat-a")
        second = queue.enqueue("chat", "B", model="beta", session_id="chat-b")
        assert queue.try_start(first)
        assert not queue.try_start(second)
        with pytest.raises(ValueError, match="lease"):
            async for _ in runtime.prepare_chat_model(second, "beta", "http://model", request_queue=queue):
                pass
        assert not calls  # A's running model has not been touched.
        queue.finish(first)
        assert queue.try_start(second)
        progress = [event async for event in runtime.prepare_chat_model(second, "beta", "http://model",
                    options={"num_ctx": 8192}, request_queue=queue)]
        assert [event["stage"] for event in progress] == ["checking_model", "switching_models", "loading_model", "responding"]
        assert all(event["session_id"] == "chat-b" and event["model"] == "beta" for event in progress)
        assert calls[0] == {"model": "alpha:latest", "keep_alive": 0, "stream": False}
        assert calls[1]["options"] == {"num_ctx": 8192}
        assert loaded == ["beta:latest"]
        queue.finish(second)
        third = queue.enqueue("chat", "B follow-up", model="beta")
        queue.try_start(third)
        progress = [event async for event in runtime.prepare_chat_model(third, "beta", "http://model", request_queue=queue)]
        assert len(calls) == 2  # Same model retains its allocation.
        assert [event["stage"] for event in progress] == ["checking_model", "responding"]
        queue.finish(third)
        fourth = queue.enqueue("chat", "A again", model="alpha")
        queue.try_start(fourth)
        [event async for event in runtime.prepare_chat_model(fourth, "alpha", "http://model", request_queue=queue)]
        assert loaded == ["alpha:latest"]
    asyncio.run(scenario())


def test_failed_unload_does_not_load_another_model(monkeypatch):
    loaded = ["alpha:latest"]
    calls = provider(monkeypatch, loaded, fail_unload=True)
    async def scenario():
        queue = RequestQueue(GpuCoordinator())
        job = queue.enqueue("chat", "B", model="beta")
        queue.try_start(job)
        with pytest.raises(httpx.HTTPStatusError):
            [event async for event in runtime.prepare_chat_model(job, "beta", "http://model", request_queue=queue)]
        assert job.stage == "switching_models"
        assert queue.active is job
        assert len(calls) == 1 and loaded == ["alpha:latest"]
        queue.finish(job, "Unload failed")
        assert job.status == "failed" and queue.active is None
    asyncio.run(scenario())


def test_cancelled_handoff_stops_before_loading_and_retains_lease(monkeypatch):
    calls = provider(monkeypatch, ["alpha:latest"])
    async def scenario():
        queue = RequestQueue(GpuCoordinator())
        job = queue.enqueue("chat", "B", model="beta")
        queue.try_start(job)
        iterator = runtime.prepare_chat_model(job, "beta", "http://model", request_queue=queue)
        assert (await anext(iterator))["stage"] == "checking_model"
        assert (await anext(iterator))["stage"] == "switching_models"
        await queue.cancel(job)
        with pytest.raises(QueueCancelled):
            await anext(iterator)
        assert queue.active is job
        assert all(call["keep_alive"] == 0 for call in calls)
        queue.finish(job)
        assert queue.active is None
    asyncio.run(scenario())


def test_verifies_model_inventory_instead_of_claiming_success(monkeypatch):
    provider(monkeypatch, ["alpha:latest"], ignore_unload=True)
    async def scenario():
        queue = RequestQueue(GpuCoordinator())
        job = queue.enqueue("chat", "B", model="beta")
        queue.try_start(job)
        with pytest.raises(ValueError, match="did not finish"):
            [event async for event in runtime.prepare_chat_model(job, "beta", "http://model", request_queue=queue)]
        assert job.stage != "responding"
    asyncio.run(scenario())


def test_registry_port_is_not_a_model_tag():
    assert runtime.canonical_model("registry:5000/library/alpha") == "registry:5000/library/alpha:latest"
    assert runtime.canonical_model("alpha:q4") == "alpha:q4"
