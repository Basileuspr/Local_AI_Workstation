"""Persistent, local-only storage for LoRA projects and their datasets."""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import tempfile
import time
import uuid
import threading
from functools import wraps
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from config import settings
from services.app_logging import get_logger

logger = get_logger("backend.lora_store")

LORA_DIR = settings.data_dir / "lora"
PROJECTS_DIR = LORA_DIR / "projects"
ADAPTERS_DIR = LORA_DIR / "adapters"
COMPLETE_LORAS_DIR = LORA_DIR / "Complete LoRas"
RUNS_DIR = LORA_DIR / "runs"
TRAINING_LOCK_PATH = LORA_DIR / "training.lock"

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
SAFE_NAME = re.compile(r"[^a-zA-Z0-9._-]+")
TRAINING_GOALS = {"character_identity", "style"}
ACTIVE_TRAINING_STATES = {"queued", "starting", "running", "cancelling"}
_project_lock = threading.RLock()


def _serialized(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        with _project_lock:
            return function(*args, **kwargs)
    return wrapped

DEFAULT_SETTINGS = {
    "resolution": 512,
    "epochs": 10,
    "max_steps": 0,
    "batch_size": 1,
    "gradient_accumulation_steps": 4,
    "learning_rate": 0.0001,
    "rank": 8,
    "alpha": 8,
    "optimizer": "adamw",
    "precision": "fp16",
    "seed": 42,
    "save_interval": 100,
    "aspect_mode": "crop",
    "caption_prefix": "",
    "cpu_assistance": "auto",
    "preload_ram_mb": 256,
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _safe_part(value: str, fallback: str = "project") -> str:
    cleaned = SAFE_NAME.sub("-", (value or "").strip()).strip(".-")
    return cleaned[:80] or fallback


# Windows refuses to open or replace a file while the other half of an atomic
# swap still holds it, so both sides of a concurrent poll-and-save hit a sharing
# violation. Measured here, a reader failed on about one read in 700 and a
# `replace` failed far more often, silently losing training progress. The window
# is sub-millisecond, so retrying turns that contention back into an ordinary
# read or write. Torn content is not possible -- `replace` is atomic -- so a
# JSON error means real damage and is never retried away.
_READ_DELAYS = (0.01, 0.02, 0.04, 0.08)
# A write needs a moment when no reader holds the file at all, which is rarer
# than a reader finding no swap in flight. Saves are progress updates and user
# edits, never a latency-critical path, so they get a longer budget.
_WRITE_DELAYS = (0.01, 0.02, 0.04, 0.08, 0.12, 0.16, 0.2, 0.25, 0.25, 0.25)


# Retrying alone cannot help a writer when this process reads in a loop, because
# `replace` needs an instant with no reader holding the file at all. This lock
# removes that contention outright. It guards only the single read or rename --
# never a long copy, and never another lock -- so readers are not serialized
# behind work like publishing a finished package. The retry above remains the
# backstop for the training subprocess, which has no lock in common with us.
_io_lock = threading.Lock()


def _retrying(operation, delays=None):
    for delay in _READ_DELAYS if delays is None else delays:
        try:
            return operation()
        except OSError:
            time.sleep(delay)
    return operation()


def _read_text(path: Path) -> str:
    with _io_lock:
        return path.read_text(encoding="utf-8")


def _atomic_write(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".partial")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")

    def swap():
        with _io_lock:
            temporary.replace(path)

    try:
        _retrying(swap, _WRITE_DELAYS)
    except OSError:
        # Never leave a half-written sibling for the next reader, the project
        # listing, or the reset inventory to trip over.
        temporary.unlink(missing_ok=True)
        raise


def _project_path(project_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", project_id or ""):
        raise ValueError("Unknown LoRA project")
    return PROJECTS_DIR / project_id / "project.json"


def _project_dir(project_id: str) -> Path:
    return _project_path(project_id).parent


def ensure_dirs() -> None:
    for path in (PROJECTS_DIR, ADAPTERS_DIR, COMPLETE_LORAS_DIR, RUNS_DIR):
        path.mkdir(parents=True, exist_ok=True)


def _load(project_id: str) -> dict:
    path = _project_path(project_id)
    if not path.exists():
        raise ValueError("LoRA project not found")
    try:
        project = json.loads(_retrying(lambda: _read_text(path)))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("LoRA project could not be read") from exc
    if not isinstance(project, dict):
        raise ValueError("LoRA project is invalid")
    project["settings"] = {**DEFAULT_SETTINGS, **(project.get("settings") or {})}
    # Projects created before training goals existed were general-purpose style
    # projects. Keep them trainable instead of retroactively requiring an
    # identity trigger token.
    project.setdefault("training_goal", "style")
    project.setdefault("vision_model", "")
    project.setdefault("identity_analysis", None)
    project.setdefault("images", [])
    project.setdefault("training", {})
    training = project["training"]
    if training.get("status") == "queued":
        from services.request_queue import queue
        if not training.get("queue_id") or not queue.find(job_id=training["queue_id"]):
            project["training"] = {**training, "status": "interrupted", "phase": "Queue ended when the backend restarted", "error": "Submit training again to start a new queue request."}
    return project


def _save(project: dict) -> dict:
    project["updated_at"] = _now()
    _atomic_write(_project_path(project["id"]), project)
    return project


def _ensure_training_mutable(project: dict) -> None:
    from services.request_queue import queue
    if ((project.get("training") or {}).get("status") in ACTIVE_TRAINING_STATES
            or queue.find(kind="training", project_id=project["id"])):
        raise ValueError("Project settings and training images cannot change while training is active")


def _mark_analysis_stale(project: dict) -> None:
    analysis = project.get("identity_analysis")
    if isinstance(analysis, dict) and analysis.get("status") != "stale":
        analysis["status"] = "stale"
        analysis["stale_at"] = _now()


def _summary(project: dict) -> dict:
    return {
        "id": project["id"],
        "name": project.get("name", "Untitled LoRA"),
        "description": project.get("description", ""),
        "trigger_word": project.get("trigger_word", ""),
        "training_goal": project.get("training_goal", "style"),
        "base_model_id": project.get("base_model_id", ""),
        "vision_model": project.get("vision_model", ""),
        "analysis_status": (project.get("identity_analysis") or {}).get("status", "not_analyzed"),
        "image_count": len(project.get("images") or []),
        "updated_at": project.get("updated_at", ""),
        "status": (project.get("training") or {}).get("status", "draft"),
        "adapter": project.get("adapter"),
    }


def list_projects() -> list[dict]:
    if not PROJECTS_DIR.exists():
        return []
    projects = []
    for path in PROJECTS_DIR.glob("*/project.json"):
        try:
            projects.append(_summary(_load(path.parent.name)))
        except ValueError:
            logger.warning("Skipping unreadable LoRA project %s", path)
    return sorted(projects, key=lambda item: item.get("updated_at", ""), reverse=True)


def get_project(project_id: str) -> dict:
    return _load(project_id)


@_serialized
def create_project(
    name: str,
    description: str = "",
    trigger_word: str = "",
    base_model_id: str = "",
    output_location: str = "",
    training_goal: str = "character_identity",
    vision_model: str = "",
) -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("A LoRA name is required")
    if training_goal not in TRAINING_GOALS:
        raise ValueError("Training goal must be character identity or style")
    ensure_dirs()
    project_id = uuid.uuid4().hex
    project_dir = _project_dir(project_id)
    project_dir.mkdir(parents=True, exist_ok=False)
    (project_dir / "dataset" / "originals").mkdir(parents=True)
    now = _now()
    project = {
        "id": project_id,
        "name": name[:120],
        "description": (description or "").strip()[:2000],
        "trigger_word": (trigger_word or "").strip()[:200],
        "training_goal": training_goal,
        "base_model_id": (base_model_id or "").strip(),
        "vision_model": (vision_model or "").strip()[:200],
        "output_location": _safe_part(output_location or name, "adapter"),
        "created_at": now,
        "updated_at": now,
        "settings": dict(DEFAULT_SETTINGS),
        "images": [],
        "training": {"status": "draft", "logs": []},
        "adapter": None,
    }
    return _save(project)


@_serialized
def update_project(project_id: str, changes: dict) -> dict:
    project = _load(project_id)
    _ensure_training_mutable(project)
    analysis_inputs_changed = False
    for key in ("name", "description", "trigger_word", "training_goal", "base_model_id", "vision_model", "output_location"):
        if key not in changes:
            continue
        value = changes[key]
        if key == "name":
            value = (value or "").strip()
            if not value:
                raise ValueError("A LoRA name is required")
            project[key] = value[:120]
        elif key == "output_location":
            project[key] = _safe_part(value or project.get("name", "adapter"), "adapter")
        elif key == "training_goal":
            if value not in TRAINING_GOALS:
                raise ValueError("Training goal must be character identity or style")
            if project.get(key) != value:
                analysis_inputs_changed = True
            project[key] = value
        else:
            normalized = (value or "").strip()[:2000]
            if key in {"trigger_word", "vision_model"} and project.get(key, "") != normalized:
                analysis_inputs_changed = True
            project[key] = normalized

    if "settings" in changes:
        supplied = changes["settings"] or {}
        if not isinstance(supplied, dict):
            raise ValueError("Training settings must be an object")
        project["settings"] = {**DEFAULT_SETTINGS, **supplied}
        from services.cpu_assistance import validate_settings
        validate_settings(project["settings"])
    if analysis_inputs_changed:
        _mark_analysis_stale(project)
    return _save(project)


def _image_metadata(data: bytes, filename: str) -> tuple[str, int, int, str]:
    digest = hashlib.sha256(data).hexdigest()
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            media = Image.MIME.get(image.format, "image/unknown")
    except Exception as exc:
        raise ValueError(f"{filename} is not a readable image") from exc
    if width < 64 or height < 64:
        raise ValueError(f"{filename} is too small for training")
    return digest, width, height, media


@_serialized
def add_images(project_id: str, files: list[tuple[str, bytes]]) -> dict:
    project = _load(project_id)
    _ensure_training_mutable(project)
    dataset_dir = _project_dir(project_id) / "dataset" / "originals"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    existing = {image.get("sha256") for image in project["images"]}
    added, skipped, errors = [], [], []
    for filename, data in files:
        suffix = Path(filename or "").suffix.lower()
        if suffix not in IMAGE_SUFFIXES:
            errors.append(f"{filename or 'Unnamed file'}: supported formats are PNG, JPG, and WebP")
            continue
        try:
            digest, width, height, media = _image_metadata(data, filename)
        except ValueError as exc:
            errors.append(str(exc))
            continue
        if digest in existing:
            skipped.append(filename)
            continue
        image_id = uuid.uuid4().hex
        stored_name = f"{image_id}{suffix}"
        path = dataset_dir / stored_name
        temporary = path.with_suffix(path.suffix + ".partial")
        temporary.write_bytes(data)
        temporary.replace(path)
        caption = " ".join(part for part in [project.get("trigger_word", ""), project.get("settings", {}).get("caption_prefix", "")] if part).strip()
        image = {
            "id": image_id,
            "original_filename": Path(filename).name,
            "filename": stored_name,
            "sha256": digest,
            "width": width,
            "height": height,
            "media_type": media,
            "caption": caption,
            "caption_source": "default",
            "added_at": _now(),
        }
        project["images"].append(image)
        existing.add(digest)
        added.append(image)
    if added:
        _mark_analysis_stale(project)
    _save(project)
    return {"project": project, "added": added, "skipped": skipped, "errors": errors}


@_serialized
def update_image_caption(project_id: str, image_id: str, caption: str) -> dict:
    project = _load(project_id)
    _ensure_training_mutable(project)
    image = next((item for item in project["images"] if item.get("id") == image_id), None)
    if not image:
        raise ValueError("Training image not found")
    image["caption"] = (caption or "").strip()[:4000]
    image["caption_source"] = "manual"
    return _save(project)


@_serialized
def remove_image(project_id: str, image_id: str) -> dict:
    project = _load(project_id)
    _ensure_training_mutable(project)
    image = next((item for item in project["images"] if item.get("id") == image_id), None)
    if not image:
        raise ValueError("Training image not found")
    path = _project_dir(project_id) / "dataset" / "originals" / image.get("filename", "")
    if path.is_file():
        path.unlink()
    project["images"] = [item for item in project["images"] if item.get("id") != image_id]
    _mark_analysis_stale(project)
    return _save(project)


@_serialized
def clear_images(project_id: str) -> dict:
    project = _load(project_id)
    _ensure_training_mutable(project)
    dataset_dir = _project_dir(project_id) / "dataset" / "originals"
    if dataset_dir.exists():
        shutil.rmtree(dataset_dir)
    dataset_dir.mkdir(parents=True, exist_ok=True)
    project["images"] = []
    _mark_analysis_stale(project)
    return _save(project)


@_serialized
def save_identity_analysis(project_id: str, analysis: dict) -> dict:
    project = _load(project_id)
    _ensure_training_mutable(project)
    return _save(_set_identity_analysis(project, analysis))


def _set_identity_analysis(project: dict, analysis: dict) -> dict:
    if not isinstance(analysis, dict):
        raise ValueError("Identity analysis must be an object")
    results = analysis.get("images")
    if not isinstance(results, list) or not results:
        raise ValueError("Identity analysis did not return any image suggestions")

    project_images = {item.get("id"): item for item in project.get("images") or []}
    for image in project_images.values():
        image.pop("analysis", None)
        image.pop("caption_suggestion", None)

    saved_count = 0
    for result in results:
        if not isinstance(result, dict):
            continue
        image = project_images.get(result.get("image_id"))
        suggestion = str(result.get("caption_suggestion") or "").strip()[:4000]
        if image is None or not suggestion:
            continue
        image["caption_suggestion"] = suggestion
        image_analysis = result.get("analysis")
        image["analysis"] = image_analysis if isinstance(image_analysis, dict) else {}
        saved_count += 1

    if not saved_count:
        raise ValueError("Identity analysis did not match any current training images")

    project["vision_model"] = str(analysis.get("model") or project.get("vision_model") or "").strip()[:200]
    stable_traits = analysis.get("stable_traits")
    warnings = analysis.get("warnings")
    project["identity_analysis"] = {
        "status": "ready",
        "model": project["vision_model"],
        "summary": str(analysis.get("summary") or "").strip()[:4000],
        "batch_summaries": [str(item)[:4000] for item in analysis.get("batch_summaries", [])] if isinstance(analysis.get("batch_summaries"), list) else [],
        "stable_traits": [str(item).strip()[:500] for item in stable_traits if str(item).strip()][:50] if isinstance(stable_traits, list) else [],
        "warnings": [str(item).strip()[:500] for item in warnings if str(item).strip()][:50] if isinstance(warnings, list) else [],
        "analyzed_at": _now(),
        "analyzed_image_count": saved_count,
        "timings": analysis.get("timings") or {},
        "cpu_assistance": analysis.get("cpu_assistance") or {},
    }
    return project


@_serialized
def save_queued_analysis(project_id: str, analysis: dict, queue_id: str) -> dict:
    """Apply a complete result only for the workflow which locked this project."""
    from services.request_queue import queue
    project = _load(project_id)
    training = project.get("training") or {}
    job = queue.find(job_id=queue_id)
    if (training.get("queue_id") != queue_id or training.get("workflow") != "analyze_train"
            or job is None or job.project_id != project_id or job.status != "running" or job.cancel_event.is_set()):
        raise ValueError("The analysis and training workflow is no longer active")
    results = analysis.get("images") if isinstance(analysis, dict) else None
    expected = {item["id"] for item in project["images"]}
    if (not isinstance(results, list) or len(results) != len(expected) or not expected
            or any(not isinstance(item, dict) or not str(item.get("caption_suggestion") or "").strip() for item in results)
            or {item.get("image_id") for item in results} != expected):
        raise ValueError("Analysis must return one caption for every current image before training can begin")
    project = _set_identity_analysis(project, analysis)
    for image in project["images"]:
        if not image.get("caption", "").strip() or image.get("caption_source") == "default":
            image["caption"] = image["caption_suggestion"]
            image["caption_source"] = "vision_suggestion"
    return _save(project)


@_serialized
def apply_caption_suggestions(project_id: str, image_ids: list[str] | None = None) -> dict:
    project = _load(project_id)
    _ensure_training_mutable(project)
    if (project.get("identity_analysis") or {}).get("status") != "ready":
        raise ValueError("Identity analysis is stale; analyze the current dataset again")
    selected = set(image_ids) if image_ids is not None else None
    for image in project.get("images") or []:
        if selected is not None and image.get("id") not in selected:
            continue
        suggestion = str(image.get("caption_suggestion") or "").strip()
        if suggestion:
            image["caption"] = suggestion[:4000]
            image["caption_source"] = "vision_suggestion"
    return _save(project)


def image_path(project_id: str, image_id: str) -> Path | None:
    project = _load(project_id)
    image = next((item for item in project["images"] if item.get("id") == image_id), None)
    if not image:
        return None
    path = _project_dir(project_id) / "dataset" / "originals" / image.get("filename", "")
    if path.is_file():
        from services.image_vault import guard_path
        guard_path(path)
    return path if path.is_file() else None


def _as_int(settings_value: object, name: str, low: int, high: int) -> int:
    try:
        value = int(settings_value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a whole number") from exc
    if not low <= value <= high:
        raise ValueError(f"{name} must be between {low} and {high}")
    return value


def training_images(project: dict) -> list[dict]:
    """Optional non-destructive subset; originals remain in the editable project."""
    images = project.get("images") or []
    selected = (project.get("settings") or {}).get("training_image_ids")
    if selected is None:
        return images
    if not isinstance(selected, list) or not selected or not all(isinstance(item, str) for item in selected):
        raise ValueError("Training image selection must be a nonempty list of image IDs")
    if len(set(selected)) != len(selected) or not set(selected) <= {item["id"] for item in images}:
        raise ValueError("Training image selection contains duplicate or missing images")
    return [item for item in images if item["id"] in selected]


def validate_project(project: dict, models: list[dict]) -> dict:
    errors, warnings = [], []
    try:
        selected = training_images(project)
        if len(selected) != len(project.get("images") or []):
            warnings.append(f"Using {len(selected)} selected training images; all originals are retained in this project.")
        project = {**project, "images": selected}
    except ValueError as exc:
        errors.append(str(exc))
    settings_value = {**DEFAULT_SETTINGS, **(project.get("settings") or {})}
    from services.cpu_assistance import validate_settings
    try:
        validate_settings(settings_value)
    except ValueError as exc:
        errors.append(str(exc))
    training_goal = project.get("training_goal") or "style"
    if not (project.get("name") or "").strip():
        errors.append("A LoRA name is required")
    if training_goal not in TRAINING_GOALS:
        errors.append("Training goal must be character identity or style")
    if training_goal == "character_identity" and not (project.get("trigger_word") or "").strip():
        errors.append("Character identity training requires a unique trigger token")
    selected = next((model for model in models if model.get("id") == project.get("base_model_id")), None)
    if not selected:
        errors.append("Select an installed SDXL base model")
    if not project.get("images"):
        errors.append("Add at least one training image")
    elif training_goal == "character_identity" and len(project["images"]) < 8:
        warnings.append(
            f"Character likeness usually benefits from 8-20 varied images; this dataset has {len(project['images'])}. "
            "Include consistent facial and body features across different angles, expressions, and actions."
        )
    blank_captions = sum(1 for image in project.get("images") or [] if not (image.get("caption") or "").strip())
    if blank_captions:
        warnings.append(f"{blank_captions} training image(s) have no caption or trigger token")
    try:
        resolution = _as_int(settings_value.get("resolution"), "Training resolution", 256, 1024)
        if resolution % 64:
            errors.append("Training resolution must be a multiple of 64")
        epochs = _as_int(settings_value.get("epochs"), "Epochs", 1, 1000)
        batch = _as_int(settings_value.get("batch_size"), "Batch size", 1, 32)
        _as_int(settings_value.get("rank"), "Network rank", 1, 256)
        _as_int(settings_value.get("alpha"), "Network alpha", 1, 256)
        _as_int(settings_value.get("save_interval"), "Save interval", 1, 100000)
        learning_rate = float(settings_value.get("learning_rate"))
        if not 0 < learning_rate <= 1:
            errors.append("Learning rate must be greater than 0 and at most 1")
        if settings_value.get("precision") not in {"fp16", "bf16", "fp32"}:
            errors.append("Precision must be fp16, bf16, or fp32")
        if settings_value.get("optimizer") != "adamw":
            errors.append("The first local trainer supports AdamW")
        if settings_value.get("aspect_mode") not in {"crop", "pad"}:
            errors.append("Aspect handling must be crop or pad")
        estimated_steps = int(settings_value.get("max_steps") or 0) or max(1, (len(project.get("images") or []) * epochs + batch - 1) // batch)
    except ValueError as exc:
        errors.append(str(exc))
        resolution, batch, estimated_steps = 512, 1, 0

    hardware = hardware_status()
    # The old all-models-resident formula does not describe staged RAM offload.
    # Report measurements from the worker instead of inventing an offload estimate.
    estimate_gib = None
    if not hardware.get("cuda_available"):
        errors.append(hardware.get("error") or "CUDA is required for this local SDXL trainer")
    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "estimated_steps": estimated_steps,
        "estimated_vram_gib": estimate_gib,
        "memory_strategy": "Cached encoders + RAM activation offload",
        "hardware": hardware,
        "dataset_count": len(project.get("images") or []),
        "training_goal": training_goal,
        "base_model": selected,
    }


def hardware_status() -> dict:
    try:
        import torch
    except ImportError:
        return {"cuda_available": False, "error": "PyTorch is not installed"}
    if not torch.cuda.is_available():
        return {"cuda_available": False, "error": "CUDA is unavailable"}
    free, total = torch.cuda.mem_get_info(0)
    return {
        "cuda_available": True,
        "device": torch.cuda.get_device_name(0),
        "available_vram_gib": round(free / 1024**3, 2),
        "total_vram_gib": round(total / 1024**3, 2),
    }


@_serialized
def update_training(project_id: str, training: dict) -> dict:
    project = _load(project_id)
    project["training"] = {**(project.get("training") or {}), **training}
    return _save(project)


@_serialized
def register_adapter(project_id: str, adapter: dict) -> dict:
    project = _load(project_id)
    project["adapter"] = adapter
    project["training"] = {**(project.get("training") or {}), "status": "completed", "completed_at": _now()}
    return _save(project)


@_serialized
def publish_completion(
    project_id: str,
    *,
    run_id: str,
    adapter_id: str,
    model_source: Path,
    weights_source: Path | None = None,
    training_seconds: float = 0,
) -> dict:
    """Atomically publish one self-contained, reproducible LoRA package.

    The editable project remains in ``projects/``. A successful run snapshots
    its training images, captions, settings, checkpoints, and final adapter into
    one folder under ``Complete LoRas/``. Consumers still receive the model
    subfolder as ``adapter.path``, so inference does not need to understand the
    archival layout.
    """
    project = _load(project_id)
    if not re.fullmatch(r"[a-f0-9]{32}", adapter_id or ""):
        raise ValueError("Completed adapter id is invalid")
    model_source = Path(model_source)
    weights_source = Path(weights_source) if weights_source else None
    if not (model_source / "adapter.safetensors").is_file():
        raise ValueError("Completed adapter weights are missing")

    ensure_dirs()
    folder_name = f"{_safe_part(project.get('output_location') or project.get('name'), 'adapter')}-{adapter_id[:8]}"
    complete_dir = COMPLETE_LORAS_DIR / folder_name
    if complete_dir.exists():
        raise ValueError("This completed LoRA folder already exists")
    temporary = Path(tempfile.mkdtemp(prefix=f".{folder_name}-", suffix=".partial", dir=COMPLETE_LORAS_DIR))

    try:
        model_dir = temporary / "model"
        weights_dir = temporary / "weights"
        images_dir = temporary / "training-images"
        captions_dir = temporary / "captions"
        shutil.copytree(model_source, model_dir)
        weights_dir.mkdir()
        if weights_source and weights_source.is_dir():
            shutil.copytree(weights_source, weights_dir, dirs_exist_ok=True)
        images_dir.mkdir()
        captions_dir.mkdir()

        dataset_items = []
        project_images_dir = _project_dir(project_id) / "dataset" / "originals"
        for image in training_images(project):
            filename = Path(image.get("filename") or "").name
            source = project_images_dir / filename
            if not filename or not source.is_file():
                raise ValueError(f"Training image {image.get('original_filename') or image.get('id')} is missing")
            shutil.copy2(source, images_dir / filename)
            caption_filename = f"{Path(filename).stem}.txt"
            (captions_dir / caption_filename).write_text((image.get("caption") or "").strip(), encoding="utf-8")
            dataset_items.append({
                **image,
                "training_image": f"training-images/{filename}",
                "caption_file": f"captions/{caption_filename}",
            })

        created_at = _now()
        final_model_dir = complete_dir / "model"
        adapter = {
            "id": adapter_id,
            "name": project.get("output_location") or project["name"],
            "filename": "adapter.safetensors",
            "trigger_word": project.get("trigger_word", ""),
            "training_goal": project.get("training_goal", "style"),
            "base_model_id": project.get("base_model_id", ""),
            "project_id": project["id"],
            "run_id": run_id,
            "created_at": created_at,
            "settings": {**DEFAULT_SETTINGS, **(project.get("settings") or {})},
            "dataset_count": len(dataset_items),
            "path": str(final_model_dir),
            "complete_path": str(complete_dir),
            "weights_path": str(complete_dir / "weights"),
            "training_images_path": str(complete_dir / "training-images"),
        }
        (model_dir / "adapter.json").write_text(json.dumps(adapter, indent=2, ensure_ascii=False), encoding="utf-8")
        (temporary / "dataset.json").write_text(json.dumps({
            "schema_version": 1,
            "image_count": len(dataset_items),
            "images": dataset_items,
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        project_snapshot = {
            **project,
            "images": training_images(project),
            "adapter": adapter,
            "training": {
                **(project.get("training") or {}),
                "status": "completed",
                "completed_at": created_at,
                "run_id": run_id,
            },
        }
        (temporary / "project.json").write_text(json.dumps(project_snapshot, indent=2, ensure_ascii=False), encoding="utf-8")
        (temporary / "completion.json").write_text(json.dumps({
            "schema_version": 1,
            "adapter": adapter,
            "completed_at": created_at,
            "training_seconds": training_seconds,
            "memory_strategy": "cached-encoders-ram-activations-v1",
            "layout": {
                "model": "model/",
                "weights": "weights/",
                "training_images": "training-images/",
                "captions": "captions/",
                "dataset_manifest": "dataset.json",
                "project_snapshot": "project.json",
            },
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        temporary.replace(complete_dir)
        return adapter
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def list_adapters() -> list[dict]:
    adapters = []
    seen = set()
    manifest_paths = []
    if COMPLETE_LORAS_DIR.exists():
        manifest_paths.extend(COMPLETE_LORAS_DIR.glob("*/model/adapter.json"))
    if ADAPTERS_DIR.exists():
        manifest_paths.extend(ADAPTERS_DIR.glob("*/adapter.json"))
    for manifest_path in manifest_paths:
        try:
            adapter = json.loads(manifest_path.read_text(encoding="utf-8"))
            # Older packages used the project name in adapter.json even when
            # the user chose another output name. Read the immutable run
            # snapshot, never the current editable project's name.
            snapshot_path = manifest_path.parent.parent / "project.json"
            if manifest_path.parent.name == "model" and snapshot_path.is_file():
                try:
                    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
                    saved_name = snapshot.get("output_location")
                    if isinstance(saved_name, str) and saved_name.strip():
                        adapter["name"] = saved_name.strip()
                except (OSError, ValueError, AttributeError):
                    logger.warning("Could not read saved LoRA name from %s", snapshot_path)
            file_path = manifest_path.parent / adapter.get("filename", "")
            adapter_id = adapter.get("id")
            if file_path.is_file() and adapter_id not in seen:
                seen.add(adapter_id)
                adapters.append({**adapter, "path": str(manifest_path.parent)})
        except (OSError, json.JSONDecodeError):
            logger.warning("Skipping unreadable LoRA adapter manifest %s", manifest_path)
    return sorted(adapters, key=lambda item: item.get("created_at", ""), reverse=True)
