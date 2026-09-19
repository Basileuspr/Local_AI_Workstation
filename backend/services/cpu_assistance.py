"""Bounded, ordered CPU preparation. No model inference or GPU work runs here."""
from __future__ import annotations

import asyncio
import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

import psutil

MIB = 1024 ** 2


def validate_settings(settings):
    mode = settings.get("cpu_assistance", "auto")
    limit = settings.get("preload_ram_mb", 256)
    if not isinstance(mode, str) or mode not in {"auto", "light", "balanced"}:
        raise ValueError("CPU Assistance must be Auto, Light, or Balanced")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 32 <= limit <= 2048:
        raise ValueError("Preloading RAM budget must be a whole number from 32 to 2048 MiB")
    return mode, limit


def memory_headroom():
    memory = psutil.virtual_memory()
    # Leave room for Windows, the UI, and existing training activation offload.
    return max(0, memory.available - max(2 * 1024 ** 3, int(memory.total * 0.2)))


def assistance_plan(settings):
    mode, limit = validate_settings(settings)
    cores = psutil.cpu_count(logical=False) or os.cpu_count() or 1
    workers = 1 if mode == "light" else min(4 if mode == "balanced" else 2, max(1, cores - 1))
    budget = min(limit * MIB, (64 if mode == "light" else 256 if mode == "auto" else 2048) * MIB)
    if memory_headroom() < 128 * MIB:
        workers = 1
    return {"mode": mode, "workers": workers, "budget_bytes": budget, "configured_ram_mb": limit}


def image_working_bytes(image, resolution=1024):
    # Conservative scheduling estimate: decoded pixels, resize copies, tensor
    # conversion and encoded payloads. This is not a process-wide memory cap.
    pixels = max(1, int(image.get("width") or resolution)) * max(1, int(image.get("height") or resolution))
    return max(1 * MIB, pixels * 32 + resolution * resolution * 24)


class PreparationPool:
    """Keep the current item plus at most workers-1 future items in flight.

    Oversized items and low-memory situations use one foreground preparation,
    with no speculative preloading. Model code always consumes in input order.
    """
    def __init__(self, items, loader, estimate, plan, *, headroom=memory_headroom):
        self.items = iter(items)
        self.loader, self.estimate, self.plan, self.headroom = loader, estimate, plan, headroom
        self.executor = ThreadPoolExecutor(max_workers=plan["workers"], thread_name_prefix="lora-prepare")
        self.pending = deque()
        self.next_item = None
        self.exhausted = False
        self.closed = False
        self.lock = threading.Lock()
        self.worker_seconds = 0.0
        self.wait_seconds = 0.0
        self.peak_estimated_bytes = 0
        self.serial_fallbacks = 0

    def _load(self, item):
        started = time.perf_counter()
        try:
            return self.loader(item)
        finally:
            with self.lock:
                self.worker_seconds += time.perf_counter() - started

    def _fill(self, retained=0):
        held = retained + sum(size for _, size in self.pending)
        capacity = min(self.plan["budget_bytes"], self.headroom())
        while not self.exhausted and len(self.pending) + bool(retained) < self.plan["workers"]:
            if self.next_item is None:
                try:
                    item = next(self.items)
                    self.next_item = (item, max(1, self.estimate(item)))
                except StopIteration:
                    self.exhausted = True
                    break
            item, size = self.next_item
            if held + size > capacity:
                break
            self.next_item = None
            self.pending.append((self.executor.submit(self._load, item), size))
            held += size
            self.peak_estimated_bytes = max(self.peak_estimated_bytes, held)

    def __iter__(self):
        return self

    def __next__(self):
        if self.closed:
            raise StopIteration
        started = time.perf_counter()
        self._fill()
        if self.pending:
            future, size = self.pending.popleft()
            result = future.result()
            del future
            self._fill(retained=size)
        elif self.next_item is not None:
            item, _ = self.next_item
            self.next_item = None
            self.serial_fallbacks += 1
            result = self._load(item)
        else:
            raise StopIteration
        self.wait_seconds += time.perf_counter() - started
        return result

    def snapshot(self):
        with self.lock:
            return {**self.plan, "preparation_worker_seconds": round(self.worker_seconds, 4),
                    "preparation_wait_seconds": round(self.wait_seconds, 4),
                    "peak_estimated_preload_mb": round(self.peak_estimated_bytes / MIB, 1),
                    "serial_fallbacks": self.serial_fallbacks}

    def close(self):
        self.closed = True
        self.executor.shutdown(wait=True, cancel_futures=True)
        self.pending.clear()
        self.next_item = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


_END = object()


async def prepared_items(pool):
    """Keep CPU work off the event loop and join it before cancellation exits."""
    try:
        while True:
            task = asyncio.create_task(asyncio.to_thread(next, pool, _END))
            try:
                result = await asyncio.shield(task)
            except asyncio.CancelledError:
                try:
                    await task
                except Exception:
                    pass
                raise
            if result is _END:
                break
            yield result
            del result
    finally:
        await asyncio.to_thread(pool.close)
