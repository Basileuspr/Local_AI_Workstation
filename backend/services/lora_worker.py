"""One-process local SDXL LoRA trainer, launched by ``lora_training``.

The worker deliberately owns the GPU for the life of a run. It writes progress
records to stdout; the parent process persists those records for the UI.
Completed adapters are written to a temporary run directory first and then
published as one atomic package containing the model, checkpoints, training
images, captions, and manifests. Cancellation cannot expose a partial package.
"""

from __future__ import annotations

import argparse
import gc
import tempfile
import json
import math
import os
import random
import sys
import time
import threading
import uuid
from pathlib import Path
from services.cpu_assistance import PreparationPool, assistance_plan, image_working_bytes


def emit(kind: str, **payload) -> None:
    print(json.dumps({"type": kind, **payload}), flush=True)


def _load_project(project_path: Path) -> dict:
    return json.loads(project_path.read_text(encoding="utf-8"))


def _prepare_image(path: Path, resolution: int, aspect_mode: str):
    from PIL import Image, ImageOps
    import torch

    with Image.open(path) as source:
        image = source.convert("RGB")
    original_size = (image.height, image.width)
    if aspect_mode == "pad":
        fitted = ImageOps.contain(image, (resolution, resolution), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (resolution, resolution), color=(0, 0, 0))
        canvas.paste(fitted, ((resolution - fitted.width) // 2, (resolution - fitted.height) // 2))
        image = canvas
    else:
        image = ImageOps.fit(image, (resolution, resolution), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    values = torch.from_numpy(__import__("numpy").array(image)).permute(2, 0, 1).float() / 127.5 - 1
    return values, original_size


def _tokenize(tokenizer, captions, device):
    return tokenizer(
        captions,
        max_length=tokenizer.model_max_length,
        padding="max_length",
        truncation=True,
        return_tensors="pt",
    ).input_ids.to(device)


def memory_snapshot() -> dict:
    import torch
    free, total = torch.cuda.mem_get_info()
    return {
        "free_gib": round(free / 1024**3, 2),
        "total_gib": round(total / 1024**3, 2),
        "allocated_gib": round(torch.cuda.memory_allocated() / 1024**3, 2),
        "peak_gib": round(torch.cuda.max_memory_allocated() / 1024**3, 2),
    }


def _cache_examples(examples, image_root, project, values, base_path, cache_root, device, weight_dtype, plan):
    """Preload bounded CPU images while the main thread encodes on the GPU."""
    import torch
    from diffusers import AutoencoderKL
    from transformers import CLIPTextModel, CLIPTextModelWithProjection, CLIPTokenizer

    tokenizer_one = CLIPTokenizer.from_pretrained(base_path, subfolder="tokenizer", local_files_only=True)
    tokenizer_two = CLIPTokenizer.from_pretrained(base_path, subfolder="tokenizer_2", local_files_only=True)
    text_one = CLIPTextModel.from_pretrained(base_path, subfolder="text_encoder", torch_dtype=weight_dtype, local_files_only=True).to(device)
    text_two = CLIPTextModelWithProjection.from_pretrained(base_path, subfolder="text_encoder_2", torch_dtype=weight_dtype, local_files_only=True).to(device)
    # SDXL VAE encoding needs FP32 to avoid overflowing FP16 latents.
    vae = AutoencoderKL.from_pretrained(base_path, subfolder="vae", torch_dtype=torch.float32, local_files_only=True).to(device)
    vae.enable_tiling()
    for model in (text_one, text_two, vae):
        model.requires_grad_(False)
        model.eval()
    try:
        def prepare(item):
            return item, _prepare_image(image_root / item["filename"], int(values["resolution"]), values.get("aspect_mode", "crop"))
        with PreparationPool(examples, prepare, lambda item: image_working_bytes(item, int(values["resolution"])), plan) as pool, torch.no_grad():
            for index, (item, (pixels, _)) in enumerate(pool):
                caption = (item.get("caption") or project.get("trigger_word") or "").strip()
                one = text_one(_tokenize(tokenizer_one, [caption], device), output_hidden_states=True)
                two = text_two(_tokenize(tokenizer_two, [caption], device), output_hidden_states=True)
                posterior = vae.encode(pixels.unsqueeze(0).to(device=device, dtype=torch.float32)).latent_dist
                cached = {
                    "prompt": torch.cat([one.hidden_states[-2], two.hidden_states[-2]], dim=-1).cpu(),
                    "pooled": two[0].cpu(),
                    "mean": posterior.mean.cpu(),
                    "std": posterior.std.cpu(),
                    "scaling_factor": float(vae.config.scaling_factor),
                }
                if not all(torch.isfinite(t).all() for t in cached.values() if isinstance(t, torch.Tensor)):
                    raise RuntimeError("Non-finite image or caption encoding; training stopped before updating weights")
                torch.save(cached, cache_root / f"{index}.pt")
                item["cache_index"] = index
                del one, two, pixels, posterior, cached
                emit("progress", status="starting", phase="Preparing images and captions", prepared=index + 1, dataset_count=len(examples), memory=memory_snapshot(), cpu_assistance=pool.snapshot())
        return pool.snapshot()
    finally:
        del text_one, text_two, vae
        gc.collect()
        torch.cuda.empty_cache()


def _load_cached_records(batch, cache_root):
    import torch
    return [torch.load(cache_root / f"{item['cache_index']}.pt", weights_only=True, map_location="cpu") for item in batch]


def _batch_from_records(records, device, weight_dtype):
    import torch
    # Sampling stays on the consuming thread, preserving seeded RNG order.
    latents = torch.cat([(r["mean"] + r["std"] * torch.randn_like(r["std"])) * r["scaling_factor"] for r in records])
    return (
        latents.to(device=device, dtype=weight_dtype),
        torch.cat([r["prompt"] for r in records]).to(device=device, dtype=weight_dtype),
        torch.cat([r["pooled"] for r in records]).to(device=device, dtype=weight_dtype),
    )


def _cached_batch(batch, cache_root, device, weight_dtype):
    return _batch_from_records(_load_cached_records(batch, cache_root), device, weight_dtype)


def train(project_path: Path, run_id: str) -> None:
    from services import lora_store
    deadline = (_load_project(project_path).get("settings") or {}).get("training_deadline_unix")
    watchdog = None
    if deadline is not None:
        remaining = float(deadline) - time.time()
        if not math.isfinite(remaining) or remaining <= 0:
            raise ValueError("The training deadline has already passed or is invalid")
        # Last resort for a stuck CUDA call: only this dedicated child exits.
        watchdog = threading.Timer(remaining, lambda: os._exit(124))
        watchdog.daemon = True
        watchdog.start()
    run_dir = lora_store.RUNS_DIR / project_path.parent.name / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix="input-cache-", dir=run_dir) as cache:
            _train(project_path, run_id, Path(cache))
    finally:
        if watchdog:
            watchdog.cancel()


def _train(project_path: Path, run_id: str, cache_root: Path) -> None:
    import torch
    import torch.nn.functional as F
    from diffusers import DDPMScheduler, StableDiffusionXLPipeline, UNet2DConditionModel
    from diffusers.utils import convert_state_dict_to_diffusers
    from peft import LoraConfig
    from peft.utils import get_peft_model_state_dict

    from services import lora_store

    project = _load_project(project_path)
    values = {**lora_store.DEFAULT_SETTINGS, **(project.get("settings") or {})}
    plan = assistance_plan(values)
    # This is the dedicated child worker, not the shared backend process.
    # Avoid multiplying native tensor threads across preparation workers.
    torch.set_num_threads(1)
    timings = {"preparation_seconds": 0.0, "input_wait_seconds": 0.0, "training_seconds": 0.0}
    resolution = int(values["resolution"])
    batch_size = int(values["batch_size"])
    epochs = int(values["epochs"])
    max_steps = int(values.get("max_steps") or 0)
    grad_accum = int(values.get("gradient_accumulation_steps") or 1)
    save_interval = int(values["save_interval"])
    rank = int(values["rank"])
    alpha = int(values["alpha"])
    seed = int(values["seed"])
    precision = values.get("precision", "fp16")
    weight_dtype = torch.float16 if precision == "fp16" else torch.bfloat16 if precision == "bf16" else torch.float32
    device = torch.device("cuda")

    random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cuda.matmul.allow_tf32 = True

    from services.image_generation import discover_models
    base = next((model for model in discover_models() if model["id"] == project.get("base_model_id")), None)
    if not base:
        raise RuntimeError("The selected base model is no longer installed or is not SDXL compatible")
    base_path = base["path"]
    image_root = project_path.parent / "dataset" / "originals"
    examples = [item for item in lora_store.training_images(project) if (image_root / item.get("filename", "")).is_file()]
    from services.image_vault import guard_path
    for item in examples: guard_path(image_root / item["filename"])
    if not examples:
        raise RuntimeError("The project has no readable training images")

    emit("log", message=f"Loading SDXL base model {base['name']} on {torch.cuda.get_device_name(0)}")
    torch.cuda.reset_peak_memory_stats()
    preparation_started = time.perf_counter()
    cpu_report = _cache_examples(examples, image_root, project, values, base_path, cache_root, device, weight_dtype, plan)
    timings["preparation_seconds"] = time.perf_counter() - preparation_started
    emit("progress", timings=timings, cpu_assistance=cpu_report)
    emit("log", message="Encoders released. Training with RAM activation offload and cached inputs.")
    scheduler = DDPMScheduler.from_pretrained(base_path, subfolder="scheduler", local_files_only=True)
    unet = UNet2DConditionModel.from_pretrained(base_path, subfolder="unet", torch_dtype=weight_dtype, local_files_only=True).to(device)
    unet.requires_grad_(False)
    unet.add_adapter(LoraConfig(r=rank, lora_alpha=alpha, init_lora_weights="gaussian", target_modules=["to_k", "to_q", "to_v", "to_out.0"]))
    for parameter in unet.parameters():
        if parameter.requires_grad:
            parameter.data = parameter.data.float()
    unet.enable_gradient_checkpointing()
    unet.train()
    optimizer = torch.optim.AdamW(filter(lambda parameter: parameter.requires_grad, unet.parameters()), lr=float(values["learning_rate"]))

    scaler = torch.amp.GradScaler("cuda", enabled=weight_dtype == torch.float16)

    steps_per_epoch = max(1, math.ceil(len(examples) / batch_size))
    total_steps = max_steps or epochs * steps_per_epoch
    epochs = math.ceil(total_steps / steps_per_epoch)
    run_dir = lora_store.RUNS_DIR / project["id"] / run_id
    model_dir = run_dir / "model.partial"
    weights_dir = run_dir / "weights.partial"
    model_dir.mkdir(parents=True, exist_ok=True)
    weights_dir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    completed_steps = 0
    deadline = values.get("training_deadline_unix")
    deadline_reached = False

    try:
        for epoch in range(epochs):
            random.shuffle(examples)
            batches = (examples[offset:offset + batch_size] for offset in range(0, len(examples), batch_size))
            def load_batch(batch):
                return batch, _load_cached_records(batch, cache_root)
            def estimate_batch(batch):
                return sum((cache_root / f"{item['cache_index']}.pt").stat().st_size * 3 for item in batch)
            with PreparationPool(batches, load_batch, estimate_batch, plan) as pool:
                for batch, records in pool:
                    if completed_steps >= total_steps:
                        break
                    # Finish at an optimizer boundary, allowing five minutes for
                    # final weights and the complete package before the deadline.
                    if deadline is not None and time.time() >= float(deadline) - 300 and completed_steps % grad_accum == 0:
                        if not completed_steps:
                            raise RuntimeError("Not enough time remains to train before the deadline")
                        deadline_reached = True
                        emit("log", message="Training time budget reached; saving completed optimizer updates")
                        break
                    step_started = time.perf_counter()
                    latents, prompt_embeds, pooled = _batch_from_records(records, device, weight_dtype)
                    noise = torch.randn_like(latents)
                    timesteps = torch.randint(0, scheduler.config.num_train_timesteps, (latents.shape[0],), device=device).long()
                    noisy_latents = scheduler.add_noise(latents, noise, timesteps)
                    time_ids = torch.tensor([[resolution, resolution, 0, 0, resolution, resolution]] * len(batch), device=device, dtype=prompt_embeds.dtype)
                    accumulation_size = min(grad_accum, total_steps - (completed_steps // grad_accum) * grad_accum)
                    with torch.autograd.graph.save_on_cpu(pin_memory=True), torch.autocast("cuda", dtype=weight_dtype, enabled=weight_dtype != torch.float32):
                        prediction = unet(noisy_latents, timesteps, prompt_embeds, added_cond_kwargs={"text_embeds": pooled, "time_ids": time_ids}).sample
                        target = noise if scheduler.config.prediction_type == "epsilon" else scheduler.get_velocity(latents, noise, timesteps)
                        loss = F.mse_loss(prediction.float(), target.float(), reduction="mean") / accumulation_size
                    if not torch.isfinite(loss):
                        raise RuntimeError("Training loss is not finite; stopped without publishing an adapter")
                    scaler.scale(loss).backward()
                    if (completed_steps + 1) % grad_accum == 0 or completed_steps + 1 == total_steps:
                        scaler.unscale_(optimizer)
                        torch.nn.utils.clip_grad_norm_(filter(lambda parameter: parameter.requires_grad, unet.parameters()), 1.0)
                        scaler.step(optimizer)
                        scaler.update()
                        optimizer.zero_grad(set_to_none=True)
                    # This existing CPU read synchronizes the step before timing it.
                    loss_value = float(loss.detach().cpu()) * accumulation_size
                    timings["training_seconds"] += time.perf_counter() - step_started
                    completed_steps += 1
                    elapsed = round(time.monotonic() - started, 1)
                    emit("progress", status="running", phase="Training with RAM offload", memory=memory_snapshot(), epoch=epoch + 1, epochs=epochs, step=completed_steps, total_steps=total_steps, percent=round(completed_steps / total_steps * 100, 1), loss=round(loss_value, 6), elapsed_seconds=elapsed, timings={**timings, "input_wait_seconds": timings["input_wait_seconds"] + pool.wait_seconds}, cpu_assistance=pool.snapshot())
                    if completed_steps % save_interval == 0:
                        state = convert_state_dict_to_diffusers(get_peft_model_state_dict(unet))
                        StableDiffusionXLPipeline.save_lora_weights(weights_dir / f"checkpoint-{completed_steps}", unet_lora_layers=state, weight_name="adapter.safetensors")
                    del batch, records, latents, prompt_embeds, pooled, noise, noisy_latents, prediction, target, loss
                timings["input_wait_seconds"] += pool.wait_seconds
                cpu_report = pool.snapshot()
            if completed_steps >= total_steps or deadline_reached:
                break

        emit("log", message="Saving LoRA adapter")
        state = convert_state_dict_to_diffusers(get_peft_model_state_dict(unet))
        StableDiffusionXLPipeline.save_lora_weights(model_dir, unet_lora_layers=state, weight_name="adapter.safetensors")
        adapter_id = uuid.uuid4().hex
        elapsed_seconds = round(time.monotonic() - started, 1)
        adapter = lora_store.publish_completion(
            project["id"],
            run_id=run_id,
            adapter_id=adapter_id,
            model_source=model_dir,
            weights_source=weights_dir,
            training_seconds=elapsed_seconds,
        )
        emit("completed", adapter=adapter, elapsed_seconds=elapsed_seconds, timings=timings, cpu_assistance=cpu_report)
    finally:
        del unet, optimizer
        gc.collect()
        torch.cuda.empty_cache()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    try:
        train(Path(args.project), args.run_id)
    except KeyboardInterrupt:
        emit("cancelled", message="Training cancelled")
        return 130
    except Exception as exc:
        emit("failed", error=str(exc))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
