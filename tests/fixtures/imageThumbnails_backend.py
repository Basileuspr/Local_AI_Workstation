"""Synthetic originals through real image routes; no user data or GPU access."""
import os
from pathlib import Path
import sys
import tempfile
from io import BytesIO
from types import SimpleNamespace
import hashlib

temporary = tempfile.TemporaryDirectory(prefix="law-thumbnail-preview-")
os.environ["LAW_DATA_DIR"] = temporary.name
os.environ["LAW_SESSION_TOKEN"] = "thumbnail-fixture-token"
os.environ["LAW_ALLOWED_ORIGINS"] = "http://127.0.0.1:5284"
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw
from config import settings
from services import image_vault as vault
from services.session_guard import SessionGuard
from routes import image_library, sessions, web, faces, lora, image_workflows, workspaces

payloads = []
for number, color in enumerate(["#4169a1", "#cc713d", "#397e60", "#915fb0", "#b63f59", "#497d91", "#bf9d3e", "#a45481"]):
    image = Image.new("RGB", (1200, 600), color)
    draw = ImageDraw.Draw(image); draw.ellipse((120, 100, 420, 400), fill="#e6eaf3"); draw.rectangle((650, 200, 1000, 480), fill="#242a3c")
    stream = BytesIO(); image.save(stream, "PNG"); payloads.append(stream.getvalue())
files = []
for index, payload in enumerate(payloads):
    path = Path(temporary.name) / f"source-{index}.png"; path.write_bytes(payload); files.append(path)
paths = ["/image-library/images/a/content", "/sessions/a/images/by-id/b/c", "/web/images/" + "a" * 64,
         "/faces/datasets/a/faces/b/crop", "/lora/projects/a/images/b", "/image-workflows/a/assets/b",
         "/image-workflows/a/jobs/b/outputs/c", "/workspaces/converted/a"]
labels = ["Saved library", "Chat gallery", "Web images", "Face crops", "LoRA dataset", "Workflow assets", "Workflow outputs", "Converted images"]
records = [{"id": str(index), "url": path, "name": labels[index] + ".png", "width": 1200, "height": 600,
            "key": str(index), "source": {"kind": "library", "id": str(index)}, "hidden": False, "folder_ids": [], "tag_ids": []} for index, path in enumerate(paths)]
locked = set(); faults = {"access": 0, "images": False}; counts = {}
vault.locked_hashes = lambda: locked
image_library.library.image_bytes = lambda *args: (payloads[0], {"type": "image/png"})
image_library.library.public_index = lambda: {"images": [{**records[0], "source": "Fixture saved image"}], "folders": [], "tags": []}
sessions.get_session_image_by_id = lambda *args: (payloads[1], "image/png")
web.image_store.get_bytes = lambda *args: (payloads[2], "image/png")
faces.store.crop_path = lambda *args: files[3]
lora.lora_store.image_path = lambda *args: files[4]
image_workflows.store.asset_path = lambda *args: (files[5], SimpleNamespace(media_type="image/png"))
image_workflows.runner.output_path = lambda *args: (files[6], {})
workspaces.image_conversion.read = lambda *args: ({"name": "converted.png", "format": "png"}, files[7])

app = FastAPI()
for module in [image_library, sessions, web, faces, lora, image_workflows, workspaces]: app.include_router(module.router)

@app.get("/fixture/manifest")
def manifest(): return {"images": records, "counts": counts}

@app.post("/fixture/fault/{kind}")
def fault(kind: str):
    if kind == "access": faults["access"] = 1
    if kind == "images": faults["images"] = True
    if kind == "lock": locked.add(hashlib.sha256(payloads[0]).hexdigest())
    if kind == "unlock": locked.clear()
    return {"ok": True}

@app.middleware("http")
async def failures(request, call_next):
    path = request.url.path; counts[path] = counts.get(path, 0) + 1
    if path == "/image-library/vault/status" and faults["access"]:
        faults["access"] -= 1; return JSONResponse({"detail": "Synthetic transient failure"}, status_code=503)
    if path in paths and faults["images"]:
        if request.query_params.get("preview_retry"):
            faults["images"] = False
        else:
            return JSONResponse({"detail": "Synthetic image failure"}, status_code=503)
    return await call_next(request)

app.add_middleware(SessionGuard)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_methods=["GET", "POST"], allow_headers=["*"])
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8086, access_log=False)
