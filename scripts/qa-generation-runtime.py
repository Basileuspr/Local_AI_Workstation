r"""Opt-in local SDXL regression smoke; writes only to a fresh temporary folder.

Example: venv\Scripts\python.exe scripts/qa-generation-runtime.py --model MODEL_ID
No LoRA is loaded. Run while the desktop GPU queue is idle.
"""
import argparse
import asyncio
import faulthandler
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--model", required=True)
args = parser.parse_args()
faulthandler.enable()
output = Path(tempfile.mkdtemp(prefix="law-generation-smoke-"))
os.environ["LAW_DATA_DIR"] = str(output)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from PIL import Image, ImageChops
from routes.image_generation import ImageGenerationRequest, generate_image
from services.image_generation import manager, ImageGenerationCancelled
from services.request_queue import queue


async def run():
    print(json.dumps({"output": str(output)}), flush=True)
    saving, next_step = threading.Event(), threading.Event()
    save_original, progress_original = Image.Image.save, manager._update_progress
    observed = {}

    def save(image, path, **kwargs):
        if str(path).endswith(".png.part") and not saving.is_set():
            observed["cpu_save_started"] = time.monotonic()
            saving.set()
            if not next_step.wait(60):
                raise RuntimeError("Next image did not reach a GPU step while CPU save was pending")
        return save_original(image, path, **kwargs)

    def progress(request_id, **values):
        if request_id == "smoke-second" and values.get("step", 0) > 0:
            observed.setdefault("next_gpu_step", time.monotonic())
            next_step.set()
        return progress_original(request_id, **values)

    class Client:
        async def is_disconnected(self): return False

    options = dict(model_id=args.model,
        prompt="A blue ceramic cup on a wooden table, soft daylight, " + "detailed glazed pottery, " * 24,
        negative_prompt="blurry", width=512, height=512, steps=4,
        guidance_scale=5.5, seed=42, allow_long_wait=True)
    Image.Image.save, manager._update_progress = save, progress
    try:
        results = await asyncio.gather(*[
            generate_image(ImageGenerationRequest(**options, request_id=request_id), Client())
            for request_id in ("smoke-first", "smoke-second")
        ])
    finally:
        Image.Image.save, manager._update_progress = save_original, progress_original
    assert next_step.is_set()
    print(json.dumps({"stage": "batch", "overlap": True}), flush=True)
    with Image.open(output / "generated_images" / results[0]["filename"]) as first, Image.open(
        output / "generated_images" / results[1]["filename"]) as second:
        same_pixels = ImageChops.difference(first.convert("RGB"), second.convert("RGB")).getbbox() is None
        assert same_pixels, "Repeated seeded batch changed its pixels"
    print(json.dumps({"stage": "pixel_check", "equal": same_pixels}), flush=True)
    # Retain only an identity, never a reference keeping an unloaded model alive.
    unet_id = id(manager._pipeline.unet)
    manager.park_for_chat()
    retained = manager._pipeline is not None
    print(json.dumps({"stage": "parked", "retained": retained}), flush=True)
    resumed = await asyncio.to_thread(manager.generate, **options, request_id="smoke-resume")
    reused = retained and id(manager._pipeline.unet) == unet_id
    assert not retained or reused
    print(json.dumps({"stage": "resumed", "reused": reused}), flush=True)

    cancel = threading.Event()
    def cancel_after_step(request_id, **values):
        progress_original(request_id, **values)
        if values.get("step", 0) >= 1:
            cancel.set()
    manager._update_progress = cancel_after_step
    try:
        try:
            await asyncio.to_thread(manager.generate, **options, request_id="smoke-cancel", cancellation_event=cancel)
        except ImageGenerationCancelled:
            pass
        else:
            raise AssertionError("Native generation did not stop")
        assert manager._pipeline is None
        print(json.dumps({"stage": "cancelled"}), flush=True)
    finally:
        manager._update_progress = progress_original
    recovered = await asyncio.to_thread(manager.generate, **options, request_id="smoke-recover")
    assert queue.active is None
    report = {"model": args.model, "size": [512, 512], "steps": 4,
        "long_wait": True, "long_prompt": True, "lora": None,
        "cpu_save_overlapped_next_gpu_step": bool(observed), "same_seed_pixels_equal": same_pixels,
        "ram_retained_at_handoff": retained, "same_weights_reused": reused,
        "cancelled_and_recovered": True,
        "generation_seconds": [result["generation_seconds"] for result in results],
        "resume_seconds": resumed["generation_seconds"], "recovery_seconds": recovered["generation_seconds"],
        "outputs": [result["filename"] for result in [*results, resumed, recovered]]}
    (output / "result.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)


try:
    asyncio.run(run())
finally:
    manager.unload_for_training()
