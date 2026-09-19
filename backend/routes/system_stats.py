"""Local hardware telemetry; independent of Ollama and GPU model runtimes."""
from fastapi import APIRouter
from services.system_stats import sampler

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/stats")
def system_stats():
    return sampler.snapshot()
