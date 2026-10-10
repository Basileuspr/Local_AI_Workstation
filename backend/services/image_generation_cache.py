"""Small, disposable RAM caches for exact image-generation preparation results."""
from collections import OrderedDict
from functools import wraps
import hashlib
import inspect
import json
import threading

from services.cpu_assistance import memory_headroom

MIB = 1024 ** 2


class PreparationCache:
    """Bound retained bytes; every caller receives an independent copy."""

    def __init__(self, max_entries=16, max_bytes=64 * MIB):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self._entries = OrderedDict()
        self._bytes = self._hits = self._misses = 0
        self._lock = threading.Lock()

    def clear(self):
        with self._lock:
            self._clear()

    def _clear(self):
        self._entries.clear()
        self._bytes = 0

    def _room(self, size):
        try:
            return memory_headroom() >= size
        except OSError:
            return False

    def get(self, key, copy):
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None and self._room(entry[1]):
                try:
                    result = copy(entry[0])
                except MemoryError:
                    self._clear()
                else:
                    self._entries.move_to_end(key)
                    self._hits += 1
                    return result
            elif entry is not None or not self._room(1):
                self._clear()
            self._misses += 1
            return None

    def put(self, key, value, size, copy):
        with self._lock:
            if not self._room(size):
                self._clear()
                return
            if not 0 < size <= self.max_bytes or self.max_entries < 1:
                return
            previous = self._entries.pop(key, None)
            if previous is not None:
                self._bytes -= previous[1]
            while self._entries and (len(self._entries) >= self.max_entries or self._bytes + size > self.max_bytes):
                _, (_, removed_size) = self._entries.popitem(last=False)
                self._bytes -= removed_size
            try:
                owned = copy(value)
            except (MemoryError, RuntimeError):
                # A CPU copy is optional. Keep the original provider result.
                self._clear()
                return
            self._entries[key] = (owned, size)
            self._bytes += size

    def status(self):
        with self._lock:
            return {"entries": len(self._entries), "bytes": self._bytes,
                    "max_bytes": self.max_bytes, "hits": self._hits, "misses": self._misses}


def conditioning_key(pipeline, mode, arguments):
    """Hash text; identify the encoders and tokenizers actually in use."""
    components = [getattr(pipeline, name, None) for name in
                  ("tokenizer", "tokenizer_2", "text_encoder", "text_encoder_2")]
    identity = [(id(component), str(getattr(component, "dtype", None))) for component in components]
    config = getattr(pipeline, "config", None)
    payload = [mode, identity, getattr(config, "force_zeros_for_empty_prompt", None), arguments]
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")).digest()


def conditioning_bytes(value):
    import torch
    if isinstance(value, torch.Tensor):
        return value.numel() * value.element_size()
    if isinstance(value, dict):
        return sum(conditioning_bytes(item) for item in value.values())
    if isinstance(value, (tuple, list)):
        return sum(conditioning_bytes(item) for item in value)
    if value is None:
        return 0
    raise TypeError("Unsupported conditioning result")


def copy_conditioning(value, device):
    import torch
    if isinstance(value, torch.Tensor):
        return value.detach().to(device=device, copy=True)
    if isinstance(value, dict):
        return {key: copy_conditioning(item, device) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return type(value)(copy_conditioning(item, device) for item in value)
    if value is None:
        return None
    raise TypeError("Unsupported conditioning result")


def store_conditioning(cache, key, result):
    try:
        size = conditioning_bytes(result)
    except TypeError:
        # Keep unusual provider/test results usable without caching them.
        return
    cache.put(key, result, size, lambda value: copy_conditioning(value, "cpu"))


def cache_sdxl_prompt_encoding(pipeline, cache):
    """Wrap native encoding, retaining its signature and exact output tensors."""
    original = getattr(pipeline, "encode_prompt", None)
    if original is None or getattr(original, "_law_preparation_cache", False):
        return
    signature = inspect.signature(original)

    @wraps(original)
    def encode_prompt(*args, **kwargs):
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        arguments = dict(bound.arguments)
        device = arguments.pop("device", None) or pipeline._execution_device
        arguments["encoding_device"] = str(device)
        # Explicit embeddings and transient Diffusers LoRA scaling keep their
        # native path. Manager-owned LoRA changes invalidate this cache.
        if any(arguments.get(name) is not None for name in
               ("prompt_embeds", "negative_prompt_embeds", "pooled_prompt_embeds",
                "negative_pooled_prompt_embeds", "lora_scale")):
            return original(*args, **kwargs)
        try:
            key = conditioning_key(pipeline, str(id(getattr(original, "__func__", original))), arguments)
        except (TypeError, ValueError):
            return original(*args, **kwargs)
        cached = cache.get(key, lambda value: copy_conditioning(value, device))
        if cached is not None:
            return cached
        result = original(*args, **kwargs)
        store_conditioning(cache, key, result)
        return result

    encode_prompt._law_preparation_cache = True
    pipeline.encode_prompt = encode_prompt
