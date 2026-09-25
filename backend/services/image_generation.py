"""Local Diffusers model discovery and memory-conscious image generation."""

from __future__ import annotations

import gc
import json
import logging
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path


from config import settings
from services.gpu_coordination import gpu_coordinator

MODELS_DIR = settings.diffusers_dir
OUTPUT_DIR = settings.generated_images_dir
SUPPORTED_PIPELINES = {"StableDiffusionXLPipeline"}
LONG_PROMPT_MAX_CHUNKS = 4
_TOKENIZER_CACHE: dict[str, tuple] = {}


class ImageGenerationCancelled(RuntimeError):
    """Raised from inside Diffusers so Stop ends the upstream denoising loop."""


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _display_name(model_id: str) -> str:
    acronyms = {"sdxl": "SDXL", "nsfw": "NSFW", "wai": "WAI", "vae": "VAE"}
    words = []
    for part in model_id.replace("_", "-").split("-"):
        if not part:
            continue
        lowered = part.lower()
        if lowered in acronyms:
            words.append(acronyms[lowered])
        elif lowered.startswith("v") and lowered[1:].isdigit():
            words.append(lowered)
        else:
            words.append(part.capitalize())
    return " ".join(words)


def discover_models() -> list[dict]:
    """Find complete Diffusers folders from their native model_index.json files."""
    if not MODELS_DIR.exists():
        return []

    models = []
    for model_dir in sorted(path for path in MODELS_DIR.iterdir() if path.is_dir()):
        model_index = _read_json(model_dir / "model_index.json")
        pipeline_class = model_index.get("_class_name")
        if pipeline_class not in SUPPORTED_PIPELINES:
            continue
        models.append({
            "id": model_dir.name,
            "name": _display_name(model_dir.name),
            "path": str(model_dir),
            "pipeline": pipeline_class,
            "format": "diffusers-safetensors",
            "is_sdxl": pipeline_class == "StableDiffusionXLPipeline",
        })
    return models


def _model_tokenizers(model: dict):
    """Load only the two SDXL tokenizers; this does not load the GPU pipeline."""
    cached = _TOKENIZER_CACHE.get(model["id"])
    if cached:
        return cached
    try:
        from transformers import CLIPTokenizer
        tokenizers = (
            # local_files_only everywhere models are loaded: the LoRA worker and
            # the workflow adapters already say so, and a path that silently
            # reached the Hub would make "runs locally" depend on the weather.
            CLIPTokenizer.from_pretrained(model["path"], subfolder="tokenizer", local_files_only=True),
            CLIPTokenizer.from_pretrained(model["path"], subfolder="tokenizer_2", local_files_only=True),
        )
    except Exception as exc:
        raise ValueError("Could not load the selected model's text tokenizers") from exc
    _TOKENIZER_CACHE[model["id"]] = tokenizers
    return tokenizers


def _token_summary(tokenizers: tuple, prompt: str) -> dict:
    counts = [len(tokenizer(prompt or "", add_special_tokens=False).input_ids) for tokenizer in tokenizers]
    content_limit = max(1, min(int(tokenizer.model_max_length) - 2 for tokenizer in tokenizers))
    token_count = max(counts, default=0)
    return {
        "token_count": token_count,
        "token_counts": counts,
        "native_content_limit": content_limit,
        "chunks_required": max(1, (token_count + content_limit - 1) // content_limit),
    }


def prompt_token_status(model_id: str, prompt: str, negative_prompt: str | None = None) -> dict:
    models = {model["id"]: model for model in discover_models()}
    model = models.get(model_id)
    if not model:
        raise ValueError("Selected image model is not installed or is not supported")
    tokenizers = _model_tokenizers(model)
    positive = _token_summary(tokenizers, prompt)
    negative = _token_summary(tokenizers, negative_prompt or "")
    return {
        "prompt": positive,
        "negative_prompt": negative,
        "long_prompt_max_chunks": LONG_PROMPT_MAX_CHUNKS,
        "long_prompt_max_tokens": positive["native_content_limit"] * LONG_PROMPT_MAX_CHUNKS,
    }


class ImageGenerationManager:
    """Own one active pipeline so an 8 GB GPU never holds two SDXL models."""

    def __init__(self) -> None:
        self._pipeline = None
        self._workflow_pipelines = {}
        self._active_pipeline = None
        self._model_id: str | None = None
        self._lora_id: str | None = None
        self._compel = None
        self._offload_strategy = "model"
        self._lock = threading.Lock()
        self._cancel_state_lock = threading.Lock()
        self._progress: dict[str, dict] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._active_request_id: str | None = None

    def runtime_status(self) -> dict:
        from services.capabilities import IMAGE_PACKAGES, missing_packages
        try:
            import torch
            cuda_available = torch.cuda.is_available()
            device = torch.cuda.get_device_name(0) if cuda_available else None
        except (ImportError, OSError, RuntimeError):
            return {"ready": False, "cuda_available": False, "error":
                    "Image generation and LoRA training are unavailable: PyTorch is missing or its Windows libraries could not load. "
                    "Chat and other workspaces remain available. On a compatible NVIDIA PC, install requirements-sdxl-cuda.txt and restart."}
        missing = missing_packages(IMAGE_PACKAGES)
        return {
            "ready": cuda_available and not missing,
            "cuda_available": cuda_available,
            "device": device,
            "missing_packages": missing,
            "error": (f"Image runtime packages missing: {', '.join(missing)}. Install the image-generation requirements to enable this feature."
                      if missing and cuda_available else None) if cuda_available else (
                "Image generation and LoRA training require a supported NVIDIA GPU and CUDA-enabled PyTorch. "
                "They are unavailable on this PC. Chat can still use Ollama's available hardware, including CPU."),
            "loaded_model": self._model_id,
            "offload_strategy": self._offload_strategy if self._pipeline is not None else "automatic",
            "active_request_id": self.active_request_id(),
        }

    def _unload(self) -> None:
        if self._active_pipeline is not None and hasattr(self._active_pipeline, "remove_all_hooks"):
            self._active_pipeline.remove_all_hooks()
        self._active_pipeline = None
        self._workflow_pipelines.clear()
        self._compel = None
        if self._pipeline is not None:
            del self._pipeline
            self._pipeline = None
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass
        self._model_id = None
        self._lora_id = None
        self._compel = None

    def _load(self, model: dict) -> None:
        if self._model_id == model["id"] and self._pipeline is not None:
            return

        try:
            import torch
            from diffusers import DiffusionPipeline
        except (ImportError, OSError, RuntimeError) as exc:
            raise RuntimeError(
                "Image generation dependencies are missing. Install the image-generation requirements first."
            ) from exc

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable. This SDXL configuration requires an NVIDIA CUDA device.")

        self._unload()
        torch.backends.cuda.matmul.allow_tf32 = True
        pipeline = DiffusionPipeline.from_pretrained(
            model["path"],
            torch_dtype=torch.float16,
            use_safetensors=True,
            local_files_only=True,
        )

        # Diffusers already selects memory-efficient SDPA on modern PyTorch.
        # Slicing replaces that processor with slower, explicit attention
        # matrices. Keep slicing only for runtimes without native SDPA.
        functional = getattr(getattr(torch, "nn", None), "functional", None)
        if not hasattr(functional, "scaled_dot_product_attention"):
            pipeline.enable_attention_slicing("auto")
        # Retain model offload and VAE memory protections for 8 GB cards.
        vae = getattr(pipeline, "vae", None)
        if vae and hasattr(vae, "enable_slicing"):
            vae.enable_slicing()
        elif hasattr(pipeline, "enable_vae_slicing"):
            pipeline.enable_vae_slicing()
        if vae and hasattr(vae, "enable_tiling"):
            vae.enable_tiling()
        elif hasattr(pipeline, "enable_vae_tiling"):
            pipeline.enable_vae_tiling()
        from services.capabilities import image_offload_strategy
        try:
            self._offload_strategy = image_offload_strategy(torch.cuda.get_device_properties(0).total_memory)
        except (AttributeError, OSError, RuntimeError):
            self._offload_strategy = "model"
        self._enable_offload(pipeline)
        pipeline.set_progress_bar_config(disable=True)

        self._pipeline = pipeline
        self._active_pipeline = pipeline
        self._model_id = model["id"]
        self._lora_id = None
        self._compel = None

    def _enable_offload(self, pipeline):
        if self._offload_strategy == "sequential" and hasattr(pipeline, "enable_sequential_cpu_offload"):
            pipeline.enable_sequential_cpu_offload()
        else:
            self._offload_strategy = "model"
            pipeline.enable_model_cpu_offload()

    def _activate_pipeline(self, pipeline):
        """Shared modules need one offload hook chain, owned by the caller."""
        if self._active_pipeline is pipeline:
            return
        if self._active_pipeline is not None:
            self._active_pipeline.remove_all_hooks()
            self._active_pipeline.to("cpu")
        self._enable_offload(pipeline)
        pipeline.set_progress_bar_config(disable=True)
        self._active_pipeline = pipeline

    def workflow_pipeline(self, model, operation, context):
        from contextlib import contextmanager

        @contextmanager
        def resident():
            # The runner already holds the shared GPU lease. Serialize resets
            # and ordinary Generate calls using the existing manager lock too.
            with self._lock:
                context.check_cancelled()
                self._load(model)
                context.check_cancelled()
                if self._lora_id is not None:
                    self._activate_pipeline(self._pipeline)
                    self._set_lora(None, 1)
                if operation == "txt2img":
                    pipeline = self._pipeline
                else:
                    if operation not in self._workflow_pipelines:
                        from diffusers import StableDiffusionXLImg2ImgPipeline, StableDiffusionXLInpaintPipeline
                        cls = StableDiffusionXLInpaintPipeline if operation == "inpaint" else StableDiffusionXLImg2ImgPipeline
                        # from_pipe shares UNet, VAE, and both text encoders.
                        # No checkpoint load or tensor copies per frame.
                        # Diffusers defaults from_pipe to float32, which casts
                        # these shared weights too. Preserve each component's
                        # dtype (including any upcast VAE) instead of doubling
                        # UNet memory or copying all weights on every switch.
                        self._workflow_pipelines[operation] = cls.from_pipe(
                            self._pipeline, torch_dtype=None, add_watermarker=False)
                    pipeline = self._workflow_pipelines[operation]
                self._activate_pipeline(pipeline)
                try:
                    context.check_cancelled()
                    yield pipeline
                finally:
                    pipeline.maybe_free_model_hooks()
        return resident()

    def unload_for_training(self) -> None:
        """Release a resident offloaded pipeline before a trainer is spawned."""
        with self._lock:
            self._unload()

    def active_request_id(self) -> str | None:
        with self._cancel_state_lock:
            return self._active_request_id

    def generation_progress(self, request_id: str) -> dict | None:
        with self._cancel_state_lock:
            progress = self._progress.get(request_id)
            if progress is None:
                return None
            result = dict(progress)
        result["elapsed_seconds"] = round(time.monotonic() - result.pop("started"), 1)
        return result

    def _update_progress(self, request_id: str, **values) -> None:
        with self._cancel_state_lock:
            if request_id in self._progress:
                self._progress[request_id].update(values)

    def cancel(self, request_id: str) -> bool:
        """Signal one in-flight request; its next Diffusers step raises."""
        with self._cancel_state_lock:
            event = self._cancel_events.get(request_id)
            if event is None:
                return False
            event.set()
            return True

    def cancel_all(self) -> int:
        with self._cancel_state_lock:
            events = list(self._cancel_events.values())
        for event in events:
            event.set()
        return len(events)

    def reset_runtime(self, timeout: float = 30.0) -> bool:
        """Cancel active image work, wait for it to leave, then unload SDXL."""
        self.cancel_all()
        acquired = self._lock.acquire(timeout=timeout)
        if not acquired:
            return False
        try:
            self._unload()
            return True
        finally:
            self._lock.release()

    def _long_prompt_embeddings(self, prompt: str, negative_prompt: str | None) -> dict:
        """Encode SDXL prompts beyond CLIP's native 77-token window."""
        if self._pipeline is None:
            raise RuntimeError("Image pipeline is not loaded")
        try:
            from compel import CompelForSDXL
        except ImportError as exc:
            raise RuntimeError("Long-prompt support is unavailable; install the image-generation requirements") from exc
        if self._compel is None:
            self._compel = CompelForSDXL(self._pipeline, device="cuda")
        conditioning = self._compel(prompt, negative_prompt=negative_prompt or "")
        return {
            "prompt_embeds": conditioning.embeds,
            "pooled_prompt_embeds": conditioning.pooled_embeds,
            "negative_prompt_embeds": conditioning.negative_embeds,
            "negative_pooled_prompt_embeds": conditioning.negative_pooled_embeds,
        }

    def _set_lora(self, lora_id: str | None, scale: float) -> None:
        """Load at most one locally trained adapter into the current pipeline."""
        if self._pipeline is None:
            return
        if self._lora_id == lora_id:
            if lora_id and hasattr(self._pipeline, "set_adapters"):
                self._pipeline.set_adapters(["local-lora"], adapter_weights=[scale])
            return
        if self._lora_id and hasattr(self._pipeline, "unload_lora_weights"):
            self._pipeline.unload_lora_weights()
        self._lora_id = None
        self._workflow_pipelines.clear()
        self._compel = None
        if not lora_id:
            return
        from services.lora_store import list_adapters

        adapter = next((item for item in list_adapters() if item.get("id") == lora_id), None)
        if not adapter:
            raise ValueError("Selected LoRA adapter is not installed")
        if adapter.get("base_model_id") != self._model_id:
            raise ValueError("Selected LoRA was trained for a different base model")
        self._pipeline.load_lora_weights(adapter["path"], weight_name=adapter["filename"], adapter_name="local-lora")
        if hasattr(self._pipeline, "set_adapters"):
            self._pipeline.set_adapters(["local-lora"], adapter_weights=[scale])
        self._lora_id = lora_id

    def generate(
        self,
        model_id: str,
        prompt: str,
        negative_prompt: str | None,
        width: int,
        height: int,
        steps: int,
        guidance_scale: float,
        seed: int | None,
        lora_id: str | None = None,
        lora_scale: float = 1.0,
        long_prompt: bool = True,
        request_id: str | None = None,
        cancellation_event: threading.Event | None = None,
    ) -> dict:
        models = {model["id"]: model for model in discover_models()}
        model = models.get(model_id)
        if not model:
            raise ValueError("Selected image model is not installed or is not a supported Diffusers pipeline.")

        request_id = request_id or uuid.uuid4().hex
        lease_owner = f"image-generation:{request_id}"
        if not gpu_coordinator.acquire(lease_owner):
            owner = gpu_coordinator.current_owner() or "another local task"
            raise RuntimeError(f"Image generation is paused while {owner} owns the GPU.")
        started = time.monotonic()
        try:
            cancel_event = cancellation_event if cancellation_event is not None else threading.Event()
            with self._cancel_state_lock:
                self._cancel_events[request_id] = cancel_event
                self._active_request_id = request_id
                self._progress[request_id] = {"phase": "Loading model", "step": 0, "total_steps": steps, "started": started}
            with self._lock:
                from services.lora_training import manager as training_manager
                if training_manager.is_active():
                    raise RuntimeError("Image generation is paused while local LoRA training owns the GPU.")
                self._load(model)
                self._activate_pipeline(self._pipeline)
                if cancel_event.is_set():
                    raise ImageGenerationCancelled("Image generation stopped")
                self._set_lora(lora_id, lora_scale)
                self._update_progress(request_id, phase="Preparing prompt")
                import torch

                token_status = prompt_token_status(model_id, prompt, negative_prompt)
                needs_long_prompt = max(
                    token_status["prompt"]["chunks_required"],
                    token_status["negative_prompt"]["chunks_required"],
                ) > 1
                if long_prompt and needs_long_prompt and max(
                    token_status["prompt"]["chunks_required"], token_status["negative_prompt"]["chunks_required"]
                ) > LONG_PROMPT_MAX_CHUNKS:
                    raise ValueError(
                        f"Long prompts are limited to {token_status['long_prompt_max_tokens']} content tokens on this model. Shorten the prompt or disable long-prompt encoding."
                    )

                torch.cuda.empty_cache()
                torch.cuda.reset_peak_memory_stats()
                generator = None
                if seed is not None:
                    generator = torch.Generator(device="cuda").manual_seed(seed)

                def step_completed(_pipeline, step, _timestep, callback_kwargs):
                    self._raise_if_cancelled(cancel_event, callback_kwargs)
                    self._update_progress(request_id, step=min(step + 1, steps), phase="Decoding image" if step + 1 >= steps else "Generating image")
                    return callback_kwargs

                pipeline_args = {
                    "width": width,
                    "height": height,
                    "num_inference_steps": steps,
                    "guidance_scale": guidance_scale,
                    "generator": generator,
                    "callback_on_step_end": step_completed,
                }
                if long_prompt and needs_long_prompt:
                    pipeline_args.update(self._long_prompt_embeddings(prompt, negative_prompt))
                else:
                    pipeline_args.update(prompt=prompt, negative_prompt=negative_prompt or None)
                if cancel_event.is_set():
                    raise ImageGenerationCancelled("Image generation stopped")
                result = self._pipeline(**pipeline_args)
                if cancel_event.is_set():
                    raise ImageGenerationCancelled("Image generation stopped")
                torch.cuda.synchronize()
                peak_vram_bytes = torch.cuda.max_memory_allocated()

                OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                output_id = uuid.uuid4().hex
                filename = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{output_id[:8]}.png"
                output_path = OUTPUT_DIR / filename
                self._update_progress(request_id, phase="Saving image")
                result.images[0].save(output_path, format="PNG")

                return {
                    "id": output_id,
                    "filename": filename,
                    "model_id": model_id,
                    "width": width,
                    "height": height,
                    "seed": seed,
                    "peak_vram_bytes": peak_vram_bytes,
                    "generation_seconds": round(time.monotonic() - started, 2),
                    "long_prompt_used": bool(long_prompt and needs_long_prompt),
                    "url": f"/image-generation/outputs/{filename}",
                }
        except (MemoryError, RuntimeError) as exc:
            if not isinstance(exc, MemoryError) and "out of memory" not in str(exc).lower():
                raise
            # Drop partially loaded pipelines before releasing the GPU lease.
            # Never silently shrink the user's image or replay an expensive job.
            with self._lock:
                try:
                    self._unload()
                except Exception:
                    logging.getLogger(__name__).warning("Could not fully release image runtime after memory exhaustion", exc_info=True)
            raise RuntimeError(
                "Image generation ran out of memory on this PC. Try a smaller image, close other GPU-heavy apps, "
                "or use a smaller model. This request was not retried. If memory remains occupied, reset the idle "
                "image runtime or restart the app. Saved images and other workspaces are retained."
            ) from exc
        finally:
            with self._cancel_state_lock:
                self._cancel_events.pop(request_id, None)
                self._progress.pop(request_id, None)
                if self._active_request_id == request_id:
                    self._active_request_id = None
            gpu_coordinator.release(lease_owner)

    @staticmethod
    def _raise_if_cancelled(cancel_event: threading.Event, callback_kwargs: dict) -> dict:
        if cancel_event.is_set():
            raise ImageGenerationCancelled("Image generation stopped")
        return callback_kwargs


manager = ImageGenerationManager()
