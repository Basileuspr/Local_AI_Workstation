"""Bounded audio concurrency and cooperative use of the app's GPU lease."""
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import asyncio
import importlib.util
import logging
import subprocess
import uuid

import psutil

from services.gpu_coordination import gpu_coordinator


def cpu_plan(mode='auto'):
    if mode not in {'auto', 'light', 'balanced'}:
        raise ValueError('CPU assistance must be Auto, Light, or Balanced.')
    cores = psutil.cpu_count(logical=False) or 2
    available = psutil.virtual_memory().available
    budget = max(1, cores - 2)
    workers = min({'light':1, 'auto':2, 'balanced':4}[mode], budget)
    # Keep model/activation memory and Windows headroom on smaller machines.
    if available < 8 * 1024**3:
        workers = 1
    return {'workers': workers, 'cpu_threads': min(4, max(1, budget // workers)),
            'speaker_threads': min({'light':2, 'auto':4, 'balanced':6}[mode], budget),
            'assistance': mode}


@lru_cache(maxsize=1)
def cuda_available():
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except (ImportError, OSError, RuntimeError):
        return False


def free_gpu_mb():
    try:
        result = subprocess.run(['nvidia-smi', '--id=0', '--query-gpu=memory.free',
            '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=True)
        return int(result.stdout.strip().splitlines()[0])
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


def choose_device(mode, model_size, plan):
    if mode not in {'auto', 'cpu'}:
        raise ValueError('Processing must be Auto or CPU only.')
    result = {**plan, 'device':'cpu', 'owner':None, 'warnings':[]}
    if mode == 'cpu':
        return result
    if not cuda_available():
        result['warnings'].append('NVIDIA acceleration is unavailable; using CPU with the selected model.')
        return result
    owner = 'audio:' + uuid.uuid4().hex
    if not gpu_coordinator.acquire(owner):
        result['warnings'].append('The GPU is busy with another app task; using CPU with the selected model.')
        return result
    free = free_gpu_mb()
    required = {'base':1200, 'small':2200, 'turbo':4000}[model_size]
    if free is not None and free < required:
        try:
            # Only the lease holder may park idle image/chat models. Reuse
            # the app's existing provider handoff, without interrupting a job.
            free_idle_gpu_memory()
            free = free_gpu_mb()
        except Exception:
            logging.getLogger(__name__).warning('Audio could not free idle GPU allocations', exc_info=True)
            gpu_coordinator.release(owner)
            result['warnings'].append('Could not prepare the GPU; using CPU with the selected model.')
            return result
    if free is not None and free < required:
        gpu_coordinator.release(owner)
        result['warnings'].append('Available GPU memory is low; using CPU with the selected model.')
        return result
    result.update(device='cuda', owner=owner, workers=min(2, result['workers']))
    return result


def free_idle_gpu_memory():
    from services.request_queue import prepare_runtime
    async def handoff():
        await prepare_runtime('chat')  # Park the idle image pipeline on CPU.
        await prepare_runtime('audio')  # Release idle Ollama models.
    asyncio.run(handoff())


def prepare_cuda_libraries():
    # The workstation's optional PyTorch installation supplies compatible
    # CUDA DLLs on Windows. Loading it does not start model inference.
    if importlib.util.find_spec('torch'):
        import torch  # noqa: F401


def release_device(plan):
    if plan.get('owner'):
        gpu_coordinator.release(plan['owner'])
        plan['owner'] = None


def ordered_map(function, items, workers):
    """Keep at most two items per worker resident and emit original order."""
    if workers == 1:
        yield from map(function, items)
        return
    incoming = iter(items)
    pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='audio-transcribe')
    pending = deque()
    try:
        for _ in range(workers * 2):
            try:
                pending.append(pool.submit(function, next(incoming)))
            except StopIteration:
                break
        while pending:
            future = pending.popleft()
            yield future.result()
            try:
                pending.append(pool.submit(function, next(incoming)))
            except StopIteration:
                pass
    finally:
        for future in pending:
            future.cancel()
        # No model unloading or GPU lease release while inference still runs.
        pool.shutdown(wait=True, cancel_futures=True)


def unload_gpu_model(model):
    if model is not None:
        model.model.unload_model(to_cpu=True)
