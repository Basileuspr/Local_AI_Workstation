"""Production chat/voice routes in disposable storage with synthetic inference."""
import asyncio
import io
import json
import math
import os
from pathlib import Path
import secrets
import socket
import struct
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import wave

root = Path(tempfile.mkdtemp(prefix='law-chat-speech-qa-'))
token = secrets.token_urlsafe(32)
os.environ.update(LAW_DATA_DIR=str(root/'data'), LAW_LOG_DIR=str(root/'logs'),
                 LAW_MODELS_DIR=str(root/'models'), LAW_SESSION_TOKEN=token, ANONYMIZED_TELEMETRY='False')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
import httpx
import uvicorn
import main
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import sessions, faces, audio, request_queue
from services import session_store, character_resources, voice_cloning as voices
from services.audio import AudioError
from services.session_guard import SessionGuard

def waveform(seconds):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as handle:
        handle.setnchannels(1); handle.setsampwidth(2); handle.setframerate(24000)
        handle.writeframes(b''.join(struct.pack('<h', int(6000*math.sin(i*.12))) for i in range(int(seconds*24000))))
    return buffer.getvalue()

reference = root/'Reference.wav'; reference.write_bytes(waveform(6.1))
saved_reference = character_resources.save_asset(reference.name, reference.read_bytes())
session = session_store.create_session()
session_store.append_messages(session['id'], [{'id':'old-reply','role':'assistant','content':'An older reply for manual speech.'}])
calls, options = [], {'mode':'normal'}
async def prepare(_): pass
main.prepare_runtime = prepare
main._append_thinking = lambda *_: None
main.create_user_if_missing = lambda _: SimpleNamespace(id=1)
main.get_or_create_memory_session = lambda **_: SimpleNamespace(id=1)
main.save_message = lambda *_: None
main.get_relevant_memories = lambda **_: []
async def model_reply(request):
    prompt = json.loads(request.content)['messages'][-1]['content']
    await asyncio.sleep(.2)
    return httpx.Response(200, text=json.dumps({'message':{'content':'Completed reply: '+prompt},'done':True})+'\n')
client_type = httpx.AsyncClient
main.httpx.AsyncClient = lambda **kwargs: client_type(transport=httpx.MockTransport(model_reply), **kwargs)
voices.status = lambda: {'engines':{key:{**value,'ready':True} for key,value in voices.ENGINES.items()},'reference_ready':True,'busy':False,'max_text':1500}
def synthesize(engine, text, reference, reference_text, language, acceleration, directory, cancel_event=None):
    call = {'engine':engine,'text':text,'cancelled':False,'mode':options['mode']}
    calls.append(call)
    if call['mode'] == 'slow':
        if cancel_event and cancel_event.wait(8):
            call['cancelled'] = True
            voices.check_cancelled(cancel_event)
    else:
        time.sleep(.15)
    if call['mode'] == 'fail':
        raise AudioError('Synthetic voice failure. Text is preserved.', 500)
    return waveform(4), {'device':'cpu','seconds':.15,'warnings':[]}
voices.synthesize = synthesize

app = FastAPI()
for router in (sessions.router,faces.router,audio.router,request_queue.router): app.include_router(router)
app.post('/chat')(main.chat)
@app.get('/status')
def status(): return {'backend':{'ok':True},'ollama':{'reachable':True},'models':{'chat_count':1,'embedding_ready':False},'knowledge_base':{'ok':True,'documents':0}}
@app.get('/models')
def models(): return {'models':[{'name':'fixture-model','context_length':32768}]}
@app.get('/files/knowledge-base/list')
def documents(): return {'documents':[]}
@app.get('/qa/calls')
def captured(): return calls
@app.post('/qa/mode/{mode}')
def mode(mode: str): options['mode'] = mode; return options
app.add_middleware(SessionGuard)
app.add_middleware(CORSMiddleware,allow_origins=['app://local'],allow_methods=['*'],allow_headers=['*'])
sock = socket.socket(); sock.bind(('127.0.0.1',0))
server = uvicorn.Server(uvicorn.Config(app,log_level='error',access_log=False))
thread = threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True);thread.start()
while not server.started: time.sleep(.02)
print(json.dumps({'url':f'http://127.0.0.1:{sock.getsockname()[1]}','token':token,
                  'session_id':session['id'],'reference':saved_reference,'reference_path':str(reference)}),flush=True)
sys.stdin.readline();server.should_exit=True;thread.join(timeout=10)
