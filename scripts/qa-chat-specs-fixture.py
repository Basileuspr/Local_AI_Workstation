"""Isolated API fixture for chat image destinations, named face runs and specs."""
import base64
from dataclasses import replace
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading

root = Path(sys.argv[1]).resolve()
for name, folder in (("LAW_DATA_DIR", "data"), ("LAW_LOG_DIR", "logs"), ("LAW_MODELS_DIR", "models")):
    os.environ[name] = str(root / folder)
token = secrets.token_hex(24)
os.environ["LAW_SESSION_TOKEN"] = token
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import uvicorn
import config
config.settings = replace(config.settings, ollama_base_url="http://127.0.0.1:9")
from routes import sessions, image_library, image_workflows, faces, system_stats
from services import session_store
from services.faces import pipeline, store as face_store
from services.faces.providers import ProviderStatus

image = Image.new('RGB', (640, 480), '#406fc0')
image.save(root / 'source.png')
payload = (root / 'source.png').read_bytes()
chat = session_store.create_session('Image destination QA')
session_store.update_session(chat['id'], messages=[{'id': 'qa-message', 'role': 'assistant',
    'content': f"Viewed image: ![Inline sample](/sessions/{chat['id']}/images/by-id/qa-message/qa-image)",
    'generatedImages': [{'id': 'qa-image', 'name': 'QA image.png', 'src': 'data:image/png;base64,' + base64.b64encode(payload).decode()}]}])
face_store.create_dataset('Named face QA')
class FakeProvider:
    def uses_gpu(self): return False
    def detect(self, *args, **kwargs): return []
    def unload(self): return True
pipeline.get_provider = lambda: FakeProvider()
faces.catalog = lambda: [ProviderStatus('fake', 'Synthetic QA provider', True, 'cpu', 'No model inference', [])]
image_workflows.providers.catalog = lambda: {'operations': [], 'providers': [], 'warnings': []}
(root / 'logs').mkdir(exist_ok=True)
(root / 'logs' / 'backend.log').write_text(f'Synthetic error; law_token={token}\n')
app = FastAPI()
@app.middleware('http')
async def authenticated(request: Request, call_next):
    if request.method != 'OPTIONS' and request.headers.get('X-LAW-Session', request.query_params.get('law_token')) != token:
        return JSONResponse({'detail': 'Fixture session required'}, status_code=403)
    return await call_next(request)
app.add_middleware(CORSMiddleware, allow_origins=['app://local'], allow_methods=['*'], allow_headers=['*'])
for router in (sessions.router, image_library.router, image_workflows.router, faces.router, system_stats.router):
    app.include_router(router)
listener = socket.socket(); listener.bind(('127.0.0.1', 0))
server = uvicorn.Server(uvicorn.Config(app, log_level='error', access_log=False))
def stop():
    sys.stdin.readline(); server.should_exit = True
threading.Thread(target=stop, daemon=True).start()
print(json.dumps({'base': f'http://127.0.0.1:{listener.getsockname()[1]}', 'token': token, 'sessionId': chat['id']}), flush=True)
server.run(sockets=[listener])
