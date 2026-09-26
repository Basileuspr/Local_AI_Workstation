"""Routes for local Diffusers image models and generated output files."""

from __future__ import annotations

import base64
import asyncio
import logging
import uuid
from contextlib import suppress
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from services.request_queue import queue, QueueCancelled, prepare_runtime
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from services import image_store
from services.image_generation_limits import MAX_IMAGE_STEPS, MAX_IMAGE_GUIDANCE
from services.image_generation import (
    OUTPUT_DIR,
    ImageGenerationCancelled,
    discover_models,
    manager,
    prompt_token_status,
)


router = APIRouter(prefix="/image-generation", tags=["image-generation"])
logger = logging.getLogger(__name__)


class ImageGenerationRequest(BaseModel):
    session_id: str | None = Field(default=None, max_length=100)
    request_id: str | None = Field(default=None, max_length=100)
    model_id: str
    prompt: str = Field(min_length=1, max_length=12000)
    negative_prompt: str | None = Field(default=None, max_length=12000)
    width: int = 1024
    height: int = 1024
    steps: int = Field(default=24, ge=1, le=MAX_IMAGE_STEPS)
    guidance_scale: float = Field(default=5.5, ge=1, le=MAX_IMAGE_GUIDANCE)
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    lora_id: str | None = None
    lora_scale: float = Field(default=1.0, ge=0, le=2)
    long_prompt: bool = True

    @field_validator("width", "height")
    @classmethod
    def supported_dimensions(cls, value: int) -> int:
        if value < 512 or value > 1536 or value % 8:
            raise ValueError("Image dimensions must be multiples of 8 from 512 through 1536.")
        return value


@router.get("/models")
def list_image_models():
    from services.lora_store import list_adapters
    # Optional adapter discovery must not prevent base-model generation.
    lora_error = None
    try:
        loras = list_adapters()
    except (OSError, ValueError, TypeError, AttributeError):
        logger.warning("Could not list optional image LoRAs", exc_info=True)
        loras = []
        lora_error = "Optional LoRAs could not be loaded. You can still generate with None (base model only)."
    return {"models": discover_models(), "loras": loras, "lora_error": lora_error, "runtime": manager.runtime_status()}


@router.post("/generate")
async def generate_image(request: ImageGenerationRequest, client_request: Request):
    request.request_id = request.request_id or uuid.uuid4().hex
    job = queue.enqueue("image", request.prompt, request.request_id,
                        session_id=request.session_id,
                        owner=f"image-generation:{request.request_id}",
                        cancel=lambda: manager.cancel(request.request_id))
    worker = None
    monitor = None
    finished = asyncio.Event()
    error = None
    async def watch_disconnect():
        while not finished.is_set():
            if await client_request.is_disconnected() and not finished.is_set():
                await queue.cancel(job)
                return
            try:
                await asyncio.wait_for(finished.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass
    try:
        await queue.wait(job, client_request)
        monitor = asyncio.create_task(watch_disconnect())
        await prepare_runtime("image")
        if job.cancel_event.is_set():
            raise QueueCancelled()
        worker = asyncio.create_task(run_in_threadpool(_generate_image, request, job.cancel_event))
        result = await asyncio.shield(worker)
        if job.cancel_event.is_set():
            raise QueueCancelled()
        return result
    except (QueueCancelled, asyncio.CancelledError):
        job.cancel_event.set()
        manager.cancel(request.request_id)
        if worker:
            with suppress(Exception):
                await asyncio.shield(worker)
        raise HTTPException(499, "Image request cancelled")
    except Exception as exc:
        error = getattr(exc, "detail", str(exc))
        raise
    finally:
        # Request.is_disconnected() uses its own cancellation scope. A task
        # cancellation can be consumed by that probe, leaving an infinite
        # watcher and withholding an already saved image's HTTP response.
        finished.set()
        try:
            if monitor:
                with suppress(asyncio.CancelledError):
                    await monitor
        finally:
            queue.finish(job, error)


def _generate_image(request: ImageGenerationRequest, cancellation_event=None):
    try:
        # The session identifies the queue's chat destination, not a pipeline option.
        result = manager.generate(**request.model_dump(exclude={"session_id"}), cancellation_event=cancellation_event)
        output_path = OUTPUT_DIR / result["filename"]
        data = output_path.read_bytes()

        # Registered in the blob store so the chat can reference it instead of
        # carrying a base64 copy inside the session JSON. The PNG under
        # data/generated_images stays as the browsable output.
        reference = image_store.put_bytes(data)

        encoded = base64.b64encode(data).decode("ascii")
        return {
            **result,
            "image_ref": reference,
            # Retained so the studio can show the result immediately without a
            # second request; it is not what gets persisted.
            "data_url": f"data:image/png;base64,{encoded}",
        }
    except ImageGenerationCancelled as exc:
        raise HTTPException(status_code=499, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Image generation failed: {exc}") from exc


@router.post("/stop/{request_id}")
async def stop_image_generation(request_id: str):
    """Interrupt the matching Diffusers pipeline at its next denoising step."""
    job = queue.find(kind="image", request_id=request_id)
    return {"stopped": await queue.cancel(job) if job else manager.cancel(request_id)}


@router.get("/progress/{request_id}")
def image_generation_progress(request_id: str):
    job = queue.find(kind="image", request_id=request_id)
    progress = manager.generation_progress(request_id)
    if progress is None and job:
        progress = {"phase": "Waiting in Prompt Queue" if job.status == "queued" else "Stopping" if job.status == "cancelling" else "Preparing runtime", "step": 0, "total_steps": 0}
    return {"progress": progress}


class PromptTokenRequest(BaseModel):
    model_id: str
    prompt: str = Field(default="", max_length=12000)
    negative_prompt: str | None = Field(default=None, max_length=12000)


@router.post("/prompt-tokens")
def get_prompt_tokens(request: PromptTokenRequest):
    try:
        return prompt_token_status(request.model_id, request.prompt, request.negative_prompt)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/outputs/{filename}")
def get_generated_image(filename: str):
    safe_name = Path(filename).name
    path = OUTPUT_DIR / safe_name
    if not path.is_file() or path.suffix.lower() != ".png":
        raise HTTPException(status_code=404, detail="Generated image not found")
    from services.image_vault import guard_path
    guard_path(path)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})
