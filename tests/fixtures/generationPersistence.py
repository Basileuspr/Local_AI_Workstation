"""Synthetic inference with real task, queue, session, and image-save routes.

Run with venv/Scripts/python.exe tests/fixtures/generationPersistence.py.
All writable data goes to a new temporary directory; no real model is loaded.
"""
import os
from pathlib import Path
import sys
import tempfile
import threading
import time

work = Path(tempfile.mkdtemp(prefix='law-generation-persistence-'))
os.environ['LAW_DATA_DIR'] = str(work)
os.environ['LAW_LOG_DIR'] = str(work / 'logs')
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import uvicorn
from routes import image_generation, sessions, request_queue, image_library

release = threading.Event()
started, cancelled = [], []
progress = {}
class Manager:
    def runtime_status(self): return {'ready':True,'device':'Synthetic fixture'}
    def cancel(self, request_id): return True
    def generation_progress(self, request_id):
        return progress.get(request_id)
    def generate(self, request_id, cancellation_event, **values):
        started.append(request_id)
        progress[request_id] = {'phase':'Loading image model (held for test)','step':0,'total_steps':4,'elapsed_seconds':5}
        while not release.wait(.02):
            if cancellation_event.is_set():
                cancelled.append(request_id)
                raise image_generation.ImageGenerationCancelled('Explicitly stopped')
        release.clear()
        if cancellation_event.is_set(): raise image_generation.ImageGenerationCancelled('Explicitly stopped')
        filename = request_id + '.png'
        image_generation.OUTPUT_DIR.mkdir(parents=True,exist_ok=True)
        Image.new('RGB',(512,512),'#287c82').save(image_generation.OUTPUT_DIR / filename)
        progress.pop(request_id, None)
        return {'filename':filename,'url':'/image-generation/outputs/'+filename,'seed':values.get('seed'), 'generation_seconds':.1}
image_generation.manager = Manager()
# Queue snapshots must observe the same synthetic worker as task snapshots.
import services.image_generation as generation_service
generation_service.manager = image_generation.manager
image_generation.discover_models = lambda: [{'id':'fixture','name':'Synthetic image model','pipeline':'SDXL'}]
async def prepare(_): pass
image_generation.prepare_runtime = prepare
image_generation.prompt_token_status = lambda *_: {key:{'token_count':4,'native_content_limit':75,'chunks_required':1} for key in ('prompt','negative_prompt')}
app = FastAPI()
app.add_middleware(CORSMiddleware,allow_origins=['http://127.0.0.1:5179'],allow_methods=['*'],allow_headers=['*'])
for router in (image_generation.router,sessions.router,request_queue.router,image_library.router): app.include_router(router)
@app.post('/qa/complete')
async def complete(): release.set(); return {'ok':True}
@app.post('/qa/step')
async def step():
    for request_id in reversed(started):
        if request_id in progress:
            progress[request_id] = {'phase':'Generating image','step':1,'total_steps':4,'elapsed_seconds':20,'estimated_remaining_seconds':30}
            break
    return {'ok':True}
@app.get('/qa/state')
async def state(): return {'started':started,'cancelled':cancelled}
if __name__ == '__main__':
    print(f'Isolated fixture data: {work}',flush=True)
    uvicorn.run(app,host='127.0.0.1',port=5181,log_level='error',access_log=False)
