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
    calls = []
    def pipeline(**kwargs):
        calls.append(kwargs)
        kwargs["callback_on_step_end"](None, 0, None, {})
        return SimpleNamespace(images=[Image.new("RGB", (512, 512), "blue")])
    manager, coordinator = ernie_manager(monkeypatch, tmp_path, pipeline)
    result = manager.generate(**generation_options())
    assert calls[0]["use_pe"] is False
    assert calls[0]["prompt"] == "test image"
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
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(device=lambda value: device, cuda=SimpleNamespace(empty_cache=lambda: None)))
    monkeypatch.setitem(sys.modules, "accelerate", SimpleNamespace(
        cpu_offload=lambda model, **kwargs: layers.append(model), cpu_offload_with_hook=offload_with_hook))
    path = Path(image_generation.__file__).with_name("ernie_image.py")
    spec = importlib.util.spec_from_file_location("ernie_offload_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    pipeline = module.LocalErnieImagePipeline()
    pipeline.text_encoder, pipeline.transformer, pipeline.vae = encoder, transformer, vae
    # Diffusers repeats this method after each image; the second run must not
    # revert to offloading the entire 7.7 GB encoder onto the GPU.
    for _ in range(2):
        pipeline.enable_model_cpu_offload()
    assert layers == [encoder, encoder]
    assert whole == [(transformer, device, None), (vae, device, transformer_hook)] * 2
    assert pipeline._all_hooks == [transformer_hook, vae_hook]
