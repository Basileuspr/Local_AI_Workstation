"""Discovery contracts must stay useful without executing any listed tool."""
import re

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator

from conftest import API_BASE_URL, AUTH_HEADERS
from services.tool_catalog import TOOLS
from services.tool_registry import _input_schema, build_registry


@pytest.fixture
def client():
    # Run with LAW_DATA_DIR pointing to a scratch directory before importing main.
    # No lifespan startup: discovery must not start workers or initialize models.
    import main
    return TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS)


def test_catalog_is_wired_to_real_routes_and_schemas(client):
    response = client.get("/tools/registry")
    assert response.status_code == 200
    registry = response.json()
    assert registry["schema_version"] == "1.0"
    assert registry["execution_enabled"] is True
    ids = [tool["id"] for tool in registry["tools"]]
    assert len(ids) == len(set(ids)) == len(TOOLS)
    assert all(re.fullmatch(r"[a-z][a-z0-9_.]{0,79}", value) for value in ids)
    for tool in registry["tools"]:
        assert tool["name"] and tool["description"] and tool["output_description"]
        assert tool["llm_callable"] == tool["execution"]["callable"]
        if tool["interface"] == "http":
            assert tool["availability"] == "registered", tool["id"]
            Draft202012Validator.check_schema(tool["input_schema"])
        else:
            assert tool["availability"] == "ui_only"
            assert tool["input_schema"] is None
            assert tool["endpoint"] is None


def test_query_path_and_multipart_arguments_retain_required_fields(client):
    def schema(tool_id):
        return client.get(f"/tools/registry/{tool_id}").json()["tool"]["input_schema"]

    search = Draft202012Validator(schema("knowledge_search"))
    assert search.is_valid({"query": {"q": "project notes", "n": 3}})
    assert not search.is_valid({})
    assert not search.is_valid({"query": {"n": 3}})
    assert not search.is_valid({"query": {"q": "notes", "invented": True}})
    chat = Draft202012Validator(schema("chat_read"))
    assert chat.is_valid({"path": {"session_id": "example"}})
    assert not chat.is_valid({"body": {"session_id": "example"}})
    tool = client.get("/tools/registry/image_convert").json()["tool"]
    assert tool["endpoint"]["content_type"] == "multipart/form-data"
    convert = Draft202012Validator(tool["input_schema"])
    assert convert.is_valid({"body": {"file": "file-adapter-placeholder", "target": "png", "quality": 92}})
    assert not convert.is_valid({"body": {"target": "png"}})
    assert not convert.is_valid({"body": {"file": "file", "target": "png", "quality": 101}})


def test_nested_image_schema_is_self_contained_and_keeps_limits(client):
    schema = client.get("/tools/registry/image_submit").json()["tool"]["input_schema"]
    validator = Draft202012Validator(schema)
    payload = {"body": {"client_id": "example", "requests": [{
        "session_id": "session", "request_id": "request", "model_id": "model", "prompt": "mountains", "seed": 0}]}}
    assert validator.is_valid(payload)
    payload["body"]["requests"][0]["seed"] = -1
    assert not validator.is_valid(payload)
    assert "#/components/" not in str(schema)


def test_recursive_schema_and_optional_body_do_not_lose_references():
    schema, media = _input_schema({"requestBody": {"content": {"application/json": {
        "schema": {"$ref": "#/components/schemas/Node"}}}}}, {"Node": {
            "type": "object", "properties": {"child": {"$ref": "#/components/schemas/Node"}}}})
    validator = Draft202012Validator(schema)
    assert media == "application/json"
    assert validator.is_valid({})
    assert validator.is_valid({"body": {"child": {"child": {}}}})


def test_filters_single_tool_and_markdown_agree(client):
    all_tools = client.get("/tools/registry").json()["tools"]
    filtered = client.get("/tools/registry", params={"q": " TRANSCRIBE ", "category": "audio"}).json()["tools"]
    assert [tool["id"] for tool in filtered] == ["audio_transcribe"]
    assert client.get("/tools/registry", params={"q": "nonexistent tool 123"}).json()["tools"] == []
    assert client.get("/tools/registry/missing").status_code == 404
    markdown = client.get("/tools/registry.md")
    assert markdown.status_code == 200
    assert markdown.headers["content-type"].startswith("text/plain")
    assert all(f"## {tool['id']} — {tool['name']}" in markdown.text for tool in all_tools)
    assert "query.q (required)" in markdown.text
    assert "path.session_id (required)" in markdown.text
    assert "POST /workspaces/convert" in markdown.text


def test_discovery_requires_session_auth_and_never_embeds_secrets(client):
    for path in ("/tools/registry", "/tools/registry.md", "/tools/registry/image_submit"):
        assert client.get(path, headers={"X-LAW-Session": "wrong"}).status_code == 403
        response = client.get(path)
        assert response.status_code == 200
        assert "test-session-token" not in response.text
        assert response.headers["cache-control"] == "no-store"
    assert client.post("/tools/registry/image_submit", json={}).status_code == 405


def test_discovery_does_not_call_tools_or_probe_models(client, monkeypatch):
    from services import system_stats, audio, image_generation

    def forbidden(*args, **kwargs):
        raise AssertionError("Discovery must not run a tool or probe the machine")

    monkeypatch.setattr(system_stats.sampler, "snapshot", forbidden)
    monkeypatch.setattr(audio, "status", forbidden)
    monkeypatch.setattr(image_generation, "discover_models", forbidden)
    assert client.get("/tools/registry").status_code == 200
    assert client.get("/tools/registry.md").status_code == 200


def test_missing_routes_fail_closed_and_each_response_is_independent():
    registry = build_registry({"paths": {}})
    assert all(tool["availability"] == "unavailable" for tool in registry["tools"] if tool["interface"] == "http")
    registry["tools"][0]["effects"].append("unexpected")
    assert "unexpected" not in str(build_registry({"paths": {}}))
