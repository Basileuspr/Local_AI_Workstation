"""Production UI/session routes with temporary data and a synthetic chat provider.

No installed model is loaded, and no existing application data is read.
"""
import asyncio
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time

root = Path(tempfile.mkdtemp(prefix='law-remaining-tasks-qa-'))
os.environ.update(LAW_DATA_DIR=str(root / 'data'), LAW_LOG_DIR=str(root / 'logs'),
                  LAW_MODELS_DIR=str(root / 'models'), LAW_SESSION_TOKEN='remaining-tasks-qa',
                  ANONYMIZED_TELEMETRY='False')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

requests = []
provider = FastAPI()


@provider.post('/api/show')
def show():
    return {'capabilities': ['completion'], 'model_info': {'demo.context_length': 32768}}


@provider.post('/api/chat')
async def chat(request: Request):
    body = await request.json()
    prompt = next(item['content'] for item in reversed(body['messages']) if item['role'] == 'user')
    requests.append({'prompt': prompt, 'messages': body['messages']})
    if not body.get('stream', True):
        return {'message': {'content': 'Synthetic summary.'}}

    async def stream():
        for index in range(120 if prompt == 'qa slow reply' else 3):
            if await request.is_disconnected():
                return
            yield json.dumps({'message': {'content': f'Synthetic step {index + 1}. '}, 'done': False}) + '\n'
            await asyncio.sleep(.25 if prompt == 'qa slow reply' else .08)
        yield json.dumps({'message': {'content': ''}, 'done': True, 'prompt_eval_count': 100, 'eval_count': 30}) + '\n'
    return StreamingResponse(stream(), media_type='application/x-ndjson')


def serve(app):
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level='error', access_log=False))
    thread = threading.Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(.02)
    return server, thread, f'http://127.0.0.1:{sock.getsockname()[1]}'


provider_server, provider_thread, provider_url = serve(provider)
os.environ['LAW_OLLAMA_URL'] = provider_url
import main
from routes.sessions import router as sessions
from routes.request_queue import router as queue_routes
from routes.image_library import router as library_routes
from routes.visual_review import router as review_routes
from routes.system_stats import router as system_routes
from services import session_store as store, image_library as library

main.OLLAMA_BASE_URL = provider_url
main._append_thinking = lambda *_: None


async def prepare(_kind):
    pass


main.prepare_runtime = prepare
session = store.create_session('Synthetic QA conversation')
messages = [{'id': f'qa-{index}', 'role': 'user' if index % 2 == 0 else 'assistant',
             'content': f'QA message {index + 1}\n\n' + 'Neutral fixture text for scroll verification. ' * 5}
            for index in range(16)]
store.append_messages(session['id'], messages, 'qa:latest')
image_file = root / 'qa-image.png'
Image.new('RGB', (320, 240), (65, 115, 145)).save(image_file)
library.import_image(image_file.read_bytes(), 'qa-image.png', origin={'kind': 'review'})

app = FastAPI()
for router in (sessions, queue_routes, library_routes, review_routes, system_routes):
    app.include_router(router)
app.post('/chat')(main.chat)
app.post('/chat/stop/{request_id}')(main.stop_chat)
app.get('/runtime/status')(main.runtime_status)


@app.get('/models')
def models():
    return {'models': [{'name': 'qa:latest', 'context_length': 8192, 'trained_context_length': 32768}]}


@app.get('/status')
def status():
    return {'backend': {'ok': True}, 'ollama': {'reachable': True},
            'models': {'chat_count': 1, 'embedding_ready': True}, 'knowledge_base': {'ok': True}}


@app.get('/files/knowledge-base')
def knowledge():
    return {'documents': []}


@app.get('/image-generation/models')
def image_models():
    return {'models': [], 'loras': [], 'runtime': {'ready': False}}


@app.get('/image-generation/tasks')
def image_tasks():
    return {'tasks': []}


@app.get('/qa/state')
def state():
    return {'requests': requests, 'session': store.get_session(session['id']), 'library': library.public_index()}


app.mount('/', StaticFiles(directory=sys.argv[1], html=True))
server, thread, url = serve(app)
print(json.dumps({'url': url, 'chat': session['id'], 'data': str(root), 'image': str(image_file)}), flush=True)
try:
    if '--serve' in sys.argv:
        while True:
            time.sleep(.5)
    else:
        sys.stdin.readline()
except KeyboardInterrupt:
    pass
server.should_exit = True
provider_server.should_exit = True
thread.join(timeout=10)
provider_thread.join(timeout=10)
