import asyncio
import io
import json
import threading
from unittest.mock import Mock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from services import image_library, image_vault
from services.image_workflows import adapters, store
from services.image_workflows.contracts import PromptSettings, Stage, UpdateRequest
from services.image_workflows.scene_analysis import ImageSource, ImportSourceRequest, import_source, parse_analysis
from services.image_workflows.scene_state import SceneState
from services.image_workflows.providers import PreparedStage, ExecutionContext


@pytest.fixture
def source(tmp_path, monkeypatch):
    monkeypatch.setattr(image_library, "ROOT", tmp_path / "library")
    monkeypatch.setattr(image_vault, "ROOT", tmp_path / "vault")
    monkeypatch.setattr(store, "ROOT", tmp_path / "workflows")
    content = io.BytesIO()
    Image.new("RGB", (256, 384), "blue").save(content, "PNG")
    image = image_library.import_image(content.getvalue(), "Source.png")
    return image, content.getvalue(), store.create("Scene analysis")


def test_import_is_owned_and_revision_checked_without_mutating_source(source):
    image, content, workflow = source
    index_before = image_library.read_index()
    request = ImportSourceRequest(revision=workflow.revision, source={"kind": "library", "id": image["id"]})
    imported = import_source(workflow.id, request)
    assert store.get(workflow.id) == imported
    assert imported.assets[0].origin == {"kind": "library", "id": image["id"]}
    path, _ = store.asset_path(workflow.id, imported.assets[0].id)
    assert path.read_bytes() == content and image_library.read_index() == index_before
    with pytest.raises(store.Conflict):
        import_source(workflow.id, request)
    image_library.delete_image(image["id"])
    assert path.read_bytes() == content


def test_private_source_cannot_be_copied_into_a_public_scene(source, monkeypatch):
    image, _, workflow = source
    monkeypatch.setattr(image_vault, "is_locked", lambda _hash: True)
    with pytest.raises(image_vault.LockedImageError):
        import_source(workflow.id, ImportSourceRequest(revision=1, source={"kind": "library", "id": image["id"]}))
    assert store.get(workflow.id) == workflow
    assert not (store._directory(workflow.id) / "assets").exists()


@pytest.mark.parametrize("source", [{"kind": "url", "url": "https://example.com/a.png"},
    {"kind": "library", "id": "../../secret"}, {"kind": "session", "session_id": "s"},
    {"kind": "workflow", "workflow_id": "a" * 32, "job_id": "b" * 32, "layout": "invalid"}])
def test_import_rejects_paths_unknown_sources_and_incomplete_ids(source):
    with pytest.raises(ValueError): ImageSource.model_validate(source)


def test_scene_analysis_is_validated_and_never_assigns_an_approved_identity():
    data = {"state": {"character": {"name": "Guessed name", "profile_id": "a" * 32}, "current_action": "Holding cup"},
            "observations": "Seated", "uncertainties": ["Hand obscured"], "suggestions": ["Raise cup"]}
    result = parse_analysis(json.dumps(data))
    assert result.state.character.profile_id is None and result.state.character.name == ""
    assert result.state.current_action == "Holding cup"
    with pytest.raises(ValueError, match="valid scene analysis"): parse_analysis("not JSON")
    data["state"]["body"] = {"invented_field": "value"}
    with pytest.raises(ValueError): parse_analysis(json.dumps(data))


def test_vision_uses_structured_scene_output_and_keeps_suggestions_separate(source, tmp_path, monkeypatch):
    _, content, _ = source
    path = tmp_path / "source.png"; path.write_bytes(content)
    data = {"state": SceneState(current_action="Holding cup").model_dump(), "observations": "Seated figure", "suggestions": ["Raise cup"]}
    sent = []
    async def handler(request):
        if request.url.path == "/api/show": return httpx.Response(200, json={"capabilities": ["vision"]})
        payload = json.loads(request.content); sent.append(payload)
        return httpx.Response(200, text=json.dumps({"message": {"content": json.dumps(data)}, "done": True}) + "\n")
    client_type = httpx.AsyncClient
    monkeypatch.setattr(adapters.httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs))
    stage = Stage(id="a" * 32, operation="describe", provider_slot="ollama-vision", model_id="local", analysis_kind="scene")
    request = PreparedStage(stage, PromptSettings(seed=42), path, None, None, ())
    result = asyncio.run(adapters.OllamaProvider().execute(request, ExecutionContext("job", tmp_path, threading.Event())))
    assert "state" in sent[0]["format"]["properties"]
    assert sent[0]["think"] is False
    assert result.metadata["scene_analysis"]["state"]["current_action"] == "Holding cup"
    assert result.metadata["scene_analysis"]["suggestions"] == ["Raise cup"]


def test_import_route_and_scene_conversion_keep_the_owned_source(source):
    from routes.image_workflows import router
    image, content, workflow = source
    app = FastAPI(); app.include_router(router)
    client = TestClient(app)
    response = client.post(f"/image-workflows/{workflow.id}/source", json={"revision": 1, "source": {"kind": "library", "id": image["id"]}})
    assert response.status_code == 200, response.text
    saved = response.json()
    update = {key: value for key, value in saved.items() if key in UpdateRequest.model_fields}
    update.update(mode="scene", stages=[], scene={"state": {"current_action": "Holding cup"}, "source_asset_id": saved["assets"][0]["id"]})
    scene = client.put(f"/image-workflows/{workflow.id}", json=update)
    assert scene.status_code == 200, scene.text
    assert scene.json()["stages"][0]["operation"] == "img2img"
    assert store.asset_path(workflow.id, saved["assets"][0]["id"])[0].read_bytes() == content


def test_prompt_analysis_opt_out_never_reads_or_writes_chat_memory(monkeypatch):
    import main
    from conftest import API_BASE_URL, AUTH_HEADERS
    from services.gpu_coordination import GpuCoordinator
    from services.request_queue import RequestQueue
    memory = Mock(side_effect=AssertionError("Prompt analysis must not access durable memory"))
    monkeypatch.setattr(main, "create_user_if_missing", memory)
    monkeypatch.setattr(main, "save_message", memory)
    monkeypatch.setattr(main, "queue", RequestQueue(GpuCoordinator()))
    monkeypatch.setattr(main, "_append_thinking", lambda *_: None)
    async def prepare(_): pass
    monkeypatch.setattr(main, "prepare_runtime", prepare)
    async def handler(request):
        payload = json.loads(request.content)
        assert len(payload["messages"]) == 2
        return httpx.Response(200, text='{"message":{"content":"revision"},"done":true}\n')
    client_type = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs))
    client = TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS)
    response = client.post("/chat", json={"model": "local", "use_memory": False, "use_knowledge_base": False,
        "system_prompt": "Analyze prompts", "messages": [{"role": "user", "content": "Portrait"}]})
    assert response.status_code == 200 and "revision" in response.text
    memory.assert_not_called()
    assert main.ChatRequest(messages=[]).use_memory is True
