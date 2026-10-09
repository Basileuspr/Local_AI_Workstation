"""Ollama compatibility entries should not duplicate user-selectable models."""
import asyncio

import httpx


def test_model_catalog_filters_internal_hashes_and_duplicates(monkeypatch):
    import main

    names = ["chat:latest", "chat:latest", "llamacpp:" + "a" * 64,
             "LLAMACPP:" + "B" * 64, "", "embed:latest", "llamacpp:custom"]
    shown = []

    def handle(request):
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": name} for name in names]})
        import json
        name = json.loads(request.content)["model"]
        shown.append(name)
        capabilities = ["embedding"] if name == "embed:latest" else ["completion"]
        return httpx.Response(200, json={"capabilities": capabilities})

    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(handle)
    monkeypatch.setattr(main.httpx, "AsyncClient",
                        lambda **kwargs: original_client(transport=transport, **kwargs))
    result = asyncio.run(main.list_models())
    assert [model["name"] for model in result["models"]] == ["chat:latest", "llamacpp:custom"]
    assert [model["name"] for model in result["embedding_models"]] == ["embed:latest"]
    assert result["unavailable_models"] == []
    assert shown == ["chat:latest", "embed:latest", "llamacpp:custom"]
