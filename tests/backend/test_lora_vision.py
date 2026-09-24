import asyncio
import json
from pathlib import Path

import httpx
import pytest

from services import lora_vision


@pytest.mark.parametrize("limit", [4, 2, 1])
def test_batches_cover_entire_dataset_and_split_context_errors(monkeypatch, limit):
    from services.image_generation import manager
    from services.gpu_coordination import GpuCoordinator
    coordinator = GpuCoordinator()
    monkeypatch.setattr(lora_vision, "gpu_coordinator", coordinator)
    monkeypatch.setattr(manager, "unload_for_training", lambda: None)
    async def models():
        return [{"name": "vision"}]
    monkeypatch.setattr(lora_vision, "list_vision_models", models)
    monkeypatch.setattr(lora_vision.lora_store, "image_path", lambda _, image_id: Path(image_id))
    monkeypatch.setattr(lora_vision, "_analysis_image", lambda path: path.name)
    received = []

    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, json):
            assert json["keep_alive"] == lora_vision.settings.ollama_keep_alive_seconds
            images = json["messages"][0]["images"]
            request = httpx.Request("POST", url)
            if len(images) > limit:
                return httpx.Response(400, request=request, json={"error": "request exceeds available context size"})
            assert lora_vision.analysis_progress("project")["completed"] == len(received)
            received.extend(images)
            content = {"summary": "Batch summary", "stable_traits": ["blue hair"], "images": [
                {"index": i + 1, "caption": name} for i, name in enumerate(images)
            ]}
            return httpx.Response(200, request=request, json={"message": {"content": __import__("json").dumps(content)}})

    monkeypatch.setattr(lora_vision.httpx, "AsyncClient", Client)
    project = {"id": "project", "trigger_word": "trigger", "images": [{"id": f"image-{i}"} for i in range(75)]}
    result = asyncio.run(lora_vision.analyze_project(project, "vision"))
    assert received == [item["id"] for item in project["images"]]
    assert [item["image_id"] for item in result["images"]] == received
    assert result["stable_traits"] == ["blue hair"]
    assert result["cpu_assistance"]["mode"] == "auto"
    assert result["cpu_assistance"]["preparation_wait_seconds"] >= 0
    assert result["timings"]["vision_seconds"] >= 0
    assert all(item["caption_suggestion"] == f"trigger, {item['image_id']}" for item in result["images"])
    assert coordinator.current_owner() is None
    assert lora_vision.analysis_progress("project") is None


def test_cancellation_releases_gpu_without_returning_partial_analysis(monkeypatch):
    from services.image_generation import manager
    from services.gpu_coordination import GpuCoordinator
    coordinator = GpuCoordinator()
    monkeypatch.setattr(lora_vision, "gpu_coordinator", coordinator)
    monkeypatch.setattr(manager, "unload_for_training", lambda: None)
    async def models(): return [{"name": "vision"}]
    monkeypatch.setattr(lora_vision, "list_vision_models", models)
    monkeypatch.setattr(lora_vision.lora_store, "image_path", lambda *args: Path("image"))
    monkeypatch.setattr(lora_vision, "_analysis_image", lambda path: "image")
    class Client:
        def __init__(self, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, *args, **kwargs): raise asyncio.CancelledError()
    monkeypatch.setattr(lora_vision.httpx, "AsyncClient", Client)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(lora_vision.analyze_project({"id": "project", "images": [{"id": "one"}]}, "vision"))
    assert coordinator.current_owner() is None
    assert lora_vision.analysis_progress("project") is None


def test_normalize_analysis_maps_ordered_results_to_persisted_image_ids():
    project = {
        "id": "a" * 32,
        "trigger_word": "storychar",
        "images": [
            {"id": "1" * 32, "original_filename": "front.png"},
            {"id": "2" * 32, "original_filename": "run.png"},
        ],
    }
    raw = {
        "summary": "A consistent fictional character",
        "stable_traits": ["silver hair", "green jacket"],
        "dataset_warnings": ["Only two views"],
        "images": [
            {"index": 1, "caption": "front portrait", "view": "front", "pose_action": "standing", "expression": "neutral", "scene": "studio", "quality_flags": []},
            {"index": 2, "caption": "running outdoors", "view": "three-quarter", "pose_action": "running", "expression": "focused", "scene": "street", "quality_flags": ["motion blur"]},
        ],
    }

    result = lora_vision.normalize_analysis(project, raw, "qwen3-vl:8b")

    assert result["summary"] == raw["summary"]
    assert result["images"][0]["image_id"] == "1" * 32
    assert result["images"][0]["caption_suggestion"].startswith("storychar,")
    assert result["images"][1]["analysis"]["quality_flags"] == ["motion blur"]


def test_parse_model_content_accepts_json_and_rejects_non_objects():
    assert lora_vision.parse_model_content(json.dumps({"summary": "ok"})) == {"summary": "ok"}

    try:
        lora_vision.parse_model_content("[1, 2]")
    except ValueError as exc:
        assert "JSON object" in str(exc)
    else:
        raise AssertionError("Non-object JSON should be rejected")


def test_model_message_content_uses_ollama_thinking_only_when_content_is_empty():
    assert lora_vision.model_message_content({"content": '{"source":"content"}', "thinking": '{"source":"thinking"}'}) == '{"source":"content"}'
    assert lora_vision.model_message_content({"content": "", "thinking": '{"source":"thinking"}'}) == '{"source":"thinking"}'


def test_list_vision_models_filters_ollama_capabilities(monkeypatch):
    class Response:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    class Client:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url):
            return Response({"models": [
                {"name": "qwen3-vl:8b", "size": 6100, "details": {"parameter_size": "8.8B"}},
                {"name": "qwen3.5:9b", "size": 6200},
            ]})

        async def post(self, _url, json):
            capabilities = ["completion", "vision"] if json["model"] == "qwen3-vl:8b" else ["completion"]
            return Response({"capabilities": capabilities})

    monkeypatch.setattr(lora_vision.httpx, "AsyncClient", Client)

    models = asyncio.run(lora_vision.list_vision_models())

    assert [item["name"] for item in models] == ["qwen3-vl:8b"]
    assert models[0]["parameter_size"] == "8.8B"
