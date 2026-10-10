"""Local Diffusers model discovery and memory-conscious image generation."""

from __future__ import annotations

import gc
import json
import logging
import secrets
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from PIL.PngImagePlugin import PngInfo


from config import settings
from services import storage_libraries as storage
from services.gpu_coordination import gpu_coordinator

MODELS_DIR = settings.diffusers_dir
OUTPUT_DIR = settings.generated_images_dir
SUPPORTED_PIPELINES = {"StableDiffusionXLPipeline", "ErnieImagePipeline"}
LONG_PROMPT_MAX_CHUNKS = 4
_TOKENIZER_CACHE: dict[str, tuple] = {}


class _ExecutionDeviceTextEncoder:
    """Compel must return embeddings to the execution device, never meta storage.

    Compel 2.x moves weighted embeddings to text_encoder.device after forward.
    Accelerate's sequential hooks have already returned the weights to meta at
    that point. Keep the real encoder and its hooks intact; only its Compel view
    reports the execution device instead of the offloaded parameter device.
    """

    def __init__(self, encoder, device):
        self._encoder = encoder
        self.device = device

    def __getattr__(self, name):
        return getattr(self._encoder, name)

    def __call__(self, *args, **kwargs):
        return self._encoder(*args, **kwargs)


class ImageGenerationCancelled(RuntimeError):
    """Raised from inside Diffusers so Stop ends the upstream denoising loop."""


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _display_name(model_id: str) -> str:
    acronyms = {"sdxl": "SDXL", "nsfw": "NSFW", "wai": "WAI", "vae": "VAE", "nf4": "NF4", "ernie": "ERNIE"}
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
            "supports_reference": pipeline_class == "StableDiffusionXLPipeline",
            "supports_long_prompt": pipeline_class == "StableDiffusionXLPipeline",
            "supports_lora_training": pipeline_class == "StableDiffusionXLPipeline",
            "dimension_multiple": 16 if pipeline_class == "ErnieImagePipeline" else 8,
            "recommended_settings": ({"steps": 8, "guidanceScale": 2, "negativePrompt": ""}
                                     if model_dir.name.lower().startswith("verboa-image-1") else None),
        })
    return models


def _model_tokenizers(model: dict):
    """Load only the two SDXL tokenizers; this does not load the GPU pipeline."""
    cached = _TOKENIZER_CACHE.get(model["id"])
    if cached:
        return cached
    try:
        from transformers import AutoTokenizer, CLIPTokenizer
        tokenizers = (AutoTokenizer.from_pretrained(
            model["path"], subfolder="tokenizer", local_files_only=True,
        ),) if model.get("pipeline") == "ErnieImagePipeline" else (
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


def _token_summary(tokenizers: tuple, prompt: str, native_limit: int | None = None) -> dict:
    counts = [len(tokenizer(prompt or "", add_special_tokens=False).input_ids) for tokenizer in tokenizers]
    content_limit = native_limit or max(1, min(int(tokenizer.model_max_length) - 2 for tokenizer in tokenizers))
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
    is_ernie = model.get("pipeline") == "ErnieImagePipeline"
    native_limit = (min(int(tokenizers[0].model_max_length), 2048)
                    - tokenizers[0].num_special_tokens_to_add(pair=False)) if is_ernie else None
    positive = _token_summary(tokenizers, prompt, native_limit)
    negative = _token_summary(tokenizers, negative_prompt or "", native_limit)
    return {
        "prompt": positive,
        "negative_prompt": negative,
        "long_prompt_supported": not is_ernie,
        "long_prompt_max_chunks": 1 if is_ernie else LONG_PROMPT_MAX_CHUNKS,
        "long_prompt_max_tokens": positive["native_content_limit"] * (1 if is_ernie else LONG_PROMPT_MAX_CHUNKS),
    }


class ImageGenerationManager:
    """Own one active pipeline so an 8 GB GPU never holds two SDXL models."""

    def __init__(self) -> None:
        self._pipeline = None
        self._workflow_pipelines = {}
        self._active_pipeline = None
        self._model_id: str | None = None
        self._pipeline_type = "StableDiffusionXLPipeline"
        self._lora_id: str | None = None
        self._lora_scale: float | None = None
        from services.image_generation_cache import PreparationCache
        self._conditioning_cache = PreparationCache()
        self._compel = None
        self._offload_strategy = "model"
        self._lock = threading.Lock()
        self._cancel_state_lock = threading.Lock()
        self._progress: dict[str, dict] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._active_request_id: str | None = None

    def runtime_status(self) -> dict:
        from services.capabilities import IMAGE_PACKAGES, missing_packages
        from services.image_generation_limits import current_resolution_limits
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
            "resolution_limits": current_resolution_limits(),
            "preparation_cache": self._preparation_cache_status(),
        }

    def _preparation_cache_status(self):
        from services.generation_reference import preparation_cache
        return {"conditioning": self._conditioning_cache.status(), "reference": preparation_cache.status()}

    def _unload(self) -> None:
        pipeline = self._active_pipeline
        had_pipeline = self._pipeline is not None or pipeline is not None
        self._active_pipeline = None
        self._workflow_pipelines.clear()
        self._compel = None
        self._pipeline = None
        self._model_id = None
        self._pipeline_type = "StableDiffusionXLPipeline"
        self._lora_id = None
        self._lora_scale = None
        self._conditioning_cache.clear()
        if pipeline is not None and hasattr(pipeline, "remove_all_hooks"):
            try:
                pipeline.remove_all_hooks()
            except Exception:
                logging.getLogger(__name__).warning("Could not detach failed image hooks", exc_info=True)
        del pipeline
        if had_pipeline:
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except (ImportError, OSError, RuntimeError):
                pass

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
        is_ernie = model.get("pipeline") == "ErnieImagePipeline"
        if is_ernie:
            from services.capabilities import missing_packages
            if _read_json(Path(model["path"]) / "transformer/config.json").get("quantization_config") and missing_packages(("bitsandbytes",)):
                raise RuntimeError("This quantized image model requires requirements-ernie.txt. Install it and restart the app.")
        torch.backends.cuda.matmul.allow_tf32 = True
        pipeline_class = DiffusionPipeline
        if is_ernie:
            from services.ernie_image import LocalErnieImagePipeline
            pipeline_class = LocalErnieImagePipeline
        pipeline = pipeline_class.from_pretrained(
            model["path"],
            torch_dtype=torch.bfloat16 if is_ernie else torch.float16,
            use_safetensors=True,
            local_files_only=True,
        )
        # Own partially configured weights too, so failures can discard hooks.
        self._pipeline = self._active_pipeline = pipeline

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
        self._pipeline_type = model.get("pipeline", "StableDiffusionXLPipeline")
        if is_ernie:
            self._offload_strategy = "mixed"
        else:
            from services.image_generation_cache import cache_sdxl_prompt_encoding
            cache_sdxl_prompt_encoding(pipeline, self._conditioning_cache)
        self._enable_offload(pipeline)
        pipeline.set_progress_bar_config(disable=True)

        self._pipeline = pipeline
        self._active_pipeline = pipeline
        self._model_id = model["id"]
        self._lora_id = None
        self._compel = None

    def _enable_offload(self, pipeline):
        if self._pipeline_type == "ErnieImagePipeline":
            self._offload_strategy = "mixed"
            pipeline.enable_model_cpu_offload()
        elif self._offload_strategy == "sequential" and hasattr(pipeline, "enable_sequential_cpu_offload"):
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

    def _configure_wait_mode(self, allow_long_wait):
        from services.capabilities import image_offload_strategy
        from services.image_generation_limits import current_resolution_limits
        desired = ("mixed" if self._pipeline_type == "ErnieImagePipeline" else
                   "sequential" if allow_long_wait else image_offload_strategy(current_resolution_limits()["vram_bytes"]))
        if desired == self._offload_strategy:
            return
        self._conditioning_cache.clear()
        self._compel = None
        # Shared workflow modules must have only one active offload hook chain.
        if self._active_pipeline is not None:
            self._active_pipeline.remove_all_hooks()
            self._active_pipeline.to("cpu")
            self._active_pipeline = None
        self._offload_strategy = desired

    def workflow_pipeline(self, model, operation, context, allow_long_wait=False):
        from contextlib import contextmanager

        @contextmanager
        def resident():
            # The runner already holds the shared GPU lease. Serialize resets
            # and ordinary Generate calls using the existing manager lock too.
            with self._lock:
                try:
                    context.check_cancelled()
                    self._load(model)
                    self._configure_wait_mode(allow_long_wait)
                    context.check_cancelled()
                    if self._lora_id is not None:
                        self._activate_pipeline(self._pipeline)
                        self._set_lora(None, 1)
                    pipeline = self._pipeline_for_operation(operation)
                    self._activate_pipeline(pipeline)
                    yield pipeline
                    pipeline.maybe_free_model_hooks()
                except BaseException:
                    self._unload()
                    raise
        return resident()

    def _pipeline_for_operation(self, operation):
        if operation == "txt2img":
            return self._pipeline
        if self._pipeline_type == "ErnieImagePipeline":
            raise ValueError("This ERNIE image model supports text-to-image only. Choose an SDXL model for reference images or inpainting.")
        if operation not in {"img2img", "inpaint"}:
            raise ValueError("Unsupported image operation")
        if operation not in self._workflow_pipelines:
            from diffusers import StableDiffusionXLImg2ImgPipeline, StableDiffusionXLInpaintPipeline
            cls = StableDiffusionXLInpaintPipeline if operation == "inpaint" else StableDiffusionXLImg2ImgPipeline
            # Share weights and preserve component dtypes; one active offload chain.
            self._workflow_pipelines[operation] = cls.from_pipe(
                self._pipeline, torch_dtype=None, add_watermarker=False)
            from services.image_generation_cache import cache_sdxl_prompt_encoding
            cache_sdxl_prompt_encoding(self._workflow_pipelines[operation], self._conditioning_cache)
        return self._workflow_pipelines[operation]

    def unload_for_training(self) -> None:
        """Release a resident offloaded pipeline before a trainer is spawned."""
        with self._lock:
            self._unload()

    def park_for_chat(self) -> None:
        """Free VRAM while retaining one SDXL model in RAM when there is room."""
        import psutil
        with self._lock:
            if self._pipeline is None:
                return
            self._compel = None  # cached conditioning can own CUDA tensors
            if self._active_pipeline is not None:
                self._active_pipeline.remove_all_hooks()
                self._active_pipeline.to("cpu")
                self._active_pipeline = None
            memory = psutil.virtual_memory()
            # Reserve RAM for Windows and Ollama loading/KV data. Low-memory
            # machines retain the previous full-unload behavior.
            if memory.available < max(8 * 1024 ** 3, memory.total // 4):
                self._unload()
            else:
                import torch
                torch.cuda.empty_cache()

    def active_request_id(self) -> str | None:
        with self._cancel_state_lock:
            return self._active_request_id

    def generation_progress(self, request_id: str) -> dict | None:
        with self._cancel_state_lock:
            progress = self._progress.get(request_id)
            if progress is None:
                return None
            result = dict(progress)
        now = time.monotonic()
        result["elapsed_seconds"] = round(now - result.pop("started"), 1)
        denoising_started = result.pop("denoising_started", None)
        step_elapsed = result.pop("step_elapsed", None)
        step, total = result.get("step", 0), result.get("total_steps", 0)
        if denoising_started is not None and step_elapsed is not None and 0 < step < total:
            # Exclude loading/prompt setup. Subtract time since the last completed step.
            estimate = step_elapsed / step * (total - step) - (now - denoising_started - step_elapsed)
            result["estimated_remaining_seconds"] = round(max(0, estimate), 1)
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
            from services.generation_reference import preparation_cache
            preparation_cache.clear()
            return True
        finally:
            self._lock.release()

    def _long_prompt_embeddings(self, prompt: str, negative_prompt: str | None) -> dict:
        """Encode SDXL prompts beyond CLIP's native 77-token window."""
        if self._pipeline is None:
            raise RuntimeError("Image pipeline is not loaded")
        from services.image_generation_cache import conditioning_key, copy_conditioning, store_conditioning
        key = conditioning_key(self._pipeline, "compel", {"prompt": prompt, "negative_prompt": negative_prompt or ""})
        cached = self._conditioning_cache.get(key, lambda value: copy_conditioning(value, "cuda"))
        if cached is not None:
            return cached
        try:
            from compel import CompelForSDXL
        except ImportError as exc:
            raise RuntimeError("Long-prompt support is unavailable; install the image-generation requirements") from exc
        if self._compel is None:
            self._compel = CompelForSDXL(self._pipeline, device="cuda")
            for compel in (self._compel.compel_1, self._compel.compel_2):
                provider = compel.conditioning_provider
                provider.text_encoder = _ExecutionDeviceTextEncoder(provider.text_encoder, "cuda")
        conditioning = self._compel(prompt, negative_prompt=negative_prompt or "")
        result = {
            "prompt_embeds": conditioning.embeds,
            "pooled_prompt_embeds": conditioning.pooled_embeds,
            "negative_prompt_embeds": conditioning.negative_embeds,
            "negative_pooled_prompt_embeds": conditioning.negative_pooled_embeds,
        }
        store_conditioning(self._conditioning_cache, key, result)
        return result

    def _set_lora(self, lora_id: str | None, scale: float) -> None:
        """Load at most one locally trained adapter into the current pipeline."""
        if self._pipeline is None:
            return
        if self._lora_id == lora_id:
            if lora_id and hasattr(self._pipeline, "set_adapters"):
                if self._lora_scale != scale:
                    self._conditioning_cache.clear()
                    self._compel = None
                self._pipeline.set_adapters(["local-lora"], adapter_weights=[scale])
                self._lora_scale = scale
            return
        self._conditioning_cache.clear()
        if self._lora_id and hasattr(self._pipeline, "unload_lora_weights"):
            self._pipeline.unload_lora_weights()
        self._lora_id = None
        self._lora_scale = None
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
        self._lora_scale = scale

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
        allow_long_wait: bool = False,
        on_gpu_complete=None,
        source_image_ref: str | None = None,
        strength: float = 0.3,
        source_fit: str = "contain",
    ) -> dict:
        from services.image_generation_limits import current_resolution_limits, validate_dimensions
        validate_dimensions(width, height, allow_long_wait, current_resolution_limits())
        models = {model["id"]: model for model in discover_models()}
        model = models.get(model_id)
        if not model:
            raise ValueError("Selected image model is not installed or is not a supported Diffusers pipeline.")
        is_ernie = model.get("pipeline") == "ErnieImagePipeline"
        if is_ernie:
            if width % 16 or height % 16:
                raise ValueError("This ERNIE image model requires width and height in multiples of 16.")
            if source_image_ref or lora_id:
                raise ValueError("This ERNIE image model supports text-to-image without local SDXL LoRAs. Remove the reference image and choose LoRA None.")

        source = None
        effective_steps = steps
        if source_image_ref:
            if not 0.05 <= strength <= 1 or int(steps * strength) < 1:
                raise ValueError("Increase Steps or Change amount to allow at least one image-to-image step.")
            from services.generation_reference import prepare_reference
            source = prepare_reference(source_image_ref, width, height, source_fit)
            effective_steps = int(steps * strength)

        request_id = request_id or uuid.uuid4().hex
        lease_owner = f"image-generation:{request_id}"
        if not gpu_coordinator.acquire(lease_owner):
            owner = gpu_coordinator.current_owner() or "another local task"
            raise RuntimeError(f"Image generation is paused while {owner} owns the GPU.")
        started = time.monotonic()
        gpu_finished = False
        try:
            cancel_event = cancellation_event if cancellation_event is not None else threading.Event()
            with self._cancel_state_lock:
                self._cancel_events[request_id] = cancel_event
                self._active_request_id = request_id
                self._progress[request_id] = {"phase": "Loading model", "step": 0, "total_steps": effective_steps, "started": started}
            with self._lock:
                from services.lora_training import manager as training_manager
                if cancel_event.is_set():
                    raise ImageGenerationCancelled("Image generation stopped")
                if training_manager.is_active():
                    raise RuntimeError("Image generation is paused while local LoRA training owns the GPU.")
                self._load(model)
                self._configure_wait_mode(allow_long_wait)
                self._activate_pipeline(self._pipeline)
                if cancel_event.is_set():
                    raise ImageGenerationCancelled("Image generation stopped")
                self._set_lora(lora_id, lora_scale)
                pipeline = self._pipeline_for_operation("img2img" if source is not None else "txt2img")
                self._activate_pipeline(pipeline)
                self._update_progress(request_id, phase="Preparing prompt")
                import torch

                token_status = prompt_token_status(model_id, prompt, negative_prompt)
                needs_long_prompt = max(
                    token_status["prompt"]["chunks_required"],
                    token_status["negative_prompt"]["chunks_required"],
                ) > 1
                if is_ernie and needs_long_prompt:
                    raise ValueError(f"This model accepts up to {token_status['long_prompt_max_tokens']} prompt tokens. Shorten the prompt or negative prompt.")
                if long_prompt and needs_long_prompt and max(
                    token_status["prompt"]["chunks_required"], token_status["negative_prompt"]["chunks_required"]
                ) > LONG_PROMPT_MAX_CHUNKS:
                    raise ValueError(
                        f"Long prompts are limited to {token_status['long_prompt_max_tokens']} content tokens on this model. Shorten the prompt or disable long-prompt encoding."
                    )

                torch.cuda.empty_cache()
                torch.cuda.reset_peak_memory_stats()
                if seed is None:
                    seed = secrets.randbelow(2_147_483_648)
                generator = torch.Generator(device="cuda").manual_seed(seed)

                def step_completed(_pipeline, step, _timestep, callback_kwargs):
                    self._raise_if_cancelled(cancel_event, callback_kwargs)
                    self._update_progress(request_id, step=min(step + 1, effective_steps), step_elapsed=time.monotonic() - denoising_started,
                                          phase="Decoding image" if step + 1 >= effective_steps else "Generating image")
                    return callback_kwargs

                pipeline_args = {
                    "width": width,
                    "height": height,
                    "num_inference_steps": steps,
                    "guidance_scale": guidance_scale,
                    "generator": generator,
                    "callback_on_step_end": step_completed,
                }
                if is_ernie:
                    pipeline_args["use_pe"] = False
                if source is not None:
                    pipeline_args.pop("width")
                    pipeline_args.pop("height")
                    pipeline_args.update(image=source, strength=strength)
                if is_ernie:
                    # Encode before starting the denoising clock. The local
                    # ERNIE runtime reuses CPU conditioning across a batch,
                    # including the usually empty negative prompt.
                    pipeline_args["prompt_embeds"] = pipeline.encode_prompt(prompt, pipeline._execution_device)
                    if cancel_event.is_set():
                        raise ImageGenerationCancelled("Image generation stopped")
                    if guidance_scale > 1:
                        pipeline_args["negative_prompt_embeds"] = pipeline.encode_prompt(
                            negative_prompt or "", pipeline._execution_device)
                elif long_prompt and needs_long_prompt:
                    pipeline_args.update(self._long_prompt_embeddings(prompt, negative_prompt))
                else:
                    pipeline_args.update(prompt=prompt, negative_prompt=negative_prompt or None)
                if cancel_event.is_set():
                    raise ImageGenerationCancelled("Image generation stopped")
                denoising_started = time.monotonic()
                self._update_progress(request_id, phase="Generating image", denoising_started=denoising_started)
                result = pipeline(**pipeline_args)
                if cancel_event.is_set():
                    raise ImageGenerationCancelled("Image generation stopped")
                torch.cuda.synchronize()
                peak_vram_bytes = torch.cuda.max_memory_allocated()
                image = result.images[0]
                scheduler = getattr(pipeline, "scheduler", None)
                scheduler_recipe = {"name": type(scheduler).__name__, "config": dict(scheduler.config)} if scheduler is not None else None
                del result, pipeline_args, generator

            # Pixels are now on CPU and no pipeline tensors are used below.
            # Let the next GPU job run while this worker encodes/saves the PNG.
            gpu_finished = True
            gpu_coordinator.release(lease_owner)
            self._update_progress(request_id, phase="Saving image")
            if on_gpu_complete is not None:
                on_gpu_complete()
            if cancel_event.is_set():
                raise ImageGenerationCancelled("Image generation stopped")
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            output_id = uuid.uuid4().hex
            filename = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{output_id[:8]}.png"
            output_path = storage.resolve(OUTPUT_DIR / filename, create=True)
            metadata = PngInfo()
            metadata.add_text("local_ai_seed", str(seed))
            recipe = dict(schema_version=1, model_id=model_id, prompt=prompt, negative_prompt=negative_prompt,
                          width=width, height=height, steps=steps, guidance_scale=guidance_scale, seed=seed,
                          lora_id=lora_id, lora_scale=lora_scale, long_prompt=long_prompt,
                          allow_long_wait=allow_long_wait, scheduler=scheduler_recipe,
                          source_image_ref=source_image_ref, strength=strength if source_image_ref else None,
                          source_fit=source_fit if source_image_ref else None)
            metadata.add_text("local_ai_generation", json.dumps(recipe, ensure_ascii=False))
            partial_path = output_path.with_suffix(".png.part")
            try:
                image.save(partial_path, format="PNG", pnginfo=metadata)
                partial_path.replace(output_path)
            finally:
                partial_path.unlink(missing_ok=True)

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
                "generation_recipe": recipe,
                "url": f"/image-generation/outputs/{filename}",
            }
        except Exception as exc:
            # Failed/cancelled calls skip Diffusers' end-of-call hook cleanup.
            # Discard that runtime before another image can reuse stale hooks.
            # CPU output failures must never touch the next job's pipeline.
            if not gpu_finished:
                with self._lock:
                    try:
                        self._unload()
                    except Exception:
                        logging.getLogger(__name__).warning("Could not fully release failed image runtime", exc_info=True)
            if not isinstance(exc, MemoryError) and "out of memory" not in str(exc).lower():
                raise
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
