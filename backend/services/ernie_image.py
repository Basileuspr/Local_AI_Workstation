"""ERNIE memory handling for a small CUDA GPU and the publisher's NF4 weights."""
from __future__ import annotations

import torch
from accelerate import cpu_offload, cpu_offload_with_hook
from diffusers import ErnieImagePipeline


class LocalErnieImagePipeline(ErnieImagePipeline):
    def enable_model_cpu_offload(self, gpu_id=None, device=None):
        """Offload encoder layers and whole quantized denoiser/VAE components.

        Accelerate's sequential offload moves NF4 quantization state to meta,
        where bitsandbytes cannot restore it. The 4.8 GB denoiser instead uses
        whole-model offload; only the unquantized 7.7 GB encoder uses meta.
        Override the method used by maybe_free_model_hooks so repeat runs and
        transitions back from chat re-establish this same arrangement.
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
