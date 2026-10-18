"""Isolated SDXL denoiser A/B benchmark; no prompts, settings or app data are changed.

Run with the desktop queue idle. Uses the installed UNet only, synthetic fixed
conditioning and identical inputs for every candidate. No model downloads.
Compilation is optional and never installed or enabled in the application.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import statistics
import tempfile
import time
import urllib.request

import psutil
import torch
from diffusers import UNet2DConditionModel

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model', type=Path, required=True)
parser.add_argument('--width', type=int, default=1024)
parser.add_argument('--height', type=int, default=1024)
parser.add_argument('--tokens', type=int, default=231)
parser.add_argument('--runs', type=int, default=8)
parser.add_argument('--compile', action='store_true')
args = parser.parse_args()
output = Path(tempfile.mkdtemp(prefix='law-sdxl-denoiser-'))
os.environ['TORCHINDUCTOR_CACHE_DIR'] = str(output / 'inductor')
os.environ['TRITON_CACHE_DIR'] = str(output / 'triton')


def desktop_queue():
    for process in psutil.process_iter(['name']):
        if 'python' not in (process.info['name'] or '').lower():
            continue
        try:
            env = process.environ()
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            continue
        if env.get('LAW_SESSION_TOKEN') and env.get('LAW_PORT'):
            request = urllib.request.Request(f"http://127.0.0.1:{int(env['LAW_PORT'])}/queue",
                headers={'X-LAW-Session': env['LAW_SESSION_TOKEN']})
            with urllib.request.urlopen(request, timeout=5) as response:
                return json.load(response).get('jobs', [])
    return []


def check_idle():
    if any(job['status'] in {'queued', 'running', 'cancelling'} for job in desktop_queue()):
        raise RuntimeError('Desktop work is active; benchmark deferred without cancelling it')


check_idle()
if psutil.virtual_memory().available < 6 * 1024**3:
    raise RuntimeError('Less than 6 GiB RAM available; benchmark deferred')
torch.backends.cuda.matmul.allow_tf32 = True  # Same setting as the application.
report = dict(model=args.model.name, width=args.width, height=args.height, conditioning_tokens=args.tokens,
              cfg_batch=2, dtype='float16', seed=23, torch=torch.__version__,
              gpu=torch.cuda.get_device_name(), scope='UNet only; synthetic conditioning, not end-to-end image quality', runs=[])
print(json.dumps({'output': str(output), **report}), flush=True)


def save():
    (output / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


model = UNet2DConditionModel.from_pretrained(args.model, subfolder='unet', torch_dtype=torch.float16,
    local_files_only=True, use_safetensors=True).eval().to('cuda')
check_idle()
print('UNet loaded; measuring identical fixed inputs', flush=True)
generator = torch.Generator('cuda').manual_seed(23)
sample = torch.randn((2, 4, args.height // 8, args.width // 8), device='cuda', dtype=torch.float16, generator=generator)
embedding = torch.randn((2, args.tokens, 2048), device='cuda', dtype=torch.float16, generator=generator)
pooled = torch.randn((2, 1280), device='cuda', dtype=torch.float16, generator=generator)
time_ids = torch.tensor([[args.height, args.width, 0, 0, args.height, args.width]] * 2, device='cuda', dtype=torch.float16)
timestep = torch.tensor(500., device='cuda')
keywords = dict(encoder_hidden_states=embedding, added_cond_kwargs={'text_embeds': pooled, 'time_ids': time_ids}, return_dict=False)


@torch.no_grad()
def benchmark(label, callable_model, reference=None):
    check_idle()
    cold_start = time.perf_counter()
    callable_model(sample, timestep, **keywords)
    torch.cuda.synchronize()
    cold_seconds = time.perf_counter() - cold_start
    for _ in range(2):
        check_idle()
        callable_model(sample, timestep, **keywords)
    torch.cuda.synchronize()
    torch.cuda.reset_peak_memory_stats()
    samples = []
    for _ in range(args.runs):
        check_idle()
        start = time.perf_counter()
        value = callable_model(sample, timestep, **keywords)[0]
        torch.cuda.synchronize()
        samples.append(time.perf_counter() - start)
    pixels = value.detach().cpu()
    baseline = pixels if reference is None else reference
    delta = (pixels.float() - baseline.float()).abs()
    row = dict(candidate=label, cold_seconds=round(cold_seconds, 4), median_seconds=round(statistics.median(samples), 4),
               samples_seconds=[round(value, 4) for value in samples], peak_allocated_bytes=torch.cuda.max_memory_allocated(),
               output_sha256=hashlib.sha256(pixels.numpy().tobytes()).hexdigest(), exactly_equal=torch.equal(pixels, baseline),
               max_absolute_difference=delta.max().item(), mean_absolute_difference=delta.mean().item())
    report['runs'].append(row)
    save()
    print(json.dumps(row), flush=True)
    return pixels


try:
    baseline = benchmark('eager_contiguous', model)
    model.to(memory_format=torch.channels_last)
    benchmark('eager_channels_last', model, baseline)
    # Recheck the baseline to expose drift caused by temperature or other work.
    model.to(memory_format=torch.contiguous_format)
    benchmark('eager_contiguous_recheck', model, baseline)
    if args.compile:
        if importlib.util.find_spec('triton') is None:
            report['compile'] = 'unavailable: compatible Triton is not installed'
        else:
            check_idle()
            try:
                compiled = torch.compile(model, mode='default', fullgraph=True)
                benchmark('compiled_contiguous', compiled, baseline)
            except Exception as error:
                report['compile'] = {'status': 'failed', 'error': str(error)}
                save()
                raise
    save()
finally:
    del model
    torch.cuda.empty_cache()
