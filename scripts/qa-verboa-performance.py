"""Opt-in Verboa route benchmark with neutral inputs and isolated temporary data.

Run only while the desktop GPU queue is idle and 16 GiB of RAM is available.
Does not unload Ollama models,
read saved prompts, or change generation settings to obtain a faster result.
"""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--label", default="benchmark")
parser.add_argument("--runs", type=int, default=2, choices=range(1, 5))
parser.add_argument("--resume", action="store_true")
parser.add_argument("--baseline", type=Path, help="Compare settings and pixel hashes with an earlier result.json")
args = parser.parse_args()
output = Path(tempfile.mkdtemp(prefix="law-verboa-performance-"))
os.environ["LAW_DATA_DIR"] = str(output)
os.environ["LAW_MODELS_DIR"] = str(Path(__file__).resolve().parents[1] / "models")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import torch
import psutil
from PIL import Image
from routes import image_generation as route
from services.image_generation import manager
from services.request_queue import queue


def preflight():
    usage = subprocess.check_output([
        "nvidia-smi", "--query-gpu=memory.used,utilization.gpu", "--format=csv,noheader,nounits"
    ], text=True).strip().splitlines()[0]
    memory, busy = map(int, usage.split(","))
    if memory > 2000 or busy > 15:
        raise RuntimeError("GPU is occupied; defer this opt-in benchmark until it is idle")
    if psutil.virtual_memory().available < 16 * 1024 ** 3:
        raise RuntimeError("Not enough free RAM for a comparable native benchmark; defer until 16 GiB is available")


async def isolated_runtime(kind):
    # This fixture's queue is separate from the running desktop process. Never
    # use its runtime preparation to unload models owned by that process.
    assert kind == "image"


async def main():
    preflight()
    print(json.dumps({"label": args.label, "output": str(output), "pid": os.getpid()}), flush=True)
    route.prepare_runtime = isolated_runtime
    stages, runs = {}, []
    load = manager._load

    def timed(name, function):
        def call(*positional, **keywords):
            torch.cuda.synchronize()
            started = time.monotonic()
            try:
                return function(*positional, **keywords)
            finally:
                torch.cuda.synchronize()
                stages[name] = stages.get(name, 0) + time.monotonic() - started
        return call

    def profiled_load(model):
        initial = manager._pipeline is None
        result = timed("load", load)(model)
        if initial:
            pipeline = manager._pipeline
            pipeline.encode_prompt = timed("encode", pipeline.encode_prompt)
            # Accelerate restores forward when rebuilding hooks. Module-level
            # observer hooks survive that, including in the baseline runtime.
            denoiser_started = []
            def before_denoiser(*unused):
                torch.cuda.synchronize()
                denoiser_started.append(time.monotonic())
            def after_denoiser(*unused):
                torch.cuda.synchronize()
                stages["denoiser"] = stages.get("denoiser", 0) + time.monotonic() - denoiser_started.pop()
            pipeline.transformer.register_forward_pre_hook(before_denoiser)
            pipeline.transformer.register_forward_hook(after_denoiser)
            pipeline.vae.decode = timed("decode", pipeline.vae.decode)
            pipeline.maybe_free_model_hooks = timed("offload_cleanup", pipeline.maybe_free_model_hooks)
            print(json.dumps({"stage": "loaded", "seconds": round(stages["load"], 3)}), flush=True)
        return result
    manager._load = profiled_load

    class Client:
        async def is_disconnected(self): return False

    settings = dict(model_id="verboa-image-1.0-nf4",
                    prompt="A simple blue ceramic cube on a plain white studio background, product photograph",
                    negative_prompt="", width=512, height=512, steps=8, guidance_scale=2, seed=23)
    baseline = json.loads(args.baseline.read_text(encoding="utf-8")) if args.baseline else None
    if baseline:
        assert baseline["settings"] == settings, "Baseline settings differ"
    for index in range(args.runs + int(args.resume)):
        stages.clear()
        if index == args.runs:
            manager.park_for_chat()
        started = time.monotonic()
        result = await route.generate_image(route.ImageGenerationRequest(
            **settings, request_id=f"verboa-performance-{index}"), Client())
        seconds = time.monotonic() - started
        with Image.open(output / "generated_images" / result["filename"]) as image:
            pixels = hashlib.sha256(image.convert("RGB").tobytes()).hexdigest()
        if baseline:
            assert all(run["pixel_sha256"] == pixels for run in baseline["runs"]), "Baseline pixels differ"
        report = dict(index=index, resumed=index == args.runs, seconds=round(seconds, 3),
                      stages={key: round(value, 3) for key, value in stages.items()},
                      peak_vram_bytes=result["peak_vram_bytes"], pixel_sha256=pixels,
                      filename=result["filename"])
        runs.append(report)
        (output / "result.json").write_text(json.dumps(dict(label=args.label, settings=settings,
            isolated_runtime_preparation=True, runs=runs), indent=2), encoding="utf-8")
        print(json.dumps(report), flush=True)
    assert queue.active is None
    assert len({run["pixel_sha256"] for run in runs}) == 1, "Seeded repeat/resume changed pixels"


try:
    asyncio.run(main())
finally:
    manager.unload_for_training()
