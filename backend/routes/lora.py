"""Local LoRA project, dataset, and training routes."""

from __future__ import annotations
import uuid
from services.request_queue import queue, QueueCancelled, prepare_runtime

import asyncio

from fastapi import APIRouter, File, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from services import lora_store, lora_vision
from services.image_generation import discover_models
from services.lora_training import manager

router = APIRouter(prefix="/lora", tags=["lora"])
active_analysis_tasks: dict[str, asyncio.Task] = {}


def _analysis_revision(project: dict) -> tuple:
    return (
        project.get("trigger_word", ""),
        project.get("training_goal", ""),
        project.get("vision_model", ""),
        tuple((image.get("id"), image.get("sha256")) for image in project.get("images") or []),
    )


class ProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    trigger_word: str = Field(default="", max_length=200)
    training_goal: str | None = Field(default=None, max_length=40)
    base_model_id: str = Field(default="", max_length=200)
    vision_model: str | None = Field(default=None, max_length=200)
    output_location: str = Field(default="", max_length=120)
    settings: dict | None = None


class CaptionRequest(BaseModel):
    caption: str = Field(default="", max_length=4000)


class VisionAnalysisRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    request_id: str = Field(min_length=1, max_length=200)


@router.get("/hardware")
def get_hardware():
    return lora_store.hardware_status()


@router.get("/vision-models")
async def get_vision_models():
    try:
        return {"models": await lora_vision.list_vision_models()}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/projects")
def list_projects():
    return {"projects": lora_store.list_projects()}


@router.post("/projects")
def create_project(request: ProjectRequest):
    try:
        project = lora_store.create_project(
            name=request.name,
            description=request.description,
            trigger_word=request.trigger_word,
            base_model_id=request.base_model_id,
            output_location=request.output_location,
            training_goal=request.training_goal or "character_identity",
            vision_model=request.vision_model or "",
        )
        if request.settings:
            project = lora_store.update_project(project["id"], {"settings": request.settings})
        return project
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/projects/{project_id}")
def get_project(project_id: str):
    try:
        return lora_store.get_project(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/projects/{project_id}")
def update_project(project_id: str, request: ProjectRequest):
    try:
        return lora_store.update_project(project_id, request.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/projects/{project_id}/images")
async def upload_images(project_id: str, files: list[UploadFile] = File(...)):
    try:
        project = lora_store.get_project(project_id)
        if not any(model.get("id") == project.get("base_model_id") for model in discover_models()):
            raise ValueError("Select an installed SDXL image model before adding training images")
        payloads = [(file.filename or "image", await file.read()) for file in files]
        return await run_in_threadpool(lora_store.add_images, project_id, payloads)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/projects/{project_id}/images/{image_id}")
def get_image(project_id: str, image_id: str):
    try:
        path = lora_store.image_path(project_id, image_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if path is None:
        raise HTTPException(status_code=404, detail="Training image not found")
    return FileResponse(path, headers={"Cache-Control": "no-store"})


@router.put("/projects/{project_id}/images/{image_id}/caption")
def update_caption(project_id: str, image_id: str, request: CaptionRequest):
    try:
        return lora_store.update_image_caption(project_id, image_id, request.caption)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/projects/{project_id}/images/{image_id}")
def remove_image(project_id: str, image_id: str):
    try:
        return lora_store.remove_image(project_id, image_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/projects/{project_id}/images")
def clear_images(project_id: str):
    try:
        return lora_store.clear_images(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/projects/{project_id}/analyze")
async def analyze_project(project_id: str, request: VisionAnalysisRequest, client_request: Request):
    if queue.find(kind="training", project_id=project_id):
        raise HTTPException(409, "This project already has a queued or active training workflow")
    job = queue.enqueue("analysis", "LoRA dataset analysis", request.request_id,
                        owner=f"lora-vision:{project_id}", project_id=project_id,
                        cancel=lambda: _stop_analysis_task(request.request_id))
    active_analysis_tasks[request.request_id] = asyncio.current_task()
    error = None
    try:
        await queue.wait(job, client_request)
        await prepare_runtime("analysis")
        if job.cancel_event.is_set():
            raise QueueCancelled()
        return await _analyze_project(project_id, request)
    except (QueueCancelled, asyncio.CancelledError):
        job.cancel_event.set()
        raise HTTPException(499, "Dataset analysis cancelled")
    except Exception as exc:
        error = getattr(exc, "detail", str(exc))
        raise
    finally:
        active_analysis_tasks.pop(request.request_id, None)
        queue.finish(job, error)


async def _analyze_project(project_id: str, request: VisionAnalysisRequest):
    task = asyncio.current_task()
    if task is not None:
        active_analysis_tasks[request.request_id] = task
    try:
        project = await run_in_threadpool(lora_store.get_project, project_id)
        if project.get("vision_model") != request.model:
            project = await run_in_threadpool(
                lora_store.update_project,
                project_id,
                {"vision_model": request.model},
            )
        revision = _analysis_revision(project)
        analysis = await lora_vision.analyze_project(project, request.model)
        current_project = await run_in_threadpool(lora_store.get_project, project_id)
        if _analysis_revision(current_project) != revision:
            raise ValueError("The dataset changed during analysis; analyze the current images again")
        return await run_in_threadpool(lora_store.save_identity_analysis, project_id, analysis)
    except asyncio.CancelledError as exc:
        raise HTTPException(status_code=499, detail="Dataset analysis stopped") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        if active_analysis_tasks.get(request.request_id) is task:
            active_analysis_tasks.pop(request.request_id, None)


@router.get("/projects/{project_id}/analysis-progress")
def get_analysis_progress(project_id: str):
    return {"progress": lora_vision.analysis_progress(project_id)}


@router.post("/projects/{project_id}/analysis/apply-captions")
async def apply_analysis_captions(project_id: str):
    try:
        return await run_in_threadpool(lora_store.apply_caption_suggestions, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/analysis/stop/{request_id}")
async def stop_analysis(request_id: str):
    job = queue.find(kind="analysis", request_id=request_id)
    if job:
        return {"stopped": await queue.cancel(job)}
    return _stop_analysis_task(request_id)


def _stop_analysis_task(request_id: str):
    task = active_analysis_tasks.get(request_id)
    if task is None or task.done():
        return {"stopped": False}
    task.cancel()
    return {"stopped": True}


@router.get("/projects/{project_id}/preflight")
def preflight(project_id: str):
    try:
        project = lora_store.get_project(project_id)
        return lora_store.validate_project(project, discover_models())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


training_queue_tasks = set()


async def run_queued_training(job, analysis_model=None):
    error = None
    try:
        await queue.wait(job)
        if analysis_model:
            job.stage = "analysis"
            await run_in_threadpool(lora_store.update_training, job.project_id, {
                "stage": "analysis", "phase": "Stage 1 of 2: analyzing dataset",
            })
            await prepare_runtime("analysis")
            if job.cancel_event.is_set():
                raise QueueCancelled()
            project = await run_in_threadpool(lora_store.get_project, job.project_id)
            revision = _analysis_revision(project)
            # Only cancel the task while it owns the cancellable vision call.
            # During threaded persistence/startup the shared event is checked
            # after the thread exits, so the GPU lease cannot be released early.
            active_analysis_tasks[job.request_id] = asyncio.current_task()
            try:
                analysis = await lora_vision.analyze_project(project, analysis_model)
            finally:
                active_analysis_tasks.pop(job.request_id, None)
            if job.cancel_event.is_set():
                raise QueueCancelled()
            current = await run_in_threadpool(lora_store.get_project, job.project_id)
            if _analysis_revision(current) != revision:
                raise ValueError("The dataset changed during analysis; training was not started")
            await run_in_threadpool(lora_store.save_queued_analysis, job.project_id, analysis, job.id)
            await queue.handoff(job, f"lora:{job.request_id}")
            job.stage = "training"
            await run_in_threadpool(lora_store.update_training, job.project_id, {
                "stage": "training", "phase": "Stage 2 of 2: preparing local training",
            })
        await prepare_runtime("training")
        if job.cancel_event.is_set():
            raise QueueCancelled()
        await run_in_threadpool(manager.start, job.project_id, discover_models(), job.request_id, job.cancel_event)
        # The worker process outlives /train. Retain admission until its watcher
        # has finished saving results and releasing its GPU lease.
        while await run_in_threadpool(manager.is_run_pending, job.request_id):
            await asyncio.sleep(0.3)
        training = await run_in_threadpool(lora_store.get_project, job.project_id)
        status = training.get("training") or {}
        if status.get("status") == "cancelled":
            job.cancel_event.set()
        elif status.get("status") != "completed":
            error = status.get("error") or "Training did not complete"
    except (QueueCancelled, asyncio.CancelledError):
        job.cancel_event.set()
        if await run_in_threadpool(manager.is_run_pending, job.request_id):
            try:
                await run_in_threadpool(manager.cancel, job.project_id)
            except ValueError:
                pass
            while await run_in_threadpool(manager.is_run_pending, job.request_id):
                await asyncio.sleep(0.3)
        await run_in_threadpool(lora_store.update_training, job.project_id, {"status": "cancelled", "phase": "Queue request cancelled", "error": None})
    except Exception as exc:
        error = str(exc)
        await run_in_threadpool(lora_store.update_training, job.project_id, {"status": "cancelled" if job.cancel_event.is_set() else "failed", "phase": f"{job.stage or 'Training'} stopped", "error": error})
    finally:
        queue.finish(job, error)


@router.post("/projects/{project_id}/train", status_code=202)
async def start_training(project_id: str):
    return await enqueue_training(project_id)


@router.post("/projects/{project_id}/analyze-and-train", status_code=202)
async def analyze_and_train(project_id: str):
    return await enqueue_training(project_id, analyze_first=True)


async def enqueue_training(project_id: str, analyze_first=False):
    existing = queue.find(kind="training", project_id=project_id)
    if existing:
        return (await run_in_threadpool(lora_store.get_project, project_id))["training"]
    try:
        project = await run_in_threadpool(lora_store.get_project, project_id)
        if (project.get("training") or {}).get("status") in lora_store.ACTIVE_TRAINING_STATES:
            existing = queue.find(kind="training", project_id=project_id)
            if existing:
                return project["training"]
            raise ValueError("The previous training workflow is still stopping; wait for it to finish before submitting again")
        if analyze_first and not project.get("vision_model"):
            raise ValueError("Select an installed vision analysis model before Analyze & Train")
        preflight = await run_in_threadpool(lora_store.validate_project, project, discover_models())
        if not preflight["valid"]:
            raise ValueError("; ".join(preflight["errors"]))
        # Recheck after asynchronous preflight to avoid duplicate launches.
        existing = queue.find(kind="training", project_id=project_id)
        if existing:
            return (await run_in_threadpool(lora_store.get_project, project_id))["training"]
        if queue.find(kind="analysis", project_id=project_id):
            raise ValueError("This project already has an analysis request. Finish or cancel it first.")
        run_id = uuid.uuid4().hex
        async def cancel_run():
            if _stop_analysis_task(run_id)["stopped"]:
                return
            try:
                await run_in_threadpool(manager.cancel, project_id)
            except ValueError:
                pass
        job = queue.enqueue("training", f"{project.get('name', 'LoRA')} · Analyze & Train" if analyze_first else project.get("name", "LoRA training"), run_id,
                            owner=f"lora-vision:{project_id}" if analyze_first else f"lora:{run_id}", project_id=project_id, cancel=cancel_run)
        job.stage = "analysis" if analyze_first else "training"
        try:
            saved = await run_in_threadpool(lora_store.update_training, project_id, {
                "status": "queued", "phase": "Waiting to analyze, then train" if analyze_first else "Waiting in Prompt Queue", "queue_id": job.id,
                "workflow": "analyze_train" if analyze_first else "train", "stage": job.stage,
                "error": None, "percent": 0, "step": 0, "logs": ["Training added to Prompt Queue."],
            })
        except Exception as exc:
            queue.finish(job, str(exc))
            raise
        task = asyncio.create_task(run_queued_training(job, project["vision_model"] if analyze_first else None))
        training_queue_tasks.add(task)
        task.add_done_callback(training_queue_tasks.discard)
        return saved["training"]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/projects/{project_id}/training")
def training_status(project_id: str):
    try:
        return lora_store.get_project(project_id).get("training") or {"status": "draft"}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/projects/{project_id}/cancel")
async def cancel_training(project_id: str):
    job = queue.find(kind="training", project_id=project_id)
    if job:
        await queue.cancel(job)
        # The workflow/worker owns persisted terminal state. A separate write
        # here could race its cleanup and overwrite 'cancelled' with 'cancelling'.
        return (await run_in_threadpool(lora_store.get_project, project_id))["training"]
    try:
        return await run_in_threadpool(manager.cancel, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/adapters")
def list_adapters():
    return {"adapters": lora_store.list_adapters(), "training_active": manager.is_active()}
