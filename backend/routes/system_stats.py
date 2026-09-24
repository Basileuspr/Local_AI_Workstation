"""Local hardware telemetry; independent of Ollama and GPU model runtimes."""
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from services.system_stats import sampler

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/stats")
def system_stats():
    return sampler.snapshot()


@router.get("/software-specs")
async def software_specs(request: Request):
    import httpx
    from config import settings
    from services import software_specs as inventory
    from services.image_generation import discover_models
    from services.lora_store import list_adapters
    result = await run_in_threadpool(inventory.snapshot, request.app.routes)
    models = {"ollama": [], "image": [], "lora": [], "errors": []}
    try:
        async with httpx.AsyncClient(timeout=4, trust_env=False) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            models["ollama"] = sorted([{key: value.get(key) for key in ("name", "size", "modified_at", "details")} for value in response.json().get("models", [])], key=lambda value: value["name"] or "")
    except Exception:
        models["errors"].append("Ollama model list unavailable at snapshot time.")
    try:
        models["image"] = [{key: item.get(key) for key in ("id", "name", "pipeline", "format")} for item in await run_in_threadpool(discover_models)]
        models["lora"] = [{key: item.get(key) for key in ("id", "name", "base_model")} for item in await run_in_threadpool(list_adapters)]
    except Exception:
        models["errors"].append("Image model or LoRA catalog unavailable at snapshot time.")
    result["models"] = models
    return result


@router.get("/logs/export")
async def export_logs():
    from services.software_specs import log_archive
    archive = await run_in_threadpool(log_archive)
    def chunks():
        while data := archive.read(1024 * 1024):
            yield data
    return StreamingResponse(chunks(), media_type="application/zip", background=BackgroundTask(archive.close),
        headers={"Content-Disposition": 'attachment; filename="workstation-app-logs.zip"', "Cache-Control": "no-store"})
