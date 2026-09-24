"""Isolated synthetic inference for desktop batch, workflow and review QA."""
import asyncio
from dataclasses import replace
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import threading
import time
import uuid

root = Path(sys.argv[1]).resolve()
for name, folder in (("LAW_DATA_DIR", "data"), ("LAW_LOG_DIR", "logs"), ("LAW_MODELS_DIR", "models")):
    os.environ[name] = str(root / folder)
token = secrets.token_hex(24)
os.environ["LAW_SESSION_TOKEN"] = token
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import config
config.settings = replace(config.settings, ollama_base_url="http://127.0.0.1:9")
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
import uvicorn
from routes import sessions, image_library, image_workflows, image_generation, lora, request_queue
from services import image_library as library, lora_store, lora_vision
from services import image_generation as generation
from services.image_workflows import runner, providers
from services.image_workflows.providers import StageResult

for name, color in (("review-a", "#306fc0"), ("review-b", "#a03260")):
    path = root / (name + ".png")
    Image.new("RGB", (640, 400), color).save(path)
    library.import_image(path.read_bytes(), path.name)
lora_store.create_project("Settings QA", base_model_id="qa-image")
lora_store.hardware_status = lambda: {"cuda_available": False, "ready": False, "error": "Synthetic fixture"}
lora_store.validate_project = lambda *a, **k: {"ready": False, "errors": ["Synthetic fixture: no training"], "warnings": []}
async def no_vision(): return []
lora_vision.list_vision_models = no_vision
models = [{"id": "qa-image", "name": "Synthetic image", "pipeline": "SDXL", "path": str(root)}]
image_generation.discover_models = lambda: models
lora.discover_models = lambda: models

def log(name, values):
    with (root / name).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(values) + "\n")

class Manager:
    def runtime_status(self): return {"ready": True, "device": "Synthetic CPU fixture"}
    def cancel(self, _): return True
    def generation_progress(self, _): return None
    def generate(self, cancellation_event=None, **values):
        log("generation.jsonl", values)
        for _ in range(10):
            if cancellation_event.is_set(): raise image_generation.ImageGenerationCancelled("Stopped")
            time.sleep(.08)
        filename = uuid.uuid4().hex + ".png"
        image_generation.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (values["width"], values["height"]), ((values["seed"] or 0) % 256, 90, 150)).save(image_generation.OUTPUT_DIR / filename)
        return {"filename": filename, "url": "/image-generation/outputs/" + filename,
                "seed": values["seed"], "width": values["width"], "height": values["height"], "generation_seconds": .8}
image_generation.manager = Manager()
async def prepare(_): pass
image_generation.prepare_runtime = prepare
runner.prepare_runtime = prepare
def tokens(*_):
    return {key: {"token_count": 4, "native_content_limit": 75, "chunks_required": 1} for key in ("prompt", "negative_prompt")}
generation.prompt_token_status = tokens
image_generation.prompt_token_status = tokens

def capabilities():
    return {"schema_version": 1, "execution_enabled": True,
            "operations": [{**op, "supported": op["id"] in ("txt2img", "img2img")} for op in providers.OPERATIONS],
            "providers": [{"id": "local-sdxl", "name": "Synthetic image provider", "available": True,
                           "operations": ["txt2img", "img2img"], "models": models}]}
class Provider:
    operations = frozenset({"txt2img", "img2img"})
    async def execute(self, request, context):
        context.check_cancelled()
        path = context.output_dir / (uuid.uuid4().hex + ".png")
        log("workflow.jsonl", {"stage": request.stage.id, "source": str(request.source), "output": str(path),
                               "width": request.stage.width, "height": request.stage.height})
        Image.new("RGB", (request.stage.width, request.stage.height), "#a96838").save(path)
        return StageResult((path,), metadata={"fixture": True})
providers.catalog = capabilities
runner.provider_catalog = capabilities
runner.provider_factory = lambda: {"local-sdxl": Provider()}

app = FastAPI()
@app.middleware("http")
async def authenticated(request: Request, call_next):
    if request.method != "OPTIONS" and request.headers.get("X-LAW-Session", request.query_params.get("law_token")) != token:
        return JSONResponse({"detail": "Fixture session required"}, status_code=403)
    return await call_next(request)
app.add_middleware(CORSMiddleware, allow_origins=["app://local"], allow_methods=["*"], allow_headers=["*"])
for router in (sessions.router, image_library.router, image_workflows.router, image_generation.router, lora.router, request_queue.router):
    app.include_router(router)
listener = socket.socket()
listener.bind(("127.0.0.1", 0))
server = uvicorn.Server(uvicorn.Config(app, log_level="error", access_log=False))
def stop():
    sys.stdin.readline()
    server.should_exit = True
threading.Thread(target=stop, daemon=True).start()
print(json.dumps({"base": f"http://127.0.0.1:{listener.getsockname()[1]}", "token": token}), flush=True)
server.run(sockets=[listener])
