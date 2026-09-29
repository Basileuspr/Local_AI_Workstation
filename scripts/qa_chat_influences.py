"""Disposable production chat routes; model output and retrieval are synthetic."""
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
from types import SimpleNamespace

root = Path(tempfile.mkdtemp(prefix='law-chat-influences-'))
token = secrets.token_urlsafe(32)
os.environ.update(LAW_DATA_DIR=str(root/'data'), LAW_LOG_DIR=str(root/'logs'), LAW_MODELS_DIR=str(root/'models'), LAW_SESSION_TOKEN=token, ANONYMIZED_TELEMETRY='False')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
import httpx
import uvicorn
import main
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import sessions, faces
from services.faces import bank
from services import knowledge_base, session_store
from services.session_guard import SessionGuard

nova = bank.create_character('Nova', notes='Speak as a coastal explorer.')
bank.update_character(nova['id'], bio='Keeps a blue notebook.')
bank.create_character('Bea', notes='A different character, not loaded automatically.')
session = session_store.create_session()
session_store.append_messages(session['id'], [{'id':'old-reply','role':'assistant','content':'An older reply without a request record.'}])
captured = []
async def prepare(_): pass
main.prepare_runtime = prepare
main._append_thinking = lambda *_: None
main.create_user_if_missing = lambda _: SimpleNamespace(id=1)
main.get_or_create_memory_session = lambda **_: SimpleNamespace(id=1)
main.save_message = lambda *_: None
main.get_relevant_memories = lambda **_: [SimpleNamespace(memory_type='fact', importance=1, memory_text='Synthetic saved user memory')]
knowledge_base.query_knowledge_base = lambda *_args, **_kwargs: [{'text':'The scene is a seaside town.', 'filename':'Scene.md', 'chunk_index':0}]
async def model_reply(request):
    captured.append(json.loads(request.content))
    await asyncio.sleep(.6)
    return httpx.Response(200, text='{"message":{"content":"Synthetic reply for request verification."},"done":true}\n')
client_type = httpx.AsyncClient
main.httpx.AsyncClient = lambda **kwargs: client_type(transport=httpx.MockTransport(model_reply), **kwargs)

app = FastAPI()
app.include_router(sessions.router); app.include_router(faces.router)
app.post('/chat')(main.chat)
@app.get('/status')
def status():
    return {'backend':{'ok':True},'ollama':{'reachable':True},'models':{'chat_count':1,'embedding_ready':True},'knowledge_base':{'ok':True,'documents':1}}
@app.get('/models')
def models(): return {'models':[{'name':'fixture-model','context_length':32768}]}
@app.get('/files/knowledge-base')
def documents(): return {'documents':[{'doc_id':'scene','filename':'Scene.md'}]}
@app.get('/qa/captured')
def requests(): return captured
app.add_middleware(SessionGuard)
app.add_middleware(CORSMiddleware,allow_origins=['app://local'],allow_methods=['*'],allow_headers=['*'])
sock = socket.socket(); sock.bind(('127.0.0.1',0))
server = uvicorn.Server(uvicorn.Config(app,log_level='error',access_log=False))
thread = threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True);thread.start()
while not server.started: time.sleep(.02)
print(json.dumps({'url':f'http://127.0.0.1:{sock.getsockname()[1]}','token':token,'session_id':session['id']}),flush=True)
sys.stdin.readline();server.should_exit=True;thread.join(timeout=10)
