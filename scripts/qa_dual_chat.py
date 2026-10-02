"""Temporary session data, production chat/queue routes, synthetic Ollama over HTTP."""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time

root = Path(tempfile.mkdtemp(prefix="law-dual-chat-data-"))
os.environ.update(LAW_DATA_DIR=str(root / "data"), LAW_LOG_DIR=str(root / "logs"), LAW_MODELS_DIR=str(root / "models"),
                  LAW_SESSION_TOKEN="dual-chat-qa", ANONYMIZED_TELEMETRY="False")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.requests import ClientDisconnect

loaded = ["alpha:latest"]
operations = []
requests = []
controls = {"release": set(), "hold_switch": True, "hold_load": True, "active": 0, "maximum": 0}
provider = FastAPI()

@provider.get("/api/ps")
def ps(): return {"models": [{"name": name} for name in loaded]}

@provider.post("/api/show")
def show(): return {"capabilities": ["completion"], "details": {}, "model_info": {}}

@provider.post("/api/generate")
async def generate(request: Request):
    try:
        body = await request.json()
    except ClientDisconnect:
        return {"done": True}
    action = "unload" if body.get("keep_alive") == 0 else "load"
    operations.append({"action": action, "model": body["model"]})
    while controls["hold_switch" if action == "unload" else "hold_load"]:
        if await request.is_disconnected(): return {"error": "Disconnected"}
        await asyncio.sleep(.02)
    if action == "unload":
        if body["model"] in loaded: loaded.remove(body["model"])
    elif body["model"] not in loaded: loaded.append(body["model"])
    return {"done": True}

@provider.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    prompt = next(item["content"] for item in reversed(body["messages"]) if item["role"] == "user")
    requests.append({"prompt": prompt, "model": body["model"], "messages": body["messages"]})
    async def stream():
        controls["active"] += 1
        controls["maximum"] = max(controls["maximum"], controls["active"])
        try:
            while prompt not in controls["release"]:
                if await request.is_disconnected(): return
                await asyncio.sleep(.02)
            yield json.dumps({"message": {"content": f"Reply to {prompt} using {body['model']}"}, "done": False}) + "\n"
            await asyncio.sleep(.15)
            yield json.dumps({"message": {"content": ""}, "done": True}) + "\n"
        finally: controls["active"] -= 1
    return StreamingResponse(stream(), media_type="application/x-ndjson")

def serve(app):
    sock = socket.socket(); sock.bind(("127.0.0.1", 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    while not server.started: time.sleep(.02)
    return server, thread, f"http://127.0.0.1:{sock.getsockname()[1]}"

provider_server, provider_thread, provider_url = serve(provider)
import main
from routes.sessions import router as sessions
from routes.request_queue import router as queue_routes
from services import session_store as store

main.OLLAMA_BASE_URL = provider_url
main._append_thinking = lambda *_: None
async def prepare(_kind): pass
main.prepare_runtime = prepare
first = store.create_session("First conversation")
store.append_messages(first["id"], [{"id": "a-history", "role": "user", "content": "Only A's history"}], "alpha:latest")
second = store.create_session("Second conversation")
store.append_messages(second["id"], [{"id": "b-history", "role": "user", "content": "Only B's history"}], "beta:latest")

app = FastAPI()
app.include_router(sessions); app.include_router(queue_routes)
app.post("/chat")(main.chat)
app.post("/chat/stop/{request_id}")(main.stop_chat)
app.get("/runtime/status")(main.runtime_status)

@app.get("/image-generation/models")
def image_models(): return {"models": [], "loras": [], "runtime": {"ready": False}}

@app.get("/image-generation/tasks")
def image_tasks(): return {"tasks": []}

@app.get("/models")
def models(): return {"models": [{"name": "alpha:latest", "context_length": 32768}, {"name": "beta:latest", "context_length": 32768}]}

@app.get("/status")
def health(): return {"backend": {"ok": True}, "ollama": {"reachable": True}, "models": {"chat_count": 2, "embedding_ready": True}, "knowledge_base": {"ok": True}}

@app.get("/image-library/vault/status")
def privacy(): return {"locked_hashes": []}

@app.get("/files/knowledge-base")
def knowledge(): return {"documents": []}

@app.get("/qa/state")
def state(): return {"loaded": loaded, "operations": operations, "requests": requests, "maximum": controls["maximum"], "queue": main.queue.snapshot()}

@app.post("/qa/release/{prompt}")
def release(prompt: str):
    if prompt == "unload": controls["hold_switch"] = False
    elif prompt == "load": controls["hold_load"] = False
    else: controls["release"].add(prompt)
    return {"ok": True}

@app.post("/qa/hold-switch")
def hold_switch():
    controls["hold_switch"] = True
    return {"ok": True}

app.mount("/", StaticFiles(directory=sys.argv[1], html=True))
server, thread, url = serve(app)
print(json.dumps({"url": url, "chat": first["id"], "other": second["id"], "data": str(root)}), flush=True)
sys.stdin.readline()
server.should_exit = True; provider_server.should_exit = True
thread.join(timeout=10); provider_thread.join(timeout=10)
