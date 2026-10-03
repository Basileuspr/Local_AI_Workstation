"""ERNIE memory handling for a small CUDA GPU and the publisher's NF4 weights."""
from __future__ import annotations

from collections import OrderedDict
import hashlib
import json

import torch
from accelerate import cpu_offload, cpu_offload_with_hook
from diffusers import ErnieImagePipeline


class LocalErnieImagePipeline(ErnieImagePipeline):
    _prompt_cache_max_entries = 16
    _prompt_cache_max_bytes = 32 * 1024 ** 2

    @torch.no_grad()
    def encode_prompt(self, prompt, device, num_images_per_prompt=1):
        """Reuse exact native conditioning, bounded on CPU for this model only.

        Match ERNIE's tokenizer and penultimate hidden state. Prompt embedding
        extraction never uses autoregressive KV state. Hash token IDs rather
        than retaining prompt strings, and return independent tensors so a
        caller cannot modify cached conditioning.
        """
        cache = getattr(self, "_prompt_embedding_cache", None)
        if cache is None:
            cache = self._prompt_embedding_cache = OrderedDict()
        text_hiddens = []
        for text in [prompt] if isinstance(prompt, str) else prompt:
            ids = self.tokenizer(text, add_special_tokens=True, truncation=True, padding=False)["input_ids"]
            if not ids:
                ids = [self.tokenizer.bos_token_id if self.tokenizer.bos_token_id is not None else 0]
            key = (id(self.text_encoder), id(self.tokenizer), hashlib.sha256(json.dumps(ids).encode()).digest())
            if key in cache:
                cache.move_to_end(key)
                hidden = cache[key].to(device=device, copy=True)
            else:
                outputs = self.text_encoder(input_ids=torch.tensor([ids], device=device),
                                            output_hidden_states=True, use_cache=False)
                hidden = outputs.hidden_states[-2][0]
                # Copy even when executing on CPU: cached data must never be a
                # view into the encoder output returned to the caller.
                cached = hidden.detach().to(device="cpu", copy=True)
                size = cached.numel() * cached.element_size()
                if size <= self._prompt_cache_max_bytes:
                    while cache and (len(cache) >= self._prompt_cache_max_entries or
                                     sum(value.numel() * value.element_size() for value in cache.values()) + size >
                                     self._prompt_cache_max_bytes):
                        cache.popitem(last=False)
                    cache[key] = cached
                del outputs
            text_hiddens.extend([hidden] * num_images_per_prompt)
        return text_hiddens

    def maybe_free_model_hooks(self):
        """Release CUDA weights without rebuilding the encoder's meta hooks.

        Sequential encoder hooks already offload after each forward. Whole
        NF4/VAE hooks need an explicit offload, but keep their identities and
        dependencies intact for the next call. Chat handoff still removes and
        rebuilds hooks through enable_model_cpu_offload.
        """
        for component in self.components.values():
            if hasattr(component, "_reset_stateful_cache"):
                component._reset_stateful_cache()
        for hook in getattr(self, "_all_hooks", []):
            hook.offload()
        if getattr(self, "_all_hooks", []):
            torch.cuda.empty_cache()

    def enable_model_cpu_offload(self, gpu_id=None, device=None):
        """Offload encoder layers and whole quantized denoiser/VAE components.

        Accelerate's sequential offload moves NF4 quantization state to meta,
        where bitsandbytes cannot restore it. The 4.8 GB denoiser instead uses
        whole-model offload; only the unquantized 7.7 GB encoder uses meta.
        Transitions back from chat re-establish this same arrangement.
        """
        self.remove_all_hooks()
        execution_device = torch.device(device or f"cuda:{gpu_id or 0}")
        self._offload_device = execution_device
        self._offload_gpu_id = execution_device.index or 0
        self.to("cpu", silence_dtype_warnings=True)
        torch.cuda.empty_cache()
        cpu_offload(self.text_encoder, execution_device=execution_device)
        _, transformer_hook = cpu_offload_with_hook(self.transformer, execution_device)
        _, vae_hook = cpu_offload_with_hook(self.vae, execution_device, prev_module_hook=transformer_hook)
        self._all_hooks = [transformer_hook, vae_hook]
