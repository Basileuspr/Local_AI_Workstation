"""Run with a core-only venv. Uses temporary app data; no models or desktop launch."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile

root = Path(tempfile.mkdtemp(prefix="law-core-smoke-"))
os.environ.update(LAW_DATA_DIR=str(root / "data"), LAW_LOG_DIR=str(root / "logs"),
                  LAW_MODELS_DIR=str(root / "models"), LAW_SESSION_TOKEN="core-smoke-token",
                  LAW_OLLAMA_URL="http://127.0.0.1:9")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi.testclient import TestClient
import main

missing = [name for name in ("torch", "chromadb", "onnxruntime", "langchain_text_splitters")
           if importlib.util.find_spec(name) is None]
assert len(missing) == 4, "Run this check in the core-only venv before optional installs."
results = {}
with TestClient(main.app, base_url="http://127.0.0.1:8000", headers={"X-LAW-Session": "core-smoke-token"}) as client:
    for route in ("/health", "/sessions/list", "/sessions/images", "/image-generation/models",
                  "/lora/hardware", "/lora/projects", "/faces/providers", "/faces/datasets", "/status", "/bridge", "/bridge/jobs"):
        response = client.get(route)
        assert response.status_code == 200, (route, response.status_code, response.text)
        results[route] = response.status_code
    status = client.get("/status").json()
    assert status["backend"]["ok"] and not status["knowledge_base"]["ok"]
    assert not status["runtime"]["image"]["ready"]
    assert status["capabilities"]["features"]["local_data"]["available"]
    assert not status["capabilities"]["features"]["training"]["available"]
    assert not status["capabilities"]["features"]["face_detection"]["available"]
    created = client.post("/sessions/new", json={})
    assert created.status_code == 200, created.text
    document = client.post("/files/parse", files={"file": ("note.txt", b"Laptop core works", "text/plain")})
    assert document.status_code == 200, document.text
    unavailable = client.get("/files/knowledge-base/list")
    assert unavailable.status_code == 503, unavailable.text
    assert "requirements-knowledge.txt" in unavailable.text
print(json.dumps({"results": results, "session_create": created.status_code,
                  "text_parse": document.status_code, "knowledge_unavailable": unavailable.status_code,
                  "absent_packages": missing, "isolated_data": str(root)}, indent=2))
