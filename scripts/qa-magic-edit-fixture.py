"""Isolated workflow API for Magic Edit UI acceptance. Real models require --real."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import uuid

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('output',type=Path)
parser.add_argument('--real',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
output=args.output.resolve()
if output.is_relative_to(root): parser.error('Keep acceptance output outside the repository.')
output.mkdir(parents=True,exist_ok=True)
for key,subdir in [('LAW_DATA_DIR','data'),('LAW_LOG_DIR','logs'),('LAW_IMAGE_MANAGER_DIR','catalog')]:os.environ[key]=str(output/subdir)
os.environ['LAW_MODELS_DIR']=str(root/'models' if args.real else output/'models')
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
sys.path.insert(0,str(root/'backend'))
from fastapi import FastAPI,Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image,ImageDraw
from routes import image_workflows
from services.image_workflows import runner,providers
from services.image_workflows.providers import StageResult
from services import image_generation
import uvicorn
# Initialize NumPy on the main thread before Torch can import it in an API worker.
# Some Windows builds block while loading its native modules from that worker.
import numpy
if args.real:
    image_generation.manager.runtime_status()

app=FastAPI()
token=secrets.token_hex(24)
@app.middleware('http')
async def authenticated(request:Request,call_next):
    if request.method!='OPTIONS' and request.headers.get('X-LAW-Session',request.query_params.get('law_token'))!=token:
        return JSONResponse({'detail':'Fixture session required'},status_code=403)
    return await call_next(request)
app.add_middleware(CORSMiddleware,allow_origins=['app://local'],allow_methods=['*'],allow_headers=['*'])
app.include_router(image_workflows.router)
for i,color in [(1,'steelblue'),(2,'tan')]:
    image=Image.new('RGB',(640,480),color);draw=ImageDraw.Draw(image)
    draw.rectangle((100,80,400,350),fill='teal',outline='white',width=9)
    image.save(output/f'synthetic-{i}.png')

if not args.real:
    def capabilities():
        return {'schema_version':1,'execution_enabled':True,'operations':providers.OPERATIONS,'providers':[
            {'id':key,'name':key,'operations':ops,'available':True,'models':[] if key=='local-realesrgan' else [{'id':'qa-model','name':'QA model'}]}
            for key,ops in [('local-sdxl',['img2img','inpaint']),('local-sdxl-controlnet',['controlnet']),('local-sdxl-ip-adapter',['multi_reference']),('local-sdxl-outpaint',['outpaint']),('local-realesrgan',['upscale']),('ollama-vision',['describe'])]]}
    class SyntheticProvider:
        operations=frozenset({'img2img','inpaint','controlnet','multi_reference','outpaint','upscale','describe'})
        async def execute(self,request,context):
            for step in range(4):
                context.check_cancelled();context.progress(phase='Synthetic Magic Edit',step=step,total_steps=4);await asyncio.sleep(.2)
            if request.stage.operation=='describe':return StageResult(text='Keep the same face and clothing. Gently improve the neutral background lighting.')
            with Image.open(request.source) as source:
                size=tuple(v*request.stage.upscale_factor for v in source.size) if request.stage.operation=='upscale' else (request.stage.width,request.stage.height)
            image=Image.new('RGB',size,(110,90,70));path=context.output_dir/f'{uuid.uuid4().hex}.png';image.save(path)
            return StageResult((path,),metadata={'synthetic':True})
    async def no_runtime(_):pass
    providers.catalog=capabilities;runner.provider_catalog=capabilities
    runner.provider_factory=lambda:{p['id']:SyntheticProvider() for p in capabilities()['providers']}
    runner.prepare_runtime=no_runtime
    image_generation.prompt_token_status=lambda *args:{'prompt':{'chunks_required':1},'negative_prompt':{'chunks_required':1}}

listener=socket.socket();listener.bind(('127.0.0.1',0))
server=uvicorn.Server(uvicorn.Config(app,log_level='error',access_log=False))
def stop():
    sys.stdin.readline();server.should_exit=True
threading.Thread(target=stop,daemon=True).start()
print(json.dumps({'base':f'http://127.0.0.1:{listener.getsockname()[1]}','token':token}),flush=True)
server.run(sockets=[listener])
