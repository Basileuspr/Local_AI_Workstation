"""Cache exact preparation only: no model download or GPU inference."""
import io
import json
from types import SimpleNamespace

import pytest
import torch
from PIL import Image

from services import image_generation_cache as caching
from services import generation_reference as references, image_store, image_vault
from services.image_generation import ImageGenerationManager


@pytest.fixture(autouse=True)
def available_ram(monkeypatch, tmp_path):
    monkeypatch.setattr(caching, "memory_headroom", lambda: 256 * caching.MIB)
    monkeypatch.setattr(image_store, "BLOBS_DIR", tmp_path / "blobs")
    monkeypatch.setattr(image_vault, "is_locked", lambda _: False)
    references.preparation_cache.clear()
    yield
    references.preparation_cache.clear()


class EncoderPipeline:
    """Small CPU tensors exercise the native SDXL call signature."""
    def __init__(self):
        self._execution_device = "cpu"
        self.text_encoder = SimpleNamespace(dtype=torch.float16)
        self.text_encoder_2 = SimpleNamespace(dtype=torch.float16)
        self.tokenizer, self.tokenizer_2 = object(), object()
        self.config = SimpleNamespace(force_zeros_for_empty_prompt=True)
        self.calls = 0

    def encode_prompt(self, prompt, prompt_2=None, device=None, num_images_per_prompt=1,
                      do_classifier_free_guidance=True, negative_prompt=None, negative_prompt_2=None,
                      prompt_embeds=None, negative_prompt_embeds=None, pooled_prompt_embeds=None,
                      negative_pooled_prompt_embeds=None, lora_scale=None, clip_skip=None):
        self.calls += 1
        tensor = torch.arange(12, dtype=torch.float16).reshape(1, 3, 4)
        return (tensor, tensor + 1 if do_classifier_free_guidance else None, tensor[:, 0],
                tensor[:, 0] + 1 if do_classifier_free_guidance else None)


def wrapped():
    pipeline = EncoderPipeline()
    cache = caching.PreparationCache()
    caching.cache_sdxl_prompt_encoding(pipeline, cache)
    return pipeline, cache


def test_conditioning_hit_is_exact_independent_and_does_not_change_rng():
    pipeline, cache = wrapped()
    state = torch.random.get_rng_state().clone()
    cold = pipeline.encode_prompt("a teapot", negative_prompt="blur")
    warm = pipeline.encode_prompt(prompt="a teapot", negative_prompt="blur", device=torch.device("cpu"))
    assert pipeline.calls == 1 and cache.status()["hits"] == 1
    assert torch.equal(state, torch.random.get_rng_state())
    for first, second in zip(cold, warm):
        assert torch.equal(first, second) and first.dtype == second.dtype == torch.float16
        assert first.data_ptr() != second.data_ptr()
    cold[0].fill_(99)
    warm[0].fill_(77)
    again = pipeline.encode_prompt("a teapot", negative_prompt="blur")
    assert again[0][0, 0, 0].item() == 0
    assert all(tensor.device.type == "cpu" for tensors, _ in cache._entries.values() for tensor in tensors)
    assert "teapot" not in repr(list(cache._entries))


@pytest.mark.parametrize("changed", [
    {"prompt": "other"}, {"negative_prompt": "other"}, {"prompt_2": "other"},
    {"negative_prompt_2": "other"}, {"num_images_per_prompt": 2},
    {"do_classifier_free_guidance": False}, {"clip_skip": 1},
])
def test_all_encoding_arguments_distinguish_entries(changed):
    pipeline, _ = wrapped()
    arguments = {"prompt": "teapot", "negative_prompt": "blur"}
    pipeline.encode_prompt(**arguments)
    pipeline.encode_prompt(**(arguments | changed))
    assert pipeline.calls == 2


def test_disabled_guidance_preserves_none_and_config_encoder_changes_miss():
    pipeline, cache = wrapped()
    arguments = {"prompt": "teapot", "do_classifier_free_guidance": False}
    cold = pipeline.encode_prompt(**arguments)
    warm = pipeline.encode_prompt(**arguments)
    assert cold[1] is warm[1] is cold[3] is warm[3] is None
    pipeline.config.force_zeros_for_empty_prompt = False
    pipeline.encode_prompt(**arguments)
    pipeline.text_encoder_2 = SimpleNamespace(dtype=torch.float32)
    pipeline.encode_prompt(**arguments)
    assert pipeline.calls == 3 and cache.status()["hits"] == 1


def test_explicit_embeddings_and_transient_lora_scaling_bypass_cache():
    pipeline, cache = wrapped()
    for extra in ({"prompt_embeds": torch.zeros(1)}, {"lora_scale": 0.3}):
        pipeline.encode_prompt("teapot", **extra)
        pipeline.encode_prompt("teapot", **extra)
    assert pipeline.calls == 4 and cache.status()["entries"] == 0


def test_lru_respects_both_limits_and_copies_owned_values():
    cache = caching.PreparationCache(max_entries=2, max_bytes=8)
    original = bytearray(b"1234")
    cache.put("a", original, 4, bytearray)
    original[0] = 0
    cache.put("b", b"5678", 4, bytearray)
    assert cache.get("a", bytearray) == b"1234"
    cache.put("c", b"90ab", 4, bytearray)
    assert cache.get("b", bytearray) is None
    assert cache.status()["entries"] == 2 and cache.status()["bytes"] == 8
    cache.put("large", b"012345678", 9, bytearray)
    assert cache.status()["entries"] == 2
    cache.put("d", b"1", 1, bytearray)
    assert cache.status()["entries"] == 2 and cache.status()["bytes"] == 5


def test_low_ram_discards_cache_and_reencodes_normally(monkeypatch):
    pipeline, cache = wrapped()
    pipeline.encode_prompt("teapot")
    monkeypatch.setattr(caching, "memory_headroom", lambda: 1)
    result = pipeline.encode_prompt("teapot")
    assert result[0].dtype == torch.float16
    assert pipeline.calls == 2 and cache.status()["bytes"] == 0


def test_optional_copy_failure_keeps_provider_result_but_provider_errors_propagate(monkeypatch):
    pipeline, cache = wrapped()
    monkeypatch.setattr(caching, "copy_conditioning", lambda *_: (_ for _ in ()).throw(MemoryError()))
    assert pipeline.encode_prompt("teapot")[0].numel() == 12
    assert cache.status()["entries"] == 0
    class Broken(EncoderPipeline):
        def encode_prompt(self, prompt):
            raise RuntimeError("provider failed")
    broken = Broken()
    caching.cache_sdxl_prompt_encoding(broken, cache)
    with pytest.raises(RuntimeError, match="provider failed"):
        broken.encode_prompt("teapot")


def test_hit_transfer_errors_propagate_without_retrying_encoder(monkeypatch):
    pipeline, _ = wrapped()
    pipeline.encode_prompt("teapot")
    monkeypatch.setattr(caching, "copy_conditioning", lambda *_: (_ for _ in ()).throw(RuntimeError("CUDA out of memory")))
    with pytest.raises(RuntimeError, match="CUDA out of memory"):
        pipeline.encode_prompt("teapot")
    assert pipeline.calls == 1


def test_unknown_conditioning_result_preserves_native_path():
    class Custom(EncoderPipeline):
        def encode_prompt(self, prompt):
            self.calls += 1
            return ("custom provider result", None)
    pipeline, cache = Custom(), caching.PreparationCache()
    caching.cache_sdxl_prompt_encoding(pipeline, cache)
    assert pipeline.encode_prompt("teapot") == pipeline.encode_prompt("teapot") == ("custom provider result", None)
    assert pipeline.calls == 2 and cache.status()["entries"] == 0


def test_offload_change_invalidates_conditioning(monkeypatch):
    from services import image_generation_limits, capabilities
    monkeypatch.setattr(image_generation_limits, "current_resolution_limits", lambda: {"vram_bytes": 8 * 1024 ** 3})
    monkeypatch.setattr(capabilities, "image_offload_strategy", lambda _: "model")
    manager = ImageGenerationManager()
    manager._conditioning_cache.put("test", b"1234", 4, bytes)
    manager._compel = object()
    manager._configure_wait_mode(False)
    assert manager._conditioning_cache.status()["bytes"] == 4
    manager._configure_wait_mode(True)
    assert manager._conditioning_cache.status()["bytes"] == 0 and manager._compel is None


def test_lora_change_scale_change_unload_and_reset_invalidate(monkeypatch):
    manager = ImageGenerationManager()
    manager._pipeline, manager._model_id = EncoderPipeline(), "sdxl"
    manager._pipeline.load_lora_weights = lambda *_, **__: None
    manager._pipeline.set_adapters = lambda *_, **__: None
    manager._pipeline.unload_lora_weights = lambda: None
    from services import lora_store
    monkeypatch.setattr(lora_store, "list_adapters", lambda: [
        {"id": "adapter", "base_model_id": "sdxl", "path": "unused", "filename": "unused"}])
    def fill():
        manager._conditioning_cache.put("test", b"1234", 4, bytes)
    fill()
    manager._set_lora("adapter", 0.5)
    assert manager._conditioning_cache.status()["bytes"] == 0
    fill()
    manager._set_lora("adapter", 0.5)
    assert manager._conditioning_cache.status()["bytes"] == 4
    manager._compel = object()
    manager._set_lora("adapter", 0.6)
    assert manager._conditioning_cache.status()["bytes"] == 0 and manager._compel is None
    fill()
    manager._set_lora(None, 1)
    assert manager._conditioning_cache.status()["bytes"] == 0
    fill()
    manager._unload()
    assert manager._conditioning_cache.status()["bytes"] == 0
    references.preparation_cache.put("reference", b"1234", 4, bytes)
    assert manager.reset_runtime() and references.preparation_cache.status()["bytes"] == 0


@pytest.mark.parametrize("fit", ["contain", "crop", "edge"])
def test_reference_hit_is_pixel_exact_independent_and_skips_resize(fit, monkeypatch):
    source = Image.new("RGBA", (180, 90), (255, 0, 0, 80))
    source.putpixel((0, 0), (0, 255, 0, 255))
    stream = io.BytesIO()
    source.save(stream, "PNG")
    ref = references.store_reference("source.png", stream.getvalue())["reference"]
    cold = references.prepare_reference(ref, 256, 256, fit)
    expected = cold.tobytes()
    monkeypatch.setattr(references, "_prepare_reference_content", lambda *_: pytest.fail("unexpected resize"))
    cold.paste("blue", (0, 0, 256, 256))
    warm = references.prepare_reference(ref, 256, 256, fit)
    assert warm.tobytes() == expected
    warm.paste("green", (0, 0, 256, 256))
    assert references.prepare_reference(ref, 256, 256, fit).tobytes() == expected
    assert references.reference_bytes(ref) == stream.getvalue()


@pytest.mark.parametrize("change", ["locked", "missing", "tampered"])
def test_reference_hit_rechecks_access_and_content(change, monkeypatch):
    stream = io.BytesIO()
    Image.new("RGB", (32, 32)).save(stream, "PNG")
    ref = references.store_reference("source.png", stream.getvalue())["reference"]
    references.prepare_reference(ref, 64, 64, "contain")
    if change == "locked":
        monkeypatch.setattr(image_vault, "is_locked", lambda _: True)
    else:
        monkeypatch.setattr(image_store, "get_bytes", lambda _: None if change == "missing" else (b"changed", "image/png"))
    with pytest.raises(ValueError):
        references.prepare_reference(ref, 64, 64, "contain")
    assert references.preparation_cache.status()["bytes"] == 0


def test_long_prompt_conditioning_uses_exact_cache(monkeypatch):
    manager = ImageGenerationManager()
    manager._pipeline = EncoderPipeline()
    calls = []
    def compel(prompt, negative_prompt):
        calls.append((prompt, negative_prompt))
        tensors = manager._pipeline.encode_prompt(prompt, negative_prompt=negative_prompt)
        return SimpleNamespace(embeds=tensors[0], negative_embeds=tensors[1],
                               pooled_embeds=tensors[2], negative_pooled_embeds=tensors[3])
    manager._compel = compel
    original = caching.copy_conditioning
    monkeypatch.setattr(caching, "copy_conditioning", lambda value, _: original(value, "cpu"))
    first = manager._long_prompt_embeddings("long prompt", "blur")
    second = manager._long_prompt_embeddings("long prompt", "blur")
    assert len(calls) == 1
    assert all(torch.equal(first[key], second[key]) for key in first)
    manager._long_prompt_embeddings("changed prompt", "blur")
    assert len(calls) == 2


def test_native_sdxl_denoising_pixels_equal_with_cache_on_cpu(tmp_path):
    """Exercise installed Diffusers end to end with tiny random local weights."""
    diffusers = pytest.importorskip("diffusers")
    transformers = pytest.importorskip("transformers")
    import numpy as np
    (tmp_path / "vocab.json").write_text(json.dumps({"<|startoftext|>": 0, "<|endoftext|>": 1,
                                                  "a</w>": 2, "teapot</w>": 3, "blur</w>": 4}))
    (tmp_path / "merges.txt").write_text("#version: 0.2\n")
    tokenizer = transformers.CLIPTokenizer(str(tmp_path / "vocab.json"), str(tmp_path / "merges.txt"), model_max_length=77)
    config = transformers.CLIPTextConfig(vocab_size=5, hidden_size=16, intermediate_size=32,
                                        num_hidden_layers=2, num_attention_heads=2, max_position_embeddings=77,
                                        projection_dim=16, bos_token_id=0, eos_token_id=1, pad_token_id=1)
    old_threads = torch.get_num_threads()
    torch.set_num_threads(2)
    try:
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(123)
            pipeline = diffusers.StableDiffusionXLPipeline(
                text_encoder=transformers.CLIPTextModel(config),
                text_encoder_2=transformers.CLIPTextModelWithProjection(config),
                tokenizer=tokenizer, tokenizer_2=tokenizer,
                vae=diffusers.AutoencoderKL(block_out_channels=(8, 16), in_channels=3, out_channels=3,
                                          down_block_types=("DownEncoderBlock2D", "DownEncoderBlock2D"),
                                          up_block_types=("UpDecoderBlock2D", "UpDecoderBlock2D"),
                                          latent_channels=4, norm_num_groups=4, sample_size=16),
                unet=diffusers.UNet2DConditionModel(sample_size=8, in_channels=4, out_channels=4,
                                                  layers_per_block=1, block_out_channels=(8, 16),
                                                  down_block_types=("DownBlock2D", "CrossAttnDownBlock2D"),
                                                  up_block_types=("CrossAttnUpBlock2D", "UpBlock2D"),
                                                  cross_attention_dim=32, attention_head_dim=2, norm_num_groups=4,
                                                  addition_embed_type="text_time", addition_time_embed_dim=4,
                                                  projection_class_embeddings_input_dim=40),
                scheduler=diffusers.EulerDiscreteScheduler(num_train_timesteps=100), add_watermarker=False)
            pipeline.set_progress_bar_config(disable=True)
            def generate(guidance):
                return np.asarray(pipeline(prompt="a teapot", negative_prompt="blur", width=32, height=32,
                                           num_inference_steps=2, guidance_scale=guidance,
                                           generator=torch.Generator("cpu").manual_seed(42)).images[0])
            baseline = {guidance: generate(guidance) for guidance in (5.5, 0)}
            cache = caching.PreparationCache()
            caching.cache_sdxl_prompt_encoding(pipeline, cache)
            for guidance in (5.5, 0):
                assert np.array_equal(baseline[guidance], generate(guidance))
                assert np.array_equal(baseline[guidance], generate(guidance))
            assert cache.status()["hits"] == 2 and cache.status()["misses"] == 2
    finally:
        torch.set_num_threads(old_threads)
