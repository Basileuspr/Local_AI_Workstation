"""
Tests for the dependency status probe.

/health only proves the process is alive. /status answers the question a user
actually has when the app looks broken: which dependency is missing, and what
should I do about it.
"""

import pytest

from conftest import API_BASE_URL, AUTH_HEADERS
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    import main
    from services import prompt_index_store, session_store

    sessions = tmp_path / "sessions"
    sessions.mkdir()
    monkeypatch.setattr(session_store, "SESSIONS_DIR", sessions)
    monkeypatch.setattr(prompt_index_store, "PROMPT_INDEX_PATH", tmp_path / "prompt_index.json")
    monkeypatch.setattr(
        prompt_index_store, "PROMPT_INDEX_DRAFT_PATH", tmp_path / "prompt_index_draft.json"
    )
    monkeypatch.setattr(main, "THINKING_LOG_PATH", tmp_path / "thinking.log")

    with TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS) as test_client:
        yield test_client


@pytest.fixture
def fake_ollama(monkeypatch):
    """Replace the Ollama probe so tests do not depend on a running service."""
    import httpx

    import main

    def install(model_names=None, failure=None):
        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return {"models": [{"name": name} for name in (model_names or [])]}

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def get(self, url):
                if failure is not None:
                    raise failure
                return FakeResponse()

        monkeypatch.setattr(main.httpx, "AsyncClient", lambda **kwargs: FakeClient())

    return install


def test_health_still_reports_only_liveness(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_status_reports_everything_available(client, fake_ollama):
    fake_ollama(["mistral:latest", "qwen3.5:9b", "nomic-embed-text:latest"])

    payload = client.get("/status").json()

    assert payload["backend"]["ok"] is True
    assert payload["ollama"]["reachable"] is True
    assert payload["models"]["chat_count"] == 2
    assert payload["models"]["embedding_ready"] is True


def test_embedding_model_matches_despite_a_tag_suffix(client, fake_ollama):
    """Ollama reports `nomic-embed-text:latest`; config says `nomic-embed-text`."""
    fake_ollama(["nomic-embed-text:latest", "mistral:latest"])

    payload = client.get("/status").json()

    assert payload["models"]["embedding_ready"] is True


def test_status_reports_ollama_not_running_with_actionable_detail(client, fake_ollama):
    import httpx

    fake_ollama(failure=httpx.ConnectError("refused"))

    payload = client.get("/status").json()

    assert payload["ollama"]["reachable"] is False
    assert payload["ollama"]["error"] == "not_running"
    assert "Start Ollama" in payload["ollama"]["detail"]
    assert payload["ollama"]["url"] in payload["ollama"]["detail"]


def test_status_distinguishes_a_timeout(client, fake_ollama):
    import httpx

    fake_ollama(failure=httpx.ReadTimeout("slow"))

    payload = client.get("/status").json()

    assert payload["ollama"]["error"] == "timeout"


def test_status_reports_no_models_when_ollama_is_empty(client, fake_ollama):
    fake_ollama([])

    payload = client.get("/status").json()

    assert payload["ollama"]["reachable"] is True
    assert payload["models"]["chat_count"] == 0
    assert payload["models"]["embedding_ready"] is False


def test_status_reports_a_missing_embedding_model(client, fake_ollama):
    fake_ollama(["mistral:latest"])

    payload = client.get("/status").json()

    assert payload["models"]["chat_count"] == 1
    assert payload["models"]["embedding_ready"] is False


def test_status_names_the_configured_embedding_model(client, fake_ollama):
    fake_ollama(["mistral:latest"])

    payload = client.get("/status").json()

    assert payload["models"]["embedding_model"]


def test_status_survives_an_unreadable_knowledge_base(client, fake_ollama, monkeypatch):
    """A broken index must be reported, not crash the probe."""
    import services.knowledge_base as kb

    fake_ollama(["mistral:latest", "nomic-embed-text:latest"])
    monkeypatch.setattr(
        kb, "count_documents", lambda: (_ for _ in ()).throw(RuntimeError("database is locked"))
    )

    payload = client.get("/status").json()

    assert payload["knowledge_base"]["ok"] is False
    assert "database is locked" in payload["knowledge_base"]["error"]
    # The rest of the report still arrives.
    assert payload["ollama"]["reachable"] is True


def test_status_never_returns_an_error_status_code(client, fake_ollama):
    """The probe reports problems in its body; it must not fail as a request."""
    import httpx

    fake_ollama(failure=httpx.ConnectError("refused"))

    assert client.get("/status").status_code == 200
