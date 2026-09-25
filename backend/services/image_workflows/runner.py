"""Persisted workflow runs with FIFO admission, cancellation, and reviewed output reuse."""
import asyncio
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from pathlib import Path

from services.gpu_coordination import gpu_coordinator
from services.image_generation_limits import MAX_IMAGE_STEPS
from services.request_queue import queue, QueueCancelled, prepare_runtime
from . import store, providers
from .adapters import get_providers
from .contracts import Workflow, RunRecord, PreflightReport
from .providers import PreparedStage, ExecutionContext, WorkflowCancelled

ACTIVE = {"queued", "running", "cancelling"}
provider_factory = get_providers
provider_catalog = providers.catalog


def _job_dir(workflow_id, job_id):
    if len(job_id) != 32 or any(c not in "0123456789abcdef" for c in job_id):
        raise store.NotFound("Unknown workflow run")
    return store.confined(store._directory(workflow_id) / "jobs" / job_id)


def _asset(workflow, asset_id):
    asset = next((a for a in workflow.assets if a.id == asset_id), None)
    if asset is None:
        raise ValueError("Input is not an owned snapshot asset")
    path = store.confined(store._directory(workflow.id) / "assets" / f"{asset.id}{asset.suffix}")
    data = path.read_bytes()
    from services.image_vault import require_public
    require_public(hashlib.sha256(data).hexdigest())
    decoded = store._inspect_image(asset.name, data)
    if decoded.id != asset.id or (decoded.width, decoded.height, decoded.suffix) != (asset.width, asset.height, asset.suffix):
        raise ValueError("An input image changed on disk. Upload it again before running.")
    return path


def _image_size(path):
    from PIL import Image
    with Image.open(path) as image:
        width, height = image.size
        return (height, width) if image.getexif().get(274) in {5, 6, 7, 8} else (width, height)


def preflight(workflow):
    report = store._report(workflow)
    catalog = {p["id"]: p for p in provider_catalog()["providers"]}
    sizes = {a.id: (a.width, a.height) for a in workflow.assets}
    output_sizes = {}
    def issue(code, message, stage_id=None):
        report["issues"].append({"code": code, "message": message, "stage_id": stage_id})
    for asset in workflow.assets:
        try:
            _asset(workflow, asset.id)
        except (OSError, ValueError) as exc:
            issue("asset_integrity", f"{asset.name}: {exc}")
            report["inputs_valid"] = False
    for number, stage in enumerate(workflow.stages, 1):
        provider = catalog.get(stage.provider_slot)
        if not provider or stage.operation not in provider["operations"] or not provider.get("available", True):
            issue("provider_unavailable", f"Stage {number}: choose an available provider supporting this operation.", stage.id)
        elif stage.operation != "upscale" and stage.model_id not in {m["id"] for m in provider["models"]}:
            issue("model_unavailable", f"Stage {number}: choose an installed compatible model.", stage.id)
        source_size = None
        if stage.source:
            source_size = (sizes if stage.source.kind == "asset" else output_sizes).get(stage.source.id)
        if stage.operation in {"txt2img", "img2img", "inpaint"}:
            output_sizes[stage.id] = (stage.width, stage.height)
            prompts = workflow.prompt_settings
            if not prompts.prompt.strip():
                issue("prompt_required", f"Stage {number}: enter a positive prompt.", stage.id)
            if prompts.steps > MAX_IMAGE_STEPS or (stage.operation != "txt2img" and stage.strength > 0 and int(prompts.steps * stage.strength) < 1):
                issue("steps_unsupported", f"Stage {number}: use at most {MAX_IMAGE_STEPS} steps and steps × strength ≥ 1 (or strength 0 to preserve the source).", stage.id)
            if prompts.guidance <= 1 and prompts.negative_prompt.strip():
                issue("negative_prompt_unsupported", f"Stage {number}: set guidance above 1 to use a negative prompt with SDXL.", stage.id)
            if provider and stage.provider_slot == "local-sdxl" and stage.model_id in {m["id"] for m in provider["models"]}:
                try:
                    from services.image_generation import prompt_token_status
                    tokens = prompt_token_status(stage.model_id, prompts.prompt, prompts.negative_prompt)
                    if max(tokens["prompt"]["chunks_required"], tokens["negative_prompt"]["chunks_required"]) > 4:
                        issue("prompt_too_long", f"Stage {number}: shorten the prompt to at most four CLIP chunks.", stage.id)
                except Exception as exc:
                    issue("tokenizer_unavailable", f"Stage {number}: {exc}", stage.id)
            if stage.operation == "inpaint" and source_size and stage.mask_asset_id in sizes and sizes[stage.mask_asset_id] != source_size:
                issue("mask_size_mismatch", f"Stage {number}: mask dimensions must match this stage's input dimensions.", stage.id)
        elif stage.operation == "upscale" and source_size:
            output_sizes[stage.id] = tuple(d * stage.upscale_factor for d in source_size)
            if output_sizes[stage.id][0] * output_sizes[stage.id][1] > store.MAX_IMAGE_PIXELS:
                issue("output_too_large", f"Stage {number}: resized output exceeds 24 megapixels.", stage.id)
    report["ready"] = not report["issues"]
    return PreflightReport.model_validate(report).model_dump()


def validate(workflow_id, revision):
    with store._lock:
        workflow = store.get(workflow_id)
        store._check_revision(workflow, revision)
        return preflight(workflow)


def prepare(workflow_id, revision):
    return store.prepare(workflow_id, revision, preflight)


def read_run(workflow_id, job_id):
    path = store.confined(_job_dir(workflow_id, job_id) / "run.json")
    if not path.exists():
        raise store.NotFound("No execution record for this snapshot")
    try:
        record = RunRecord.model_validate_json(path.read_bytes())
        if record.id != job_id or record.workflow_id != workflow_id:
            raise ValueError("Run identity mismatch")
        return record.model_dump()
    except (OSError, ValueError) as exc:
        raise store.Conflict("Workflow run is unreadable; its file was preserved") from exc


def _patch(workflow_id, job_id, **changes):
    with store._lock:
        record = read_run(workflow_id, job_id)
        record.update(changes, updated_at=store._now())
        record = RunRecord.model_validate(record).model_dump()
        store._write(_job_dir(workflow_id, job_id) / "run.json", record)
        return record


def list_jobs(workflow_id):
    jobs = store.list_jobs(workflow_id)
    for job in jobs:
        try:
            run = read_run(workflow_id, job["id"])
            job["status"] = run["status"]
            job["execution"] = True
        except store.NotFound:
            job["execution"] = False
    return jobs


def output_path(workflow_id, job_id, output_id):
    record = read_run(workflow_id, job_id)
    if record["status"] in ACTIVE:
        raise store.Conflict("Wait for this run to stop before reviewing outputs")
    output = next((o for o in record["outputs"] if o["id"] == output_id), None)
    if output is None:
        raise store.NotFound("Unknown workflow output")
    from services.image_vault import require_public
    require_public(output["sha256"])
    path = store.confined(_job_dir(workflow_id, job_id) / output["filename"])
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != output["sha256"]:
        raise store.Conflict("Workflow output is missing or changed on disk")
    return path, output


def accept_output(workflow_id, job_id, output_id, revision):
    with store._lock:
        workflow = store.get(workflow_id)
        store._check_revision(workflow, revision)
        path, output = output_path(workflow_id, job_id, output_id)
        known = {a.id for a in workflow.assets}
        workflow = store.add_asset(workflow_id, revision, f"Kept result {job_id[:8]}.png", path.read_bytes())
        if output["sha256"] not in known:
            asset = next(a for a in workflow.assets if a.id == output["sha256"])
            asset.origin = {"workflow_id": workflow_id, "job_id": job_id, "stage_id": output["stage_id"]}
            store._write(store._directory(workflow_id) / "workflow.json", workflow.model_dump())
        run = read_run(workflow_id, job_id)
        _patch(workflow_id, job_id, accepted_output_ids=list(dict.fromkeys([*run["accepted_output_ids"], output_id])))
        return workflow


@dataclass
class ActiveRun:
    job: object
    task: asyncio.Task | None = None


class Runner:
    def __init__(self):
        self.active = {}

    async def start(self, workflow_id, revision):
        # Each run owns an immutable snapshot and output directory. Further
        # revisions can be submitted while older runs await FIFO admission.
        marker = (workflow_id, "preparing-" + uuid.uuid4().hex)
        self.active[marker] = None
        try:
            snapshot = await asyncio.to_thread(prepare, workflow_id, revision)
            if not snapshot["preflight"]["ready"]:
                raise ValueError("Cannot run: " + " ".join(i["message"] for i in snapshot["preflight"]["issues"]))
            job_id = snapshot["id"]
            seed = snapshot["snapshot"]["prompt_settings"]["seed"]
            record = RunRecord(id=job_id, workflow_id=workflow_id, request_id=job_id, status="queued",
                               created_at=store._now(), updated_at=store._now(), seed=secrets.randbits(32) if seed == -1 else seed,
                               stage_count=len(snapshot["snapshot"]["stages"]))
            store._write(_job_dir(workflow_id, job_id) / "run.json", record.model_dump())
            job = queue.enqueue("workflow", snapshot["snapshot"]["name"], job_id, owner=f"workflow:{job_id}", project_id=workflow_id)
            active = ActiveRun(job)
            self.active[(workflow_id, job_id)] = active
            def signal():
                _patch(workflow_id, job_id, status="cancelling", phase="Stopping safely")
                if active.task:
                    active.task.cancel()
            job.cancel_callback = signal
            active.task = asyncio.create_task(self._run(snapshot, active))
            return record.model_dump()
        finally:
            self.active.pop(marker, None)

    async def _run(self, snapshot, active):
        workflow = Workflow.model_validate(snapshot["snapshot"])
        job_id, job = snapshot["id"], active.job
        failure = None
        outcome = "completed"
        outputs, stage_results, previous = [], [], {}
        try:
            await queue.wait(job)
            if not gpu_coordinator.acquire(job.owner):
                raise RuntimeError("Workflow could not acquire its reserved GPU lease")
            seed = read_run(workflow.id, job_id)["seed"]
            _patch(workflow.id, job_id, status="running", phase="Preparing inputs")
            registry = provider_factory()
            for number, stage in enumerate(workflow.stages, 1):
                if job.cancel_event.is_set():
                    raise WorkflowCancelled("Workflow stopped")
                job.stage = f"{number}/{len(workflow.stages)} · {stage.operation}"
                _patch(workflow.id, job_id, stage_number=number, phase="Preparing stage", step=0, total_steps=0)
                directory = store.confined(_job_dir(workflow.id, job_id) / "outputs" / stage.id)
                directory.mkdir(parents=True, exist_ok=True)
                source = (_asset(workflow, stage.source.id) if stage.source.kind == "asset" else previous[stage.source.id]) if stage.source else None
                request = PreparedStage(stage, workflow.prompt_settings.model_copy(update={"seed": (seed + number - 1) % 2**32}),
                    source, _asset(workflow, stage.mask_asset_id) if stage.mask_asset_id else None,
                    _asset(workflow, stage.control_asset_id) if stage.control_asset_id else None,
                    tuple(_asset(workflow, ref) for ref in stage.reference_asset_ids))
                if stage.operation == "inpaint":
                    if _image_size(source) != _image_size(request.mask):
                        raise ValueError("Mask dimensions do not match this stage's source")
                provider = registry.get(stage.provider_slot)
                if provider is None or stage.operation not in provider.operations:
                    raise ValueError("Stage provider is no longer available")
                if stage.provider_slot in {"local-sdxl", "ollama-vision"}:
                    from services.image_generation import manager as image_manager
                    from .adapters import thread_work
                    if stage.provider_slot == "ollama-vision":
                        await thread_work(lambda request, context: image_manager.unload_for_training(), None,
                                          ExecutionContext(job_id, directory, job.cancel_event))
                    await prepare_runtime("analysis" if stage.operation == "describe" else "workflow")
                context = ExecutionContext(job_id, directory, job.cancel_event,
                    lambda **values: _patch(workflow.id, job_id, **values))
                context.check_cancelled()
                result = await provider.execute(request, context)
                context.check_cancelled()
                if stage.operation == "describe":
                    if result.image_paths or not result.text or len(result.text) > 20000:
                        raise ValueError("Description provider returned an invalid text result")
                elif len(result.image_paths) != 1:
                    raise ValueError("Image provider must return exactly one image")
                for output in result.image_paths:
                    path = store.confined(Path(output))
                    if not path.is_relative_to(directory) or path.suffix != ".png":
                        raise ValueError("Provider output escaped its assigned stage directory")
                    image = store._inspect_image(path.name, path.read_bytes())
                    if stage.operation in {"txt2img", "img2img", "inpaint"}:
                        expected_size = (stage.width, stage.height)
                    else:
                        expected_size = tuple(d * stage.upscale_factor for d in _image_size(source))
                    if (image.width, image.height) != expected_size or image.suffix != ".png":
                        raise ValueError("Provider returned an image with unexpected dimensions or format")
                    outputs.append({"id": uuid.uuid4().hex, "stage_id": stage.id,
                        "filename": path.relative_to(_job_dir(workflow.id, job_id)).as_posix(), "sha256": image.id,
                        "width": image.width, "height": image.height})
                    previous[stage.id] = path
                stage_results.append({"stage_id": stage.id, "operation": stage.operation,
                    "text": result.text, "metadata": result.metadata or {}, "effective_seed": request.prompt_settings.seed})
                _patch(workflow.id, job_id, outputs=outputs, stage_results=stage_results)
            if job.cancel_event.is_set():
                raise WorkflowCancelled("Workflow stopped")
        except (WorkflowCancelled, QueueCancelled, asyncio.CancelledError):
            outcome = "cancelled"
            job.cancel_event.set()
        except Exception as exc:
            outcome, failure = "failed", str(exc)
        finally:
            try:
                _patch(workflow.id, job_id, status=outcome, phase=outcome.capitalize(), error=failure,
                       outputs=outputs, stage_results=stage_results)
            finally:
                queue.finish(job, failure)
                self.active.pop((workflow.id, job_id), None)

    async def cancel(self, workflow_id, job_id):
        record = read_run(workflow_id, job_id)
        active = self.active.get((workflow_id, job_id))
        if active and record["status"] in ACTIVE:
            await queue.cancel(active.job)
            # Queued jobs have no upstream work; their wait loop records cancellation.
            if active.job.status == "cancelled":
                _patch(workflow_id, job_id, status="cancelled", phase="Cancelled")
        return read_run(workflow_id, job_id)

    def recover(self):
        recovered = 0
        for path in store.ROOT.glob("*/jobs/*/run.json"):
            workflow_id, job_id = path.parents[2].name, path.parent.name
            try:
                record = read_run(workflow_id, job_id)
                if record["status"] in ACTIVE and (workflow_id, job_id) not in self.active:
                    _patch(workflow_id, job_id, status="interrupted", phase="Interrupted by app restart",
                           error="The backend stopped before this run finished. Committed stage results were preserved; review the snapshot before running again.")
                    recovered += 1
            except (ValueError, store.Conflict, store.NotFound):
                # Preserve unreadable records for inspection rather than silently resetting them.
                continue
        return recovered

    async def shutdown(self):
        pending = [item for item in self.active.values() if item is not None]
        for item in pending:
            await queue.cancel(item.job)
        await asyncio.gather(*(item.task for item in pending if item.task), return_exceptions=True)

    def status(self):
        return {"active_runs": [{"workflow_id": key[0], "job_id": key[1], "status": item.job.status}
                                for key, item in self.active.items() if item is not None]}


manager = Runner()
