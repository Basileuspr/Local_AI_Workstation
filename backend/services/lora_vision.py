"""Vision-assisted, review-first preparation for local LoRA datasets."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import time
from contextlib import aclosing
from typing import Any

import httpx
from PIL import Image, ImageOps

from config import settings
from services import lora_store
from services.gpu_coordination import gpu_coordinator
from services.cpu_assistance import PreparationPool, assistance_plan, image_working_bytes, prepared_items

ANALYSIS_BATCH_SIZE = 4
MAX_IMAGE_EDGE = 768
_progress: dict[str, dict] = {}


def analysis_progress(project_id: str) -> dict | None:
    current = _progress.get(project_id)
    if current is None:
        return None
    result = dict(current)
    result["elapsed_seconds"] = round(time.monotonic() - result.pop("started"), 1)
    return result


def parse_model_content(content: str) -> dict:
    value = (content or "").strip()
    if value.startswith("```"):
        lines = value.splitlines()
        if lines and lines[0].lstrip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        value = "\n".join(lines).strip()
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("The vision model did not return valid JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("The vision model response must be a JSON object")
    return parsed


def model_message_content(message: dict) -> str:
    if not isinstance(message, dict):
        return ""
    content = str(message.get("content") or "").strip()
    if content:
        return content
    # Current Ollama/Qwen3-VL builds can put schema-constrained output in the
    # thinking field even when `think: false` was requested. This fallback is
    # parsed as JSON immediately and is never surfaced as reasoning text.
    return str(message.get("thinking") or "").strip()


def _text(value: Any, limit: int = 1000) -> str:
    return str(value or "").strip()[:limit]


def _text_list(value: Any, *, limit: int = 50) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_text(item, 500) for item in value if _text(item, 500)][:limit]


def normalize_analysis(project: dict, raw: dict, model: str) -> dict:
    project_images = project.get("images") or []
    trigger_word = _text(project.get("trigger_word"), 200)
    normalized_images = []
    seen_indices = set()
    for item in raw.get("images") or []:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index")) - 1
        except (TypeError, ValueError):
            continue
        if not 0 <= index < len(project_images) or index in seen_indices:
            continue
        seen_indices.add(index)
        caption = _text(item.get("caption"), 3800)
        if trigger_word and trigger_word.casefold() not in caption.casefold():
            caption = f"{trigger_word}, {caption}" if caption else trigger_word
        normalized_images.append({
            "image_id": project_images[index].get("id"),
            "caption_suggestion": caption[:4000],
            "analysis": {
                "view": _text(item.get("view"), 500),
                "pose_action": _text(item.get("pose_action"), 500),
                "expression": _text(item.get("expression"), 500),
                "scene": _text(item.get("scene"), 500),
                "quality_flags": _text_list(item.get("quality_flags")),
            },
        })
    warnings = _text_list(raw.get("dataset_warnings") or raw.get("warnings"))
    if len(normalized_images) < len(project_images):
        warnings.append("The vision model did not return a usable suggestion for every analyzed image.")
    return {
        "model": _text(model, 200),
        "summary": _text(raw.get("summary"), 4000),
        "stable_traits": _text_list(raw.get("stable_traits")),
        "warnings": warnings[:50],
        "images": normalized_images,
    }


async def list_vision_models() -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            models = response.json().get("models") or []
            compatible = []
            for item in models:
                name = item.get("name") or item.get("model")
                if not name:
                    continue
                details_response = await client.post(
                    f"{settings.ollama_base_url}/api/show",
                    json={"model": name},
                )
                details_response.raise_for_status()
                shown = details_response.json()
                capabilities = [str(value).lower() for value in shown.get("capabilities") or []]
                if not {"completion", "vision"}.issubset(capabilities):
                    continue
                details = item.get("details") or shown.get("details") or {}
                compatible.append({
                    "name": name,
                    "model": item.get("model") or name,
                    "size": item.get("size"),
                    "modified_at": item.get("modified_at"),
                    "family": details.get("family"),
                    "parameter_size": details.get("parameter_size"),
                    "quantization_level": details.get("quantization_level"),
                    "capabilities": capabilities,
                })
            return compatible
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        raise RuntimeError("Could not inspect local Ollama vision models") from exc


def _analysis_image(path) -> str:
    try:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=88, optimize=True)
    except Exception as exc:
        raise ValueError(f"Could not prepare training image {path.name} for analysis") from exc
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _analysis_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "stable_traits": {"type": "array", "items": {"type": "string"}},
            "dataset_warnings": {"type": "array", "items": {"type": "string"}},
            "images": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer"},
                        "caption": {"type": "string"},
                        "view": {"type": "string"},
                        "pose_action": {"type": "string"},
                        "expression": {"type": "string"},
                        "scene": {"type": "string"},
                        "quality_flags": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["index", "caption", "view", "pose_action", "expression", "scene", "quality_flags"],
                },
            },
        },
        "required": ["summary", "stable_traits", "dataset_warnings", "images"],
    }


async def analyze_project(project: dict, model: str) -> dict:
    model = _text(model, 200)
    if not model:
        raise ValueError("Select an installed Ollama vision model")
    available = await list_vision_models()
    if not any(item.get("name") == model or item.get("model") == model for item in available):
        raise ValueError("The selected Ollama model is unavailable or does not support vision")
    selected_images = list(project.get("images") or [])
    if not selected_images:
        raise ValueError("Add training images before analyzing the dataset")
    plan = assistance_plan(project.get("settings") or {})

    owner = f"lora-vision:{project['id']}"
    if not gpu_coordinator.acquire(owner):
        active_owner = gpu_coordinator.current_owner() or "another local task"
        raise ValueError(f"The GPU is currently being used by {active_owner}")
    try:
        from services.image_generation import manager as image_manager

        timings = {"vision_seconds": 0.0}
        _progress[project["id"]] = {"completed": 0, "total": len(selected_images), "batch_size": 0, "started": time.monotonic(), "timings": timings}
        image_manager.unload_for_training()

        def prepare_batch(batch):
            encoded_images = []
            filenames = []
            for item in batch:
                path = lora_store.image_path(project["id"], item.get("id", ""))
                if path is None:
                    raise ValueError("A training image is missing")
                encoded_images.append(_analysis_image(path))
                filenames.append(item.get("original_filename") or path.name)
            return batch, encoded_images, filenames

        async def analyze_batch(client, batch, encoded_images, filenames):
            _progress[project["id"]]["batch_size"] = len(batch)
            numbered_files = "\n".join(f"{index + 1}. {name}" for index, name in enumerate(filenames))
            prompt = (
                "Analyze these ordered images as a possible recurring fictional or consenting-subject character dataset. "
                "Describe only visible features. Do not identify a real person, perform face matching, or infer sensitive traits. "
                "Separate stable identity traits repeated across images from variable view, pose/action, expression, clothing details, and scene. "
                "For each image, write a concise image-training caption describing what is visible; do not include an invented name or trigger token. "
                "Flag blur, obstruction, duplicates, inconsistent identity cues, or other training-quality concerns. "
                "Return one result per image using its 1-based index and follow the supplied JSON schema exactly.\n\n"
                f"Ordered files:\n{numbered_files}"
            )
            payload = {
                "model": model,
                "stream": False,
                "think": False,
                "keep_alive": 0,
                "format": _analysis_schema(),
                "options": {"temperature": 0.1},
                "messages": [{"role": "user", "content": prompt, "images": encoded_images}],
            }
            try:
                started = time.perf_counter()
                try:
                    response = await client.post(f"{settings.ollama_base_url}/api/chat", json=payload)
                finally:
                    timings["vision_seconds"] += time.perf_counter() - started
                response.raise_for_status()
                body = response.json()
            except httpx.HTTPStatusError as exc:
                try:
                    detail = str(exc.response.json().get("error") or exc.response.reason_phrase)
                except (ValueError, AttributeError):
                    detail = exc.response.reason_phrase
                if "context" in detail.lower() and len(batch) > 1:
                    middle = len(batch) // 2
                    return await analyze_batch(client, batch[:middle], encoded_images[:middle], filenames[:middle]) + await analyze_batch(client, batch[middle:], encoded_images[middle:], filenames[middle:])
                raise RuntimeError(f"Ollama vision analysis failed (HTTP {exc.response.status_code}): {detail[:500]}") from exc
            except httpx.TimeoutException as exc:
                raise RuntimeError("Ollama vision analysis timed out while processing a batch") from exc
            except httpx.HTTPError as exc:
                raise RuntimeError("Could not communicate with Ollama during vision analysis") from exc
            content = model_message_content(body.get("message") or {}) if isinstance(body, dict) else ""
            normalized = normalize_analysis({**project, "images": batch}, parse_model_content(content), model)
            if len(normalized["images"]) != len(batch):
                if len(batch) > 1:
                    middle = len(batch) // 2
                    return await analyze_batch(client, batch[:middle], encoded_images[:middle], filenames[:middle]) + await analyze_batch(client, batch[middle:], encoded_images[middle:], filenames[middle:])
                raise RuntimeError("The vision model returned no usable result for a training image; no partial analysis was saved")
            _progress[project["id"]]["completed"] += len(batch)
            return [normalized]

        results = []
        batches = (selected_images[offset:offset + ANALYSIS_BATCH_SIZE] for offset in range(0, len(selected_images), ANALYSIS_BATCH_SIZE))
        pool = PreparationPool(batches, prepare_batch, lambda batch: sum(image_working_bytes(item, MAX_IMAGE_EDGE) for item in batch), plan)
        async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=10.0)) as client:
            async with aclosing(prepared_items(pool)) as prepared:
                async for batch, encoded, filenames in prepared:
                    _progress[project["id"]]["cpu_assistance"] = pool.snapshot()
                    results.extend(await analyze_batch(client, batch, encoded, filenames))
                    del batch, encoded, filenames
        return {
            "model": model,
            "timings": {key: round(value, 4) for key, value in timings.items()},
            "cpu_assistance": pool.snapshot(),
            "summary": "\n\n".join(f"Batch {index + 1}: {result['summary'][:max(0, 3800 // len(results) - 20)]}" for index, result in enumerate(results)),
            "batch_summaries": [result["summary"] for result in results],
            "stable_traits": list(dict.fromkeys(trait for result in results for trait in result["stable_traits"])),
            "warnings": list(dict.fromkeys(warning for result in results for warning in result["warnings"])) + (
                ["Traits and consistency checks are combined from separate batches; cross-batch identity consistency and duplicates are not verified."] if len(results) > 1 else []
            ),
            "images": [image for result in results for image in result["images"]],
        }
    finally:
        _progress.pop(project["id"], None)
        gpu_coordinator.release(owner)
