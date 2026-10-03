"""ERNIE discovery, dispatch, limits, and SDXL isolation without model downloads."""
import json
import sys
from types import SimpleNamespace

import pytest
from PIL import Image

from services import image_generation
from test_image_generation_cancel import configure_manager, generation_options


def test_discovery_distinguishes_ernie_capabilities(tmp_path, monkeypatch):
    for name, pipeline in [("verboa-image-1.0-nf4", "ErnieImagePipeline"), ("existing", "StableDiffusionXLPipeline")]:
        folder = tmp_path / name
        folder.mkdir()
        (folder / "model_index.json").write_text(json.dumps({"_class_name": pipeline}))
    monkeypatch.setattr(image_generation, "MODELS_DIR", tmp_path)
    models = {model["id"]: model for model in image_generation.discover_models()}
    ernie = models["verboa-image-1.0-nf4"]
    assert ernie["name"] == "Verboa Image 1.0 NF4"
    assert not ernie["is_sdxl"]
    assert not ernie["supports_reference"]
    assert not ernie["supports_lora_training"]
    assert ernie["dimension_multiple"] == 16
    assert ernie["recommended_settings"] == {"steps": 8, "guidanceScale": 2, "negativePrompt": ""}
    assert models["existing"]["supports_reference"]
    assert models["existing"]["supports_long_prompt"]


def test_ernie_uses_one_local_native_tokenizer_without_clip_chunks(monkeypatch):
    calls = []
    class Tokenizer:
        model_max_length = 2048
        def num_special_tokens_to_add(self, pair=False): return 1
        def __call__(self, prompt, **kwargs): return SimpleNamespace(input_ids=prompt.split())
    def load(path, **kwargs):
        calls.append((path, kwargs))
        return Tokenizer()
    monkeypatch.setitem(sys.modules, "transformers", SimpleNamespace(
        AutoTokenizer=SimpleNamespace(from_pretrained=load), CLIPTokenizer=None))
    monkeypatch.setattr(image_generation, "_TOKENIZER_CACHE", {})
    monkeypatch.setattr(image_generation, "discover_models", lambda: [
        {"id": "ernie", "path": "local-model", "pipeline": "ErnieImagePipeline"}])
    status = image_generation.prompt_token_status("ernie", "word " * 250, "blurry")
    assert calls == [("local-model", {"subfolder": "tokenizer", "local_files_only": True})]
    assert status["prompt"]["token_count"] == 250
    assert status["prompt"]["chunks_required"] == 1
    assert status["prompt"]["native_content_limit"] == 2047
    assert status["long_prompt_supported"] is False
    assert status["long_prompt_max_chunks"] == 1


def ernie_manager(monkeypatch, tmp_path, pipeline):
    manager, coordinator = configure_manager(monkeypatch, tmp_path, pipeline)
    monkeypatch.setattr(image_generation, "discover_models", lambda: [
        {"id": "local", "path": "unused", "pipeline": "ErnieImagePipeline"}])
    return manager, coordinator


def test_ernie_generation_disables_prompt_enhancement_and_preserves_seed(monkeypatch, tmp_path):
    calls, encodings = [], []
    def pipeline(**kwargs):
        calls.append(kwargs)
        kwargs["callback_on_step_end"](None, 0, None, {})
        return SimpleNamespace(images=[Image.new("RGB", (512, 512), "blue")])
    def encode(text, device):
        encodings.append((text, device))
        return [f"conditioning:{text}"]
    pipeline.encode_prompt = encode
    pipeline._execution_device = "cuda:0"
    manager, coordinator = ernie_manager(monkeypatch, tmp_path, pipeline)
    result = manager.generate(**generation_options())
    assert calls[0]["use_pe"] is False
    assert encodings == [("test image", "cuda:0"), ("", "cuda:0")]
    assert calls[0]["prompt_embeds"] == ["conditioning:test image"]
    assert calls[0]["negative_prompt_embeds"] == ["conditioning:"]
    assert "prompt" not in calls[0]
    assert "pooled_prompt_embeds" not in calls[0]
    assert result["seed"] == 7
    assert coordinator.owner is None
    assert (tmp_path / result["filename"]).is_file()


@pytest.mark.parametrize("changes, message", [
    ({"width": 520}, "multiples of 16"),
    ({"source_image_ref": "blob:" + "0" * 64}, "text-to-image"),
    ({"lora_id": "sdxl-adapter"}, "SDXL LoRAs"),
])
def test_ernie_rejects_incompatible_requests_before_loading(monkeypatch, tmp_path, changes, message):
    manager, coordinator = ernie_manager(monkeypatch, tmp_path, None)
    monkeypatch.setattr(manager, "_load", lambda model: pytest.fail("Must validate before loading weights"))
    with pytest.raises(ValueError, match=message):
        manager.generate(**{**generation_options(), **changes})
    assert coordinator.owner is None


def test_ernie_keeps_mixed_offload_in_both_wait_modes(monkeypatch):
    manager = image_generation.ImageGenerationManager()
    manager._pipeline_type = "ErnieImagePipeline"
    manager._offload_strategy = "mixed"
    manager._configure_wait_mode(False)
    manager._configure_wait_mode(True)
    assert manager._offload_strategy == "mixed"
    with pytest.raises(ValueError, match="text-to-image only"):
        manager._pipeline_for_operation("img2img")


def test_nf4_transformer_is_never_sent_through_meta_offload(monkeypatch):
    import importlib.util
    from pathlib import Path
    layers, whole = [], []
    encoder, transformer, vae = object(), object(), object()
    transformer_hook, vae_hook = object(), object()
    device = SimpleNamespace(index=0)
    def offload_with_hook(model, target, prev_module_hook=None):
        whole.append((model, target, prev_module_hook))
        return model, transformer_hook if model is transformer else vae_hook
    class Pipeline:
        def remove_all_hooks(self): pass
        def to(self, target, **kwargs):
            assert target == "cpu"
    monkeypatch.setitem(sys.modules, "diffusers", SimpleNamespace(ErnieImagePipeline=Pipeline))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(device=lambda value: device,
        no_grad=lambda: lambda function: function, cuda=SimpleNamespace(empty_cache=lambda: None)))
    monkeypatch.setitem(sys.modules, "accelerate", SimpleNamespace(
        cpu_offload=lambda model, **kwargs: layers.append(model), cpu_offload_with_hook=offload_with_hook))
    path = Path(image_generation.__file__).with_name("ernie_image.py")
    spec = importlib.util.spec_from_file_location("ernie_offload_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    pipeline = module.LocalErnieImagePipeline()
    pipeline.text_encoder, pipeline.transformer, pipeline.vae = encoder, transformer, vae
    # Chat handoff removes hooks; reactivation must still avoid sending the
    # entire 7.7 GB encoder or quantized state through incompatible offload.
    for _ in range(2):
        pipeline.enable_model_cpu_offload()
    assert layers == [encoder, encoder]
    assert whole == [(transformer, device, None), (vae, device, transformer_hook)] * 2
    assert pipeline._all_hooks == [transformer_hook, vae_hook]


@pytest.fixture
def local_ernie(monkeypatch):
    """Exercise real CPU tensors without importing/loading the large model."""
    import importlib.util
    from pathlib import Path
    import torch
    monkeypatch.setitem(sys.modules, "diffusers", SimpleNamespace(ErnieImagePipeline=type("Pipeline", (), {})))
    path = Path(image_generation.__file__).with_name("ernie_image.py")
    spec = importlib.util.spec_from_file_location("ernie_conditioning_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    pipeline = module.LocalErnieImagePipeline()
    calls, tokens = [], []
    class Tokenizer:
        bos_token_id = 1
        def __call__(self, text, **kwargs):
            tokens.append(kwargs)
            return {"input_ids": [ord(character) for character in text]}
    def encoder(input_ids, **kwargs):
        calls.append(kwargs)
        hidden = input_ids.float().unsqueeze(-1).repeat(1, 1, 4)
        return SimpleNamespace(hidden_states=[hidden, hidden + 1, hidden + 2])
    pipeline.tokenizer, pipeline.text_encoder = Tokenizer(), encoder
    return pipeline, torch, calls, tokens


def test_native_conditioning_cache_reuses_exact_tokens_on_cpu_and_disables_kv(local_ernie):
    pipeline, torch, calls, tokens = local_ernie
    first = pipeline.encode_prompt(["cube", ""], "cpu", num_images_per_prompt=2)
    first_expected = first[0].clone()
    first[0].fill_(-100)
    repeated = pipeline.encode_prompt(["cube", ""], "cpu")
    assert len(first) == 4 and len(repeated) == 2
    assert torch.equal(repeated[0], first_expected)
    assert torch.equal(repeated[1], torch.full((1, 4), 2.0))  # BOS, penultimate state
    assert calls == [{"output_hidden_states": True, "use_cache": False}] * 2
    assert all(flags == dict(add_special_tokens=True, truncation=True, padding=False) for flags in tokens)
    assert all(value.device.type == "cpu" and not value.requires_grad for value in pipeline._prompt_embedding_cache.values())
    assert all(isinstance(key[-1], bytes) and len(key[-1]) == 32 for key in pipeline._prompt_embedding_cache)


def test_conditioning_cache_eviction_and_component_changes(local_ernie):
    pipeline, torch, calls, _ = local_ernie
    pipeline._prompt_cache_max_entries = 2
    for text in ["a", "b", "a", "c", "b"]:
        pipeline.encode_prompt(text, "cpu")
    assert len(calls) == 4  # 'a' was refreshed; 'b' was evicted
    assert len(pipeline._prompt_embedding_cache) == 2
    encoder = pipeline.text_encoder
    pipeline.text_encoder = lambda **kwargs: encoder(**kwargs)
    pipeline.encode_prompt("b", "cpu")
    assert len(calls) == 5
    pipeline._prompt_embedding_cache.clear()
    pipeline._prompt_cache_max_bytes = 32
    for text in ["aa", "bb", "aa", "longer-than-cache"]:
        pipeline.encode_prompt(text, "cpu")
    cache = pipeline._prompt_embedding_cache
    assert len(cache) == 1
    assert sum(value.numel() * value.element_size() for value in cache.values()) <= 32


def test_empty_tokenizer_without_bos_matches_native_fallback(local_ernie):
    pipeline, torch, _, _ = local_ernie
    pipeline.tokenizer.bos_token_id = None
    assert torch.equal(pipeline.encode_prompt("", "cpu")[0], torch.ones((1, 4)))


def test_end_of_image_offloads_without_rebuilding_hooks(local_ernie):
    pipeline, _, _, _ = local_ernie
    resets, released = [], []
    pipeline.components = {"transformer": SimpleNamespace(_reset_stateful_cache=lambda: resets.append(True))}
    pipeline._all_hooks = [SimpleNamespace(offload=lambda: released.append("transformer")),
                           SimpleNamespace(offload=lambda: released.append("vae"))]
    installed = pipeline._all_hooks
    pipeline.enable_model_cpu_offload = lambda **kwargs: pytest.fail("Normal image completion must retain hooks")
    for _ in range(2):
        pipeline.maybe_free_model_hooks()
    assert pipeline._all_hooks is installed
    assert released == ["transformer", "vae"] * 2
    assert resets == [True, True]


def test_real_accelerate_hooks_repeat_and_restore_after_handoff(local_ernie):
    """Real meta/CPU hook lifecycle on small modules, without occupying CUDA."""
    from accelerate.hooks import remove_hook_from_module
    pipeline, torch, _, _ = local_ernie
    pipeline.text_encoder = torch.nn.Linear(3, 3)
    pipeline.transformer, pipeline.vae = torch.nn.Linear(3, 3), torch.nn.Linear(3, 3)
    pipeline.components = dict(text_encoder=pipeline.text_encoder,
                               transformer=pipeline.transformer, vae=pipeline.vae)
    def remove_hooks():
        for model in pipeline.components.values():
            remove_hook_from_module(model, recurse=True)
        pipeline._all_hooks = []
    pipeline.remove_all_hooks = remove_hooks
    pipeline.to = lambda target, **kwargs: [model.to(target) for model in pipeline.components.values()]
    inputs = torch.ones((1, 3))
    expected = pipeline.vae(pipeline.transformer(pipeline.text_encoder(inputs))).detach()
    pipeline.enable_model_cpu_offload(device="cpu")
    installed = pipeline._all_hooks
    for _ in range(2):
        actual = pipeline.vae(pipeline.transformer(pipeline.text_encoder(inputs)))
        assert torch.equal(actual, expected)
        pipeline.maybe_free_model_hooks()
        assert pipeline._all_hooks is installed
        assert pipeline.text_encoder.weight.device.type == "meta"
    remove_hooks()
    assert pipeline.text_encoder.weight.device.type == "cpu"
    pipeline.enable_model_cpu_offload(device="cpu")
    assert torch.equal(pipeline.vae(pipeline.transformer(pipeline.text_encoder(inputs))), expected)
    pipeline.maybe_free_model_hooks()
    remove_hooks()


def test_ernie_without_cfg_skips_negative_encoding_and_starts_clock_after_prompt(monkeypatch, tmp_path):
    phases, encodings = [], []
    def pipeline(**kwargs):
        assert "negative_prompt_embeds" not in kwargs
        kwargs["callback_on_step_end"](None, 0, None, {})
        return SimpleNamespace(images=[Image.new("RGB", (512, 512), "blue")])
    def encode(text, device):
        encodings.append(text)
        assert phases[-1] == "Preparing prompt"
        return ["conditioning"]
    pipeline.encode_prompt, pipeline._execution_device = encode, "cuda:0"
    manager, _ = ernie_manager(monkeypatch, tmp_path, pipeline)
    monkeypatch.setattr(manager, "_update_progress", lambda request_id, **values: phases.append(values.get("phase")))
    manager.generate(**{**generation_options(), "guidance_scale": 1, "negative_prompt": "other text"})
    assert encodings == ["test image"]
    assert phases[:2] == ["Preparing prompt", "Generating image"]


def test_ernie_cancellation_after_encoding_skips_negative_and_denoising(monkeypatch, tmp_path):
    import threading
    cancel = threading.Event()
    def pipeline(**kwargs):
        pytest.fail("Cancelled prompt preparation must never denoise")
    def encode(text, device):
        assert text == "test image"
        cancel.set()
        return ["conditioning"]
    pipeline.encode_prompt, pipeline._execution_device = encode, "cuda:0"
    manager, coordinator = ernie_manager(monkeypatch, tmp_path, pipeline)
    with pytest.raises(image_generation.ImageGenerationCancelled):
        manager.generate(**generation_options(), cancellation_event=cancel)
    assert coordinator.owner is None
