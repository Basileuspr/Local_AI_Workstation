"""
Tests that slow work stays off the event loop.

The symptom this guards against: uploading a document to the knowledge base
froze the whole backend for the duration, because the embedding loop ran
directly on the event loop. Health checks failed mid-upload and the app looked
like it had crashed.

Two complementary checks are used. The structural ones assert that handlers
doing blocking work are declared `def`, which is what makes FastAPI run them
in a threadpool. The behavioural one proves the server actually answers other
requests while a slow route is still running.
"""

import asyncio
import inspect
import threading
import time

import pytest


@pytest.fixture
def app_module(tmp_path, monkeypatch):
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
    return main


def iter_routes(app):
    """
    Walk every registered route.

    Included routers are not flattened into `app.routes` in this FastAPI
    version; they appear as wrapper objects exposing the original router, so
    their routes have to be collected explicitly.
    """
    pending = list(app.routes)
    seen = set()
    while pending:
        route = pending.pop()
        if id(route) in seen:
            continue
        seen.add(id(route))

        nested = getattr(route, "original_router", None) or getattr(route, "router", None)
        if nested is not None and getattr(nested, "routes", None):
            pending.extend(nested.routes)
            continue

        if getattr(route, "path", None) and hasattr(route, "endpoint"):
            yield route


def handler_for(app, path, method="GET"):
    for route in iter_routes(app):
        if route.path == path and method in getattr(route, "methods", set()):
            return route.endpoint
    raise AssertionError(f"no {method} route for {path}")


# --- structural: blocking handlers must not be coroutines ------------------

BLOCKING_ROUTES = [
    ("/sessions/list", "GET"),
    ("/sessions/images", "GET"),
    ("/sessions/{session_id}", "GET"),
    ("/sessions/{session_id}", "PUT"),
    ("/sessions/{session_id}", "DELETE"),
    ("/sessions/new", "POST"),
    ("/export/{session_id}/txt", "GET"),
    ("/export/{session_id}/json", "GET"),
    ("/prompt-index", "GET"),
    ("/prompt-index", "POST"),
    ("/prompt-index/state", "GET"),
    ("/memory", "GET"),
    ("/memory", "POST"),
    ("/image-generation/models", "GET"),
    # Image generation now awaits queue admission asynchronously and explicitly
    # offloads its worker. test_request_queue exercises cancellation while that
    # worker is blocked and verifies it runs on a different thread.
    ("/files/knowledge-base/query", "GET"),
    ("/files/knowledge-base/list", "GET"),
]


@pytest.mark.parametrize("path, method", BLOCKING_ROUTES)
def test_blocking_routes_run_in_a_threadpool(app_module, path, method):
    """
    A `def` handler is dispatched to a worker thread by FastAPI; an `async def`
    one that never awaits would hold the event loop for its whole duration.
    """
    handler = handler_for(app_module.app, path, method)

    assert not inspect.iscoroutinefunction(handler), (
        f"{method} {path} is declared async but performs blocking work, "
        "which would stall every other request"
    )


@pytest.mark.parametrize(
    "path, method",
    [
        ("/chat", "POST"),
        ("/models", "GET"),
        ("/memory/compact", "POST"),
        ("/health", "GET"),
        ("/runtime/status", "GET"),
        ("/runtime/reset", "POST"),
    ],
)
def test_genuinely_async_routes_stay_async(app_module, path, method):
    """These await real I/O and must remain on the event loop."""
    assert inspect.iscoroutinefunction(handler_for(app_module.app, path, method))


def test_stop_route_stays_async(app_module):
    """
    Cancellation touches asyncio task state, which is not thread-safe. This
    one must stay on the loop even though it does no awaiting.
    """
    assert inspect.iscoroutinefunction(handler_for(app_module.app, "/chat/stop/{request_id}", "POST"))


# --- behavioural: the server answers while slow work is in flight ----------

def test_health_answers_while_a_slow_upload_is_running(app_module, monkeypatch):
    """
    The original failure, reproduced: a slow knowledge-base ingest must not
    stop /health from responding.
    """
    import httpx

    from routes import files as files_route

    started = threading.Event()

    def slow_add_document(text, filename):
        started.set()
        time.sleep(1.0)
        return {"filename": filename, "doc_id": "abc123", "chunks": 1, "error": None}

    monkeypatch.setattr(files_route, "add_document", slow_add_document)
    monkeypatch.setattr(
        files_route,
        "parse_file",
        lambda contents, filename: {
            "text": "some text",
            "filename": filename,
            "format": ".txt",
            "char_count": 9,
            "error": None,
        },
    )

    async def scenario():
        transport = httpx.ASGITransport(app=app_module.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000",
                                     headers={"X-LAW-Session": "test-session-token"}) as client:
            upload = asyncio.create_task(
                client.post(
                    "/files/knowledge-base/add",
                    files={"file": ("notes.txt", b"some text", "text/plain")},
                )
            )

            # Wait until the blocking call is genuinely underway.
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.01)
            assert started.is_set(), "the slow ingest never started"

            began = time.monotonic()
            health = await asyncio.wait_for(client.get("/health"), timeout=2.0)
            elapsed = time.monotonic() - began

            upload_response = await upload
            return health, elapsed, upload_response

    health, elapsed, upload_response = asyncio.run(scenario())

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    # Comfortably shorter than the one-second ingest it overlapped with.
    assert elapsed < 0.5, f"/health waited {elapsed:.2f}s behind the upload"
    assert upload_response.status_code == 200



# --- thinking log: syscalls trimmed from the streaming hot path ------------

def test_thinking_log_is_only_prepared_once(app_module, monkeypatch):
    """
    _append_thinking runs per streamed chunk. Re-creating the directory on
    every token added syscalls to the hot path for no benefit.
    """
    calls = {"mkdir": 0}
    real_mkdir = type(app_module.THINKING_LOG_PATH).mkdir

    def counting_mkdir(self, *args, **kwargs):
        calls["mkdir"] += 1
        return real_mkdir(self, *args, **kwargs)

    app_module._reset_thinking_log()
    monkeypatch.setattr(type(app_module.THINKING_LOG_PATH), "mkdir", counting_mkdir)

    for index in range(50):
        app_module._append_thinking(f"token {index} ")

    assert calls["mkdir"] == 0, "directory was re-created during streaming"


def test_thinking_log_still_records_every_chunk_immediately(app_module):
    """Reducing syscalls must not cost the live tail its content."""
    app_module._reset_thinking_log()

    app_module._append_thinking("first ")
    partial = app_module.THINKING_LOG_PATH.read_text(encoding="utf-8")
    app_module._append_thinking("second")

    assert partial == "first "
    assert app_module.THINKING_LOG_PATH.read_text(encoding="utf-8") == "first second"


def test_thinking_log_recovers_if_the_file_is_deleted_underneath(app_module):
    """The export endpoint and external tools can remove the file mid-run."""
    app_module._reset_thinking_log()
    app_module._append_thinking("before ")
    app_module.THINKING_LOG_PATH.unlink()

    app_module._append_thinking("after")

    assert app_module.THINKING_LOG_PATH.read_text(encoding="utf-8") == "after"
