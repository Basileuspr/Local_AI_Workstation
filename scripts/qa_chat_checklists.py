"""Serve the real session routes and an isolated chat UI, using temporary data."""
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time

root = Path(tempfile.mkdtemp(prefix="law-checklist-data-"))
os.environ.update(LAW_DATA_DIR=str(root / "data"), LAW_LOG_DIR=str(root / "logs"), LAW_MODELS_DIR=str(root / "models"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import asyncio
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from routes.sessions import router
from routes.artifacts import router as artifacts_router
from services.chat_documents import create_document, DocumentSpec
from services import session_store as store

session = store.create_session("Checklist QA")
content = "## Today\n\n- [ ] Buy **milk**\n  - [X] Check fridge\n- [ ] Send email\n- Ordinary bullet\n\n~~~markdown\n- [ ] Code example\n~~~"
store.append_messages(session["id"], [{"id": "list", "role": "assistant", "content": content}])
other = store.create_session("Other chat")
store.append_messages(other["id"], [{"id": "other", "role": "user", "content": "- [ ] Different checklist"}])
app = FastAPI()
app.include_router(router)
app.include_router(artifacts_router)
control = {"fail": False}

@app.get("/image-generation/models")
def image_models():
    return {"models": [], "loras": [], "runtime": {"ready": False}}

@app.get("/image-generation/tasks")
def image_tasks():
    return {"tasks": []}

@app.post("/qa/document")
def new_document():
    artifact = create_document(DocumentSpec(title="Checklist notes", filename="notes.docx",
        blocks=[{"type": "paragraph", "text": "This document stays beside the conversation."}]), session["id"], {}, threading.Event())
    return store.append_messages(session["id"], [{"id": "doc-reply", "role": "assistant", "content": "Your notes are ready.", "artifacts": [artifact]}])

@app.post("/qa/fail")
def fail_next_save():
    control["fail"] = True
    return {"ok": True}

@app.middleware("http")
async def delayed_save(request, call_next):
    if request.method in {"PATCH", "PUT"} and request.url.path.endswith("/checklist"):
        await asyncio.sleep(.25)
        if control["fail"]:
            control["fail"] = False
            return JSONResponse({"detail": "Simulated save failure. Try again."}, status_code=500)
    return await call_next(request)

app.mount("/", StaticFiles(directory=sys.argv[1], html=True), name="fixture")
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
thread.start()
while not server.started:
    time.sleep(.02)
print(json.dumps({"url": f"http://127.0.0.1:{sock.getsockname()[1]}", "chat": session["id"], "other": other["id"]}), flush=True)
sys.stdin.readline()
server.should_exit = True
thread.join(timeout=10)
