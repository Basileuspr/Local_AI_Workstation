"""Local hardware telemetry; independent of Ollama and GPU model runtimes."""
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from services.system_stats import sampler

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/environment")
async def environment(refresh: bool = False, live: bool = False, resources: bool = False):
    from services.environment_awareness import static_snapshot, live_services
    result = {"schema_version": 1, "static": await run_in_threadpool(static_snapshot, refresh)}
    if live:
        result["services"] = await live_services()
    if resources:
        result["resources"] = await run_in_threadpool(sampler.snapshot)
    return result


@router.get("/updates")
async def updates():
    from services.app_updates import check_updates
    return await check_updates()


@router.get("/dependencies")
async def dependencies(profile: str = "requirements.txt"):
    from services.dependency_management import check_compatibility
    from fastapi import HTTPException
    try:
        return await run_in_threadpool(check_compatibility, profile=profile)
    except ValueError as error:
        raise HTTPException(400, str(error))


from pydantic import BaseModel, Field


class ContextQuery(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    messages: list[dict] = Field(default_factory=list, max_length=10000)
    output_tokens: int = Field(default=1024, ge=-1, le=1000000)


@router.post("/context")
async def context(query: ContextQuery):
    from services.context_awareness import model_limit, payload_usage
    return payload_usage({"model": query.model, "messages": query.messages,
                          "options": {"num_ctx": await model_limit(query.model), "num_predict": query.output_tokens}})


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
    result = await run_in_threadpool(inventory.snapshot, request.app.routes,
                                   build_info=getattr(request.app.state, "build_info", None))
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
