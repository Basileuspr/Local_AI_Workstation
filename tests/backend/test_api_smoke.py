"""
Route-level smoke tests.

These exercise the HTTP surface the Electron renderer actually calls, so a
broken route is caught here rather than by clicking through the app. Storage
is redirected to a temp directory: no test may touch real chat history.

Note: importing backend.main runs `initialize_database()` and resets the
thinking log, exactly as launching the app does. Both are idempotent.
"""

import io

import pytest

from conftest import API_BASE_URL, AUTH_HEADERS
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture
def client(tmp_path, monkeypatch):
    import main
    from services import image_store, prompt_index_store, session_store

    sessions = tmp_path / "sessions"
    sessions.mkdir()
    monkeypatch.setattr(session_store, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(session_store, "TRASH_DIR", tmp_path / "trash")
    monkeypatch.setattr(session_store, "BACKUPS_DIR", tmp_path / "backups")
    monkeypatch.setattr(session_store, "GENERATED_IMAGES_DIR", tmp_path / "generated_images")
    monkeypatch.setattr(image_store, "BLOBS_DIR", tmp_path / "blobs")
    monkeypatch.setattr(prompt_index_store, "PROMPT_INDEX_PATH", tmp_path / "prompt_index.json")
    monkeypatch.setattr(
        prompt_index_store, "PROMPT_INDEX_DRAFT_PATH", tmp_path / "prompt_index_draft.json"
    )
    monkeypatch.setattr(main, "THINKING_LOG_PATH", tmp_path / "thinking.log")

    with TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS) as test_client:
        yield test_client


# --- health and wiring -----------------------------------------------------

def test_health_reports_ok(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_schema_builds(client):
    """A malformed route signature would break schema generation."""
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert "/chat" in response.json()["paths"]


@pytest.mark.parametrize(
    "path",
    ["/health", "/models", "/sessions/list", "/prompt-index", "/image-generation/models"],
)
def test_core_get_routes_are_reachable(client, path):
    assert client.get(path).status_code == 200


# --- CORS ------------------------------------------------------------------

def test_allowed_origin_receives_cors_headers(client):
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_the_application_origin_is_allowed(client):
    """The packaged app is served over app://, so it has an origin of its own."""
    response = client.get("/health", headers={"Origin": "app://local"})

    assert response.headers.get("access-control-allow-origin") == "app://local"


def test_the_null_origin_is_refused(client):
    """Every sandboxed iframe on the web carries Origin: null, so it cannot be us."""
    response = client.get("/health", headers={"Origin": "null"})

    assert response.status_code == 403
    assert response.headers.get("access-control-allow-origin") != "null"


def test_arbitrary_origin_is_not_granted_access(client):
    """Guards the LAN/CORS lockdown: a random site must not read this API."""
    response = client.get("/health", headers={"Origin": "http://evil.example.com"})

    assert response.headers.get("access-control-allow-origin") is None


# --- sessions --------------------------------------------------------------

def test_session_create_read_update_delete(client):
    created = client.post("/sessions/new", json={}).json()
    session_id = created["id"]

    assert client.get(f"/sessions/{session_id}").json()["title"] == "New Chat"

    updated = client.put(
        f"/sessions/{session_id}",
        json={
            "messages": [{"id": "m1", "role": "user", "content": "hello"}],
            "model": "mistral:latest",
            "memory_summary": "Goals: test the API.",
            "summarized_message_count": 1,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["memory_summary"] == "Goals: test the API."

    listed = client.get("/sessions/list").json()["sessions"]
    assert any(s["id"] == session_id for s in listed)

    assert client.delete(f"/sessions/{session_id}").json() == {"deleted": True}
    assert client.get(f"/sessions/{session_id}").status_code == 404


def test_memory_fields_survive_a_reload_through_the_api(client):
    """End-to-end guard for the rolling-summary wipe bug."""
    session_id = client.post("/sessions/new", json={}).json()["id"]
    client.put(
        f"/sessions/{session_id}",
        json={
            "messages": [{"id": "m1", "role": "user", "content": "hi"}],
            "memory_summary": "Important context.",
            "summarized_message_count": 2,
        },
    )

    # A later save that omits the memory fields must not erase them.
    client.put(
        f"/sessions/{session_id}",
        json={"messages": [{"id": "m1", "role": "user", "content": "hi"}, {"id": "m2", "role": "assistant", "content": "hello"}]},
    )

    reloaded = client.get(f"/sessions/{session_id}").json()
    assert reloaded["memory_summary"] == "Important context."
    assert reloaded["summarized_message_count"] == 2


def test_updating_a_missing_session_returns_404(client):
    response = client.put("/sessions/missing", json={"messages": []})

    assert response.status_code == 404


def test_deleting_a_missing_session_returns_404(client):
    assert client.delete("/sessions/missing").status_code == 404


def test_gallery_index_starts_empty(client):
    assert client.get("/sessions/images").json() == {"images": []}


def test_missing_gallery_image_returns_404(client):
    response = client.get("/sessions/nope/images/by-id/m1/i1")

    assert response.status_code == 404


# --- prompt index ----------------------------------------------------------

def test_prompt_index_entry_lifecycle(client):
    created = client.post(
        "/prompt-index",
        json={"title": "Reusable", "content": "Body text", "source": "chat", "tags": ["a"]},
    ).json()

    assert client.get("/prompt-index").json()["entries"][0]["title"] == "Reusable"

    updated = client.put(
        f"/prompt-index/{created['id']}",
        json={"title": "Renamed", "content": "Body text", "source": "", "tags": []},
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "Renamed"

    assert client.delete(f"/prompt-index/{created['id']}").json() == {"deleted": True}
    assert client.get("/prompt-index").json()["entries"] == []


def test_prompt_index_rejects_an_empty_title(client):
    response = client.post("/prompt-index", json={"title": "  ", "content": "body"})

    assert response.status_code == 400


def test_prompt_index_draft_is_separate_from_entries(client):
    client.post("/prompt-index", json={"title": "Saved", "content": "Committed body"})

    client.put(
        "/prompt-index/draft",
        json={"editor": "new", "form": {"title": "WIP", "content": "unsaved"}, "search": ""},
    )

    state = client.get("/prompt-index/state").json()
    assert [e["title"] for e in state["entries"]] == ["Saved"]
    assert state["draft"]["form"]["title"] == "WIP"

    client.delete("/prompt-index/draft")
    assert client.get("/prompt-index/state").json()["draft"] == {}


def test_updating_a_missing_prompt_entry_returns_404(client):
    response = client.put("/prompt-index/nope", json={"title": "T", "content": "C"})

    assert response.status_code == 404


# --- export ----------------------------------------------------------------

@pytest.mark.parametrize("fmt, media_type", [("txt", "text/plain"), ("md", "text/markdown"), ("json", "application/json")])
def test_export_formats(client, fmt, media_type):
    session_id = client.post("/sessions/new", json={}).json()["id"]
    client.put(
        f"/sessions/{session_id}",
        json={"messages": [{"id": "m1", "role": "user", "content": "exported content"}]},
    )

    response = client.get(f"/export/{session_id}/{fmt}")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(media_type)
    assert "attachment" in response.headers["content-disposition"]
    assert "exported content" in response.text


def test_export_of_a_missing_session_returns_404(client):
    assert client.get("/export/missing/txt").status_code == 404


def test_export_omits_bulky_uploaded_file_bodies(client):
    """File uploads inline the whole document; exports show only the header."""
    session_id = client.post("/sessions/new", json={}).json()["id"]
    client.put(
        f"/sessions/{session_id}",
        json={
            "messages": [
                {
                    "id": "m1",
                    "role": "user",
                    "content": "[File uploaded: notes.txt (5 characters)]\n\nContents:\nSECRETBODY",
                }
            ]
        },
    )

    response = client.get(f"/export/{session_id}/txt")

    assert "[File uploaded: notes.txt" in response.text
    assert "SECRETBODY" not in response.text


# --- validation ------------------------------------------------------------

def test_chat_rejects_a_malformed_body(client):
    assert client.post("/chat", json={"model": "x"}).status_code == 422


def test_image_generation_rejects_out_of_range_dimensions(client):
    response = client.post(
        "/image-generation/generate",
        json={"model_id": "any", "prompt": "a cat", "width": 999, "height": 1024},
    )

    assert response.status_code == 422


def test_image_generation_rejects_an_empty_prompt(client):
    response = client.post(
        "/image-generation/generate", json={"model_id": "any", "prompt": ""}
    )

    assert response.status_code == 422


@pytest.mark.parametrize("numeric", [{"steps": 201}, {"steps": 200.5}, {"guidance_scale": 30.1}])
def test_image_generation_rejects_values_beyond_expanded_limits(client, monkeypatch, numeric):
    from routes import image_generation as routes

    monkeypatch.setattr(routes.manager, "generate", lambda **kwargs: pytest.fail("Invalid settings reached inference"))
    response = client.post("/image-generation/generate", json={"model_id": "base", "prompt": "A forest", **numeric})
    assert response.status_code == 422


def test_base_image_catalog_survives_optional_lora_discovery_failure(client, monkeypatch):
    from routes import image_generation as routes
    from services import lora_store

    monkeypatch.setattr(routes, "discover_models", lambda: [{"id": "base", "name": "Base model"}])
    monkeypatch.setattr(routes.manager, "runtime_status", lambda: {"ready": True})

    def unavailable():
        raise OSError("Adapter directory temporarily unreadable")

    monkeypatch.setattr(lora_store, "list_adapters", unavailable)
    response = client.get("/image-generation/models")
    assert response.status_code == 200
    assert response.json()["models"][0]["id"] == "base"
    assert response.json()["runtime"]["ready"] is True
    assert response.json()["loras"] == []
    assert "base model only" in response.json()["lora_error"]


@pytest.mark.parametrize("adapter_fields,numeric", [({}, {}),
    ({"lora_id": None}, {"steps": 61, "guidance_scale": 20.1}),
    ({"lora_id": ""}, {"steps": 200, "guidance_scale": 30})])
def test_image_generation_http_accepts_base_model_without_lora(client, monkeypatch, tmp_path, adapter_fields, numeric):
    from routes import image_generation as routes
    from services.request_queue import RequestQueue

    async def prepared(_kind):
        pass

    def generate(**request):
        assert not request["lora_id"]
        assert request["model_id"] == "base"
        assert request["steps"] == numeric.get("steps", 24)
        assert request["guidance_scale"] == numeric.get("guidance_scale", 5.5)
        Image.new("RGB", (8, 8)).save(tmp_path / "base.png")
        return {"filename": "base.png", "model_id": "base"}

    monkeypatch.setattr(routes, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(routes, "queue", RequestQueue())
    monkeypatch.setattr(routes, "prepare_runtime", prepared)
    monkeypatch.setattr(routes.manager, "generate", generate)
    response = client.post("/image-generation/generate", json={"model_id": "base", "prompt": "A forest", **adapter_fields, **numeric})
    assert response.status_code == 200
    assert response.json()["filename"] == "base.png"
    assert response.json()["image_ref"].startswith("blob:")


def test_image_generation_model_list_reports_runtime_status(client):
    """Must describe the runtime rather than crash when CUDA/torch are absent."""
    payload = client.get("/image-generation/models").json()

    assert "models" in payload
    assert "ready" in payload["runtime"]


def test_image_prompt_token_endpoint_reports_model_tokenizer_status(client, monkeypatch):
    from routes import image_generation as image_routes

    expected = {
        "prompt": {"token_count": 76, "native_content_limit": 75, "chunks_required": 2},
        "negative_prompt": {"token_count": 0, "native_content_limit": 75, "chunks_required": 1},
        "long_prompt_max_chunks": 4,
        "long_prompt_max_tokens": 300,
    }
    monkeypatch.setattr(image_routes, "prompt_token_status", lambda *_args: expected)

    response = client.post("/image-generation/prompt-tokens", json={"model_id": "local", "prompt": "test"})

    assert response.status_code == 200
    assert response.json() == expected


def test_image_stop_route_signals_the_matching_request(client, monkeypatch):
    from routes import image_generation as image_routes

    monkeypatch.setattr(image_routes.manager, "cancel", lambda request_id: request_id == "image-123")

    assert client.post("/image-generation/stop/image-123").json() == {"stopped": True}
    assert client.post("/image-generation/stop/unknown").json() == {"stopped": False}


def test_cancelled_image_generation_is_reported_as_stopped(client, monkeypatch):
    from routes import image_generation as image_routes
    from services.image_generation import ImageGenerationCancelled

    def cancelled(**_kwargs):
        raise ImageGenerationCancelled("Image generation stopped")

    monkeypatch.setattr(image_routes.manager, "generate", cancelled)

    response = client.post(
        "/image-generation/generate",
        json={"request_id": "image-123", "model_id": "local", "prompt": "test"},
    )

    assert response.status_code == 499
    assert response.json()["detail"] == "Image generation stopped"


def test_runtime_reset_unloads_resident_ollama_and_image_models(client, monkeypatch):
    import main
    from services.gpu_coordination import gpu_coordinator
    from services.image_generation import manager as image_manager

    unloaded = []

    class FakeResponse:
        def __init__(self, payload=None):
            self._payload = payload or {}

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeAsyncClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url):
            assert url.endswith("/api/ps")
            return FakeResponse({"models": [{"name": "mistral:latest"}]})

        async def post(self, url, json):
            assert url.endswith("/api/generate")
            assert json["keep_alive"] == 0
            unloaded.append(json["model"])
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(gpu_coordinator, "current_owner", lambda: None)
    monkeypatch.setattr(image_manager, "cancel_all", lambda: 0)
    monkeypatch.setattr(image_manager, "reset_runtime", lambda _timeout: True)
    main.active_generation_tasks.clear()

    response = client.post("/runtime/reset")

    assert response.status_code == 200
    assert response.json()["reset"] is True
    assert response.json()["image_pipeline_unloaded"] is True
    assert response.json()["ollama_models_unloaded"] == ["mistral:latest"]
    assert unloaded == ["mistral:latest"]


def test_lora_project_routes_are_available(client, lora_paths):
    created = client.post("/lora/projects", json={"name": "Route test"})

    assert created.status_code == 200
    project_id = created.json()["id"]
    assert created.json()["training_goal"] == "character_identity"
    assert client.get("/lora/projects").json()["projects"][0]["id"] == project_id
    assert client.get(f"/lora/projects/{project_id}").status_code == 200
    assert client.get("/lora/hardware").status_code == 200

    rejected = client.post(
        f"/lora/projects/{project_id}/images",
        files={"files": ("one.png", b"not-read-without-a-model", "image/png")},
    )
    assert rejected.status_code == 400
    assert "SDXL image model" in rejected.json()["detail"]


def test_lora_vision_analysis_routes_persist_reviewable_suggestions(client, lora_paths, monkeypatch):
    from routes import lora as lora_routes
    from services import lora_store

    project = lora_store.create_project(
        "Vision route",
        trigger_word="visionchar",
        base_model_id="local-sdxl",
        training_goal="character_identity",
        vision_model="qwen3-vl:8b",
    )
    buffer = io.BytesIO()
    Image.new("RGB", (128, 128), "blue").save(buffer, format="PNG")
    added = lora_store.add_images(project["id"], [("one.png", buffer.getvalue())])
    image_id = added["added"][0]["id"]

    async def fake_models():
        return [{"name": "qwen3-vl:8b", "capabilities": ["completion", "vision"]}]

    async def fake_analysis(project_value, model):
        assert project_value["id"] == project["id"]
        assert model == "qwen3-vl:8b"
        return {
            "model": model,
            "summary": "Consistent character",
            "stable_traits": ["dark hair"],
            "warnings": [],
            "images": [{
                "image_id": image_id,
                "caption_suggestion": "visionchar, standing",
                "analysis": {"pose_action": "standing"},
            }],
        }

    monkeypatch.setattr(lora_routes.lora_vision, "list_vision_models", fake_models)
    monkeypatch.setattr(lora_routes.lora_vision, "analyze_project", fake_analysis)

    assert client.get("/lora/vision-models").json()["models"][0]["name"] == "qwen3-vl:8b"
    response = client.post(
        f"/lora/projects/{project['id']}/analyze",
        json={"model": "qwen3-vl:8b", "request_id": "analysis-route-test"},
    )
    assert response.status_code == 200
    assert response.json()["images"][0]["caption"] == "visionchar"
    assert response.json()["images"][0]["caption_suggestion"] == "visionchar, standing"

    applied = client.post(f"/lora/projects/{project['id']}/analysis/apply-captions")
    assert applied.json()["images"][0]["caption"] == "visionchar, standing"
    assert client.post("/lora/analysis/stop/not-active").json() == {"stopped": False}


def test_stopping_an_unknown_generation_is_harmless(client):
    assert client.post("/chat/stop/never-started").json() == {"stopped": False}


def test_trashed_session_can_be_permanently_deleted(client, monkeypatch):
    from services import memory_store

    monkeypatch.setattr(memory_store, "delete_chat_session_data", lambda _session_id: None)
    session_id = client.post("/sessions/new", json={}).json()["id"]
    assert client.delete(f"/sessions/{session_id}").status_code == 200
    item = client.get("/sessions/trash").json()["sessions"][0]

    response = client.delete(f"/sessions/trash/{item['file']}")

    assert response.status_code == 200
    assert client.get("/sessions/trash").json() == {"sessions": []}


# --- degraded upstream -----------------------------------------------------

def test_models_route_reports_ollama_being_unreachable(client, monkeypatch):
    """
    The error text this returns is what the UI should surface when Ollama is
    not running. Today the frontend discards it (see api.js loadModels).
    """
    import main

    monkeypatch.setattr(main, "OLLAMA_BASE_URL", "http://127.0.0.1:1")

    payload = client.get("/models").json()

    assert payload["models"] == []
    assert "error" in payload


def test_knowledge_base_query_rejects_a_missing_query(client):
    assert client.get("/files/knowledge-base/query").status_code == 422


def test_file_parse_rejects_an_unsupported_extension(client):
    response = client.post(
        "/files/parse", files={"file": ("virus.exe", b"MZ\x00\x00", "application/octet-stream")}
    )

    assert response.status_code == 400
