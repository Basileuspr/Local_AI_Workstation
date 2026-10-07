"""Real chat/session/artifact routes with a deterministic provider and disposable data."""
import asyncio
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import tempfile
import threading
import time

root = Path(tempfile.mkdtemp(prefix="law-docx-ui-"))
token = secrets.token_urlsafe(32)
os.environ.update(LAW_DATA_DIR=str(root / "data"), LAW_LOG_DIR=str(root / "logs"), LAW_MODELS_DIR=str(root / "models"), LAW_SESSION_TOKEN=token, ANONYMIZED_TELEMETRY="False")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import httpx
import uvicorn
import main
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import sessions, artifacts
from services import session_store
from services.session_guard import SessionGuard

session = session_store.create_session("Word additions QA")
session_store.append_messages(session['id'], [{'id':'qa-ready','role':'assistant','content':'Ready for Word document QA.'}])
captured = []
async def prepare(_): pass
main.prepare_runtime = prepare
main._append_thinking = lambda *_: None
async def model_reply(request):
    if request.url.path == "/api/show": return httpx.Response(200, json={"capabilities": ["completion"]})
    payload = json.loads(request.content); captured.append(payload)
    prompt = next(m["content"] for m in reversed(payload["messages"]) if m["role"] == "user")
    await asyncio.sleep(1.0)
    blocks = [{"type": "paragraph", "text": prompt.replace("/docx append ", "")}, {"type": "table", "headers": ["Part", "Status"], "rows": [[str(len(captured)), "Included"]]}]
    output = {"blocks": blocks}
    if "title" in payload.get("format", {}).get("properties", {}):
        output.update(title="Word additions QA", filename="other.docx" if "other" in prompt else "report.docx")
        blocks.insert(0, {"type": "function_plot", "function": "sin", "caption": "Original sine plot"})
    return httpx.Response(200, text=json.dumps({"message": {"content": json.dumps(output)}, "done": True}) + "\n")
client_type = httpx.AsyncClient
main.httpx.AsyncClient = lambda **kwargs: client_type(transport=httpx.MockTransport(model_reply), **kwargs)

app = FastAPI()
for router in (sessions.router, artifacts.router): app.include_router(router)
app.post("/chat")(main.chat)
app.post("/chat/stop/{request_id}")(main.stop_chat)
@app.get("/status")
def status(): return {"backend": {"ok": True}, "ollama": {"reachable": True}, "models": {"chat_count": 1, "embedding_ready": True}, "knowledge_base": {"ok": True, "documents": 0}}
@app.get("/models")
def models(): return {"models": [{"name": "fixture-model", "context_length": 32768}]}
@app.get("/runtime/status")
def runtime(): return {"ready": True}
@app.get("/request-queue")
def queued(): return main.queue.snapshot()
@app.get("/image-library/vault/status")
def privacy(): return {"locked_hashes": [], "unlocked": True}
@app.get("/qa/captured")
def requests(): return captured
app.add_middleware(SessionGuard)
app.add_middleware(CORSMiddleware, allow_origins=["app://local"], allow_methods=["*"], allow_headers=["*"])
sock = socket.socket(); sock.bind(("127.0.0.1", 0))
server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True); thread.start()
while not server.started: time.sleep(.02)
print(json.dumps({"url": f"http://127.0.0.1:{sock.getsockname()[1]}", "token": token, "session_id": session["id"], "data": str(root)}), flush=True)
sys.stdin.readline(); server.should_exit = True; thread.join(timeout=10)
