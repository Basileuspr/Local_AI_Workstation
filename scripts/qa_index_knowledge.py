"""Real Index/Knowledge routes in disposable data; no model calls or user files."""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time

root = Path(sys.argv[1])
os.environ.update(LAW_DATA_DIR=str(root / "data"), LAW_LOG_DIR=str(root / "logs"), LAW_MODELS_DIR=str(root / "models"), ANONYMIZED_TELEMETRY="False")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from routes.files import router as knowledge_router
from routes.prompt_index import router as index_router
from services import knowledge_base as kb, prompt_index_store as index, knowledge_notes as notes
import uvicorn

kb._create_embeddings = lambda texts, cancel_event=None: [[1., 0., 0.] for _ in texts]
node = notes.save_node(notes.KnowledgeNodeDraft(title="Project hub", kind="project", text="Existing Knowledge text."))
other_node = notes.save_node(notes.KnowledgeNodeDraft(title="Reading notes", kind="reference", text="Original reading notes."))
entry = index.create_entry("Travel reference", "A reusable itinerary and source notes.", "Research", ["travel"])
other_entry = index.create_entry("Camera notes", "Useful camera settings.")
app = FastAPI()
app.include_router(knowledge_router); app.include_router(index_router)
fail_next = False


@app.middleware("http")
async def simulate_link_failure(request, call_next):
    global fail_next
    if fail_next and request.method == "POST" and request.url.path == "/prompt-index/knowledge-links":
        fail_next = False
        await asyncio.sleep(.1)
        return JSONResponse({"detail": "Simulated connection save failure"}, status_code=503)
    return await call_next(request)


@app.post("/qa/fail-link")
def fail_link():
    global fail_next
    fail_next = True
    return {"ok": True}


app.mount("/", StaticFiles(directory=root, html=True))
sock = socket.socket(); sock.bind(("127.0.0.1", 0))
server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True); thread.start()
while not server.started: time.sleep(.02)
print(json.dumps({"url": f"http://127.0.0.1:{sock.getsockname()[1]}", "entry": entry["id"], "other_entry": other_entry["id"], "node": node["doc_id"], "other_node": other_node["doc_id"]}), flush=True)
sys.stdin.readline()
server.should_exit = True; thread.join(timeout=10)
