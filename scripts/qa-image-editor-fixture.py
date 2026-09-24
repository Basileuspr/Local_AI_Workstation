"""Synthetic Character Parts fixture; every writable path is inside the QA root."""
import io
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading

root = Path(sys.argv[1]).resolve()
for name, child in (("LAW_DATA_DIR", "data"), ("LAW_LOG_DIR", "logs"), ("LAW_MODELS_DIR", "models")):
    os.environ[name] = str(root / child)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw, ImageFilter
import uvicorn
from routes import character_parts
from services.character_parts import store
from services.character_parts.contracts import Selection

image = Image.new("RGBA", (640, 400))
image.putdata([(min(255, 80 + x // 4), y // 3, (x + y) // 6, 180 if x < 200 else 255) for y in range(400) for x in range(640)])
image.save(root / "original.png")
line_art = Image.new('RGB', (640, 400), 'white')
ImageDraw.Draw(line_art).rectangle((160, 100, 480, 300), outline='black', width=8)
line_art.save(root / 'line-art.png')
Image.new('RGB', (160, 100), (214, 159, 118)).save(root / 'reference.png')
# A known sharp reference and its optically softened copy, larger than the old
# 1400px preview cap. Only temporary synthetic files are read by the desktop QA.
detail = Image.new('RGB', (1800, 900), (140, 140, 140))
draw = ImageDraw.Draw(detail)
for y in range(50, 820, 60):
    for x in range(40, 1720, 60):
        draw.rectangle((x, y, x + 28, y + 28), fill=(75, 75, 75))
        draw.line((x, y + 42, x + 38, y + 35), fill=(205, 205, 205), width=3)
detail.save(root / 'detail-reference.png')
detail.filter(ImageFilter.GaussianBlur(1.15)).save(root / 'detail-source.png')
payload = (root / "original.png").read_bytes()
data = store.create("Export QA")
store.import_image(data["id"], payload, "original.png", {"kind": "upload"})
data = store.read(data["id"])
for state in ("accepted", "rejected", "pending"):
    data = store.save_selection(data["id"], data["revision"], Selection(source_id=data["sources"][0]["id"],
        part="buttocks", detail=state, box=(.1, .1, .9, .9), caption=state, state=state))
character_parts.vision_models = lambda: []
app = FastAPI()
token = secrets.token_hex(24)
@app.middleware("http")
async def authenticated(request: Request, call_next):
    if request.method != "OPTIONS" and request.headers.get("X-LAW-Session", request.query_params.get("law_token")) != token:
        return JSONResponse({"detail": "Fixture session required"}, status_code=403)
    return await call_next(request)
app.add_middleware(CORSMiddleware, allow_origins=["app://local"], allow_methods=["*"], allow_headers=["*"])
app.include_router(character_parts.router)
# Synthetic workflow providers exercise the real upload, snapshot, queue and output routes.
# No model, Ollama service or GPU inference is touched by this fixture.
from routes import image_workflows
from services.image_workflows import runner, providers, adapters
from services.image_workflows.providers import StageResult
from services import image_generation
import asyncio
import uuid
def capabilities():
    return {'schema_version':1,'execution_enabled':True,'operations':providers.OPERATIONS,'providers':[
        {'id':'local-sdxl','name':'QA image provider','operations':['img2img','inpaint'],'available':True,'models':[{'id':'qa-image','name':'QA image'}]},
        {'id':'ollama-vision','name':'QA vision provider','operations':['describe'],'available':True,'models':[{'id':'qa-vision','name':'QA vision'}]}]}
class FixtureProvider:
    operations=frozenset({'img2img','inpaint','describe'})
    async def execute(self, request, context):
        with (root/'magic-requests.jsonl').open('a',encoding='utf-8') as stream:
            stream.write(json.dumps({'operation':request.stage.operation,'references':len(request.references),
                'roles':request.stage.reference_roles,'prompt':request.prompt_settings.prompt,'mask':bool(request.mask),
                'size':[request.stage.width,request.stage.height],
                'source_size':list(Image.open(request.source).size) if request.source else None,
                'mask_size':list(Image.open(request.mask).size) if request.mask else None})+'\n')
        for i in range(4):
            context.check_cancelled();context.progress(phase='Synthetic candidate',step=i,total_steps=4)
            await asyncio.sleep(.3)
        if request.stage.operation=='describe':
            return StageResult(text='Preserve the pose and outlines. Use a muted green detailed background and warm tan skin.',metadata={'fixture':True})
        image=Image.new('RGB',(request.stage.width,request.stage.height),(200,60,30))
        path=context.output_dir/(uuid.uuid4().hex+'.png');image.save(path)
        return StageResult((path,),metadata={'fixture':True})
async def prepare_fixture(_): pass
providers.catalog=capabilities
runner.provider_catalog=capabilities
runner.provider_factory=lambda:{'local-sdxl':FixtureProvider(),'ollama-vision':FixtureProvider()}
runner.prepare_runtime=prepare_fixture
image_generation.prompt_token_status=lambda *args:{'prompt':{'chunks_required':1},'negative_prompt':{'chunks_required':1}}
app.include_router(image_workflows.router)
listener = socket.socket()
listener.bind(("127.0.0.1", 0))
server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
def stop():
    sys.stdin.readline()
    server.should_exit = True
threading.Thread(target=stop, daemon=True).start()
print(json.dumps({"base": f"http://127.0.0.1:{listener.getsockname()[1]}", "token": token, "datasetId": data["id"]}), flush=True)
server.run(sockets=[listener])
