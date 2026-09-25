"""Read-only capability discovery; never installs packages or loads model weights."""
from __future__ import annotations

import importlib.util
import os
import platform

import psutil

GIB = 1024 ** 3
IMAGE_PACKAGES = ("diffusers", "transformers", "accelerate", "safetensors", "compel")
TRAINING_PACKAGES = ("diffusers", "transformers", "accelerate", "safetensors", "peft", "datasets")


def missing_packages(names):
    missing = []
    for name in names:
        try:
            if importlib.util.find_spec(name) is None:
                missing.append(name)
        except (ImportError, ValueError, OSError):
            missing.append(name)
    return missing


def host_resources():
    try:
        memory = psutil.virtual_memory()
        total, available = memory.total, memory.available
    except (OSError, RuntimeError, psutil.Error):
        total = available = None
    return {"os": platform.system(), "architecture": platform.machine(),
            "logical_cpus": os.cpu_count() or 1,
            "memory_total_bytes": total, "memory_available_bytes": available}


def default_context_limit(total_bytes):
    # A conservative initial policy, not a claim that any particular model fits.
    if not total_bytes or total_bytes <= 16 * GIB:
        return 4096
    if total_bytes <= 32 * GIB:
        return 8192
    return 16384


def image_offload_strategy(vram_bytes):
    return "sequential" if vram_bytes and 0 < vram_bytes <= 6 * GIB else "model"


def capability(available, detail, *, device=None):
    return {"available": bool(available), "detail": detail, "device": device}


def probe_capabilities(status, context_limit):
    from services.image_generation import discover_models
    from services.faces.providers import catalog as face_catalog

    host = host_resources()
    result = {"host": host, "chat_context_limit": context_limit,
              "prefer_small_chat_model": default_context_limit(host["memory_total_bytes"]) <= 4096,
              "features": {}}
    features = result["features"]
    features["local_data"] = capability(True, "Saved chats, galleries and local editing are available.")
    ollama = status.get("ollama", {})
    models = status.get("models", {})
    features["chat"] = capability(ollama.get("reachable") and models.get("chat_count", 0) > 0,
        "Ollama manages the available CPU/GPU for chat. Model capability checks appear in the model selector."
        if ollama.get("reachable") else "Ollama is unavailable. Saved chats and other workspaces remain usable.")
    if ollama.get("reachable") and not models.get("chat_count"):
        features["chat"]["detail"] = "Ollama is running; install a chat model to enable chat."
    knowledge = status.get("knowledge_base", {})
    missing = missing_packages(("langchain_text_splitters",))
    knowledge_ready = ollama.get("reachable") and models.get("embedding_ready") and knowledge.get("ok") and not missing
    features["knowledge"] = capability(knowledge_ready,
        "Knowledge indexing and search are available." if knowledge_ready else
        knowledge.get("error") or ("Install requirements-knowledge.txt to enable text splitting." if missing else
        f"Start Ollama and install the configured embedding model: {models.get('embedding_model', 'nomic-embed-text')}."))
    image = status.get("runtime", {}).get("image", {})
    try:
        image_models = discover_models()
        model_error = None if image_models else "No compatible local SDXL model was found. Galleries and editing remain available."
    except (OSError, ValueError):
        image_models = []
        model_error = "The image model folder could not be read. Check its location and permissions."
    image_ready = image.get("ready") and bool(image_models)
    result["image_model_ids"] = sorted(model["id"] for model in image_models)
    features["image_generation"] = capability(image_ready,
        "CUDA runtime and a local SDXL model detected. Available memory still limits image size."
        if image_ready else image.get("error") or model_error or "Image runtime is unavailable.", device=image.get("device"))
    missing_training = missing_packages(TRAINING_PACKAGES)
    training_ready = image.get("cuda_available", image.get("ready")) and bool(image_models) and not missing_training
    features["training"] = capability(training_ready,
        "Training runtime detected. Each dataset still needs its own readiness check." if training_ready else
        (f"Training packages missing: {', '.join(missing_training)}. Dataset editing remains available."
         if missing_training else features["image_generation"]["detail"]), device=image.get("device"))
    try:
        providers = face_catalog()
        ready = next((item for item in providers if item.ready), None)
        features["face_detection"] = capability(ready is not None,
            ready.detail if ready else "; ".join(item.detail for item in providers) or "No face provider is available.",
            device=ready.device if ready else None)
    except Exception:
        features["face_detection"] = capability(False, "Face runtime could not be inspected. Other features remain available.")
    return result
