"""The browser-to-localhost trust boundary.

These assert the property that matters: a page the user merely visits cannot
reach privileged local APIs, even though those APIs listen on loopback.
"""
import pytest
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from config import settings
from services import session_guard

TOKEN = "test-session-token"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("LAW_SESSION_TOKEN", TOKEN)
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/sessions/list")
    def sessions():
        return {"sessions": ["private chat"]}

    @app.post("/runtime/reset")
    def reset():
        return {"reset": True}

    @app.get("/system/stats")
    def stats():
        return {"cpu": {"name": "secret CPU"}}

    app.add_middleware(session_guard.SessionGuard)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
    return TestClient(app, base_url="http://127.0.0.1:8000")


# --- the boundary --------------------------------------------------------

@pytest.mark.parametrize("path", ["/sessions/list", "/system/stats"])
def test_a_web_page_cannot_read_private_data_without_the_credential(client, path):
    response = client.get(path)
    assert response.status_code == 403
    assert "private chat" not in response.text and "secret CPU" not in response.text


def test_a_web_page_cannot_trigger_side_effects_without_the_credential(client):
    assert client.post("/runtime/reset").status_code == 403


def test_the_null_origin_is_no_longer_an_application_origin():
    # A sandboxed iframe on any site carries Origin: null. It used to be
    # allowlisted because the renderer loaded from file://.
    assert "null" not in settings.allowed_origins
    assert "app://local" in settings.allowed_origins


def test_a_sandboxed_iframe_origin_is_refused_outright(client):
    response = client.get("/sessions/list", headers={"Origin": "null", "X-LAW-Session": TOKEN})
    assert response.status_code == 403
    assert "does not serve web pages" in response.json()["detail"]


def test_an_arbitrary_website_origin_is_refused_outright(client):
    response = client.get("/sessions/list", headers={"Origin": "https://evil.example",
                                                     "X-LAW-Session": TOKEN})
    assert response.status_code == 403


@pytest.mark.parametrize("host", ["evil.example", "attacker.test:8000", "192.168.1.5:8000"])
def test_a_rebound_hostname_is_refused_before_anything_runs(client, host):
    response = client.get("/health", headers={"Host": host})
    assert response.status_code == 403
    assert "loopback" in response.json()["detail"]


# --- the application still works ----------------------------------------

def test_health_stays_open_so_the_desktop_can_wait_for_startup(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_protected_responses_are_never_cached_or_used_as_referrers(client):
    response = client.get("/sessions/list", headers={"X-LAW-Session":TOKEN})
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_the_application_origin_with_the_credential_is_served(client):
    response = client.get("/sessions/list", headers={"Origin": "app://local",
                                                     "X-LAW-Session": TOKEN})
    assert response.status_code == 200
    assert response.json()["sessions"] == ["private chat"]


def test_the_credential_is_accepted_as_a_query_value_for_image_and_download_urls(client):
    # <img src> and download links cannot set a request header.
    assert client.get(f"/sessions/list?law_token={TOKEN}").status_code == 200


def test_a_wrong_credential_is_refused(client):
    assert client.get("/sessions/list", headers={"X-LAW-Session": "wrong"}).status_code == 403
    assert client.get("/sessions/list?law_token=wrong").status_code == 403


def test_loopback_hosts_are_accepted(client):
    for host in ("127.0.0.1:8000", "localhost:8000", "127.0.0.1"):
        assert client.get("/health", headers={"Host": host}).status_code == 200


# --- credential handling -------------------------------------------------

def test_an_unconfigured_backend_serves_only_health(monkeypatch):
    """No environment token means a secret nobody was told, not open access."""
    monkeypatch.delenv("LAW_SESSION_TOKEN", raising=False)
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/sessions/list")
    def sessions():
        return {"sessions": []}

    app.add_middleware(session_guard.SessionGuard)
    with TestClient(app, base_url="http://127.0.0.1:8000") as unconfigured:
        assert unconfigured.get("/health").status_code == 200
        assert unconfigured.get("/sessions/list").status_code == 403
    assert session_guard.configured() is False


def test_the_fallback_credential_is_high_entropy_and_not_hard_coded():
    first = session_guard._generated_token()
    second = session_guard._generated_token()
    assert first != second
    assert len(first) >= 32


def test_the_credential_never_reaches_the_log(tmp_path, monkeypatch):
    import logging

    from services.app_logging import RedactSessionToken

    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1,
                               'GET /faces/x/crop?law_token=%s HTTP/1.1 200', ("s3cr3t-value",), None)
    RedactSessionToken().filter(record)
    rendered = record.getMessage()
    assert "s3cr3t-value" not in rendered
    assert "law_token=REDACTED" in rendered


def test_redaction_survives_propagation_from_uvicorn_access(tmp_path, monkeypatch):
    """The access log is the one that actually carries the query string.

    A filter on the root *logger* never sees it: logger filters apply only to
    records logged directly to that logger, not to records propagated up from a
    child. The filter therefore has to live on the handlers.
    """
    import logging

    from services import app_logging

    monkeypatch.setenv(app_logging.LOG_DIR_ENV, str(tmp_path))
    app_logging.setup_logging(force=True)
    logging.getLogger("uvicorn.access").info(
        '%s - "%s %s HTTP/1.1" %d', "127.0.0.1:5", "GET",
        "/sessions/list?law_token=super-secret-value", 200)
    for handler in logging.getLogger().handlers:
        handler.flush()
    written = (tmp_path / app_logging.LOG_FILENAME).read_text(encoding="utf-8")
    assert "super-secret-value" not in written
    assert "law_token=REDACTED" in written


def test_redaction_also_covers_a_token_inside_the_message_itself():
    import logging

    from services.app_logging import RedactSessionToken

    record = logging.LogRecord("x", logging.INFO, __file__, 1,
                               "GET /sessions/list?law_token=abc123&x=1", None, None)
    RedactSessionToken().filter(record)
    assert "abc123" not in record.getMessage()
    assert "x=1" in record.getMessage()
