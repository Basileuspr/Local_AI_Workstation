"""Provider semantics with fake model/HTTP runtimes; no GPU or network use."""
import asyncio
import sys
import threading
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image, ImageDraw

from services.image_workflows import adapters
from services.image_workflows.contracts import Stage, PromptSettings
from services.image_workflows.providers import PreparedStage, ExecutionContext, WorkflowCancelled


@pytest.fixture
def request_context(tmp_path):
    source, mask = tmp_path / "source.png", tmp_path / "mask.png"
    Image.new("RGB", (32, 24), "blue").save(source)
    image = Image.new("L", (32, 24), 0)
    ImageDraw.Draw(image).rectangle((16, 0, 31, 23), fill=255)
    image.save(mask)
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    stage = Stage(id="a" * 32, operation="inpaint", model_id="test", width=256, height=256)
    request = PreparedStage(stage, PromptSettings(prompt="Test scene", seed=42, steps=4), source, mask, None, ())
    return request, ExecutionContext("job", outputs, threading.Event())


@pytest.fixture
def fake_sdxl(tmp_path, monkeypatch):
    from services import image_generation
    import torch
    calls = []
    monkeypatch.setattr(image_generation, "manager", image_generation.ImageGenerationManager())
    (tmp_path / "model_index.json").write_text('{}')
    monkeypatch.setattr(adapters, "sdxl_models", lambda: [{"id": "test", "path": str(tmp_path)}])
    monkeypatch.setattr(image_generation, "prompt_token_status", lambda *args: {
        "prompt": {"chunks_required": 1}, "negative_prompt": {"chunks_required": 1}})
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "empty_cache", lambda: calls.append("empty_cache"))
    monkeypatch.setattr(torch.cuda, "synchronize", lambda: None)
    monkeypatch.setattr(torch, "Generator", lambda *args: SimpleNamespace(manual_seed=lambda seed: seed))
    class Pipeline:
        def __init__(self):
            self.vae = SimpleNamespace(enable_slicing=lambda: None, enable_tiling=lambda: None)
        @classmethod
        def from_pretrained(cls, path, **kwargs):
            assert kwargs["local_files_only"] is True
            calls.append("load")
            return cls()
        @classmethod
        def from_pipe(cls, pipeline, **kwargs):
            result = cls()
            result.vae = pipeline.vae
            calls.append(("share", pipeline, result))
            return result
        def remove_all_hooks(self): calls.append("remove_hooks")
        def to(self, device): assert device == "cpu"
        def enable_attention_slicing(self, *args): pass
        def enable_model_cpu_offload(self): pass
        def set_progress_bar_config(self, **kwargs): pass
        def maybe_free_model_hooks(self): calls.append("offload")
        def __call__(self, **kwargs):
            calls.append(kwargs)
            kwargs["callback_on_step_end"](self, 0, 1, {})
            size = kwargs["image"].size if "image" in kwargs else (kwargs["width"], kwargs["height"])
            return SimpleNamespace(images=[Image.new("RGB", size, "red")])
    monkeypatch.setitem(sys.modules, "diffusers", SimpleNamespace(
        DiffusionPipeline=Pipeline, StableDiffusionXLInpaintPipeline=Pipeline, StableDiffusionXLImg2ImgPipeline=Pipeline))
    return calls


def test_inpaint_preserves_black_and_edits_white(request_context, fake_sdxl):
    request, context = request_context
    result = adapters.SDXLProvider().generate(request, context)
    with Image.open(result.image_paths[0]) as image:
        assert image.size == (256, 256)
        assert image.getpixel((10, 10)) == (0, 0, 255)
        assert image.getpixel((245, 10)) == (255, 0, 0)
    assert fake_sdxl[-1] == "offload"


def test_zero_strength_uses_no_inference(request_context, fake_sdxl):
    request, context = request_context
    request.stage.strength = 0
    result = adapters.SDXLProvider().generate(request, context)
    assert "load" not in fake_sdxl
    with Image.open(result.image_paths[0]) as image:
        assert image.getpixel((245, 10)) == (0, 0, 255)


def test_cancel_before_loading_never_loads_or_saves(request_context, fake_sdxl):
    request, context = request_context
    def progress(**values):
        if values.get("phase") == "Loading SDXL":
            context.cancel_event.set()
    context = ExecutionContext("job", context.output_dir, context.cancel_event, progress)
    with pytest.raises(WorkflowCancelled):
        adapters.SDXLProvider().generate(request, context)
    assert not list(context.output_dir.iterdir())
    assert fake_sdxl == []


def test_frames_share_weights_and_switch_back_to_txt2img(request_context, fake_sdxl):
    from dataclasses import replace
    from services.image_generation import manager
    request, context = request_context
    provider = adapters.SDXLProvider()
    base = replace(request, stage=request.stage.model_copy(update={"operation": "txt2img"}), source=None, mask=None)
    provider.generate(base, context)
    for operation in ("img2img", "inpaint", "img2img", "txt2img"):
        current = replace(request, stage=request.stage.model_copy(update={"operation": operation}),
                          source=None if operation == "txt2img" else request.source,
                          mask=request.mask if operation == "inpaint" else None)
        provider.generate(current, context)
    assert fake_sdxl.count("load") == 1
    shared = [call for call in fake_sdxl if isinstance(call, tuple) and call[0] == "share"]
    assert len(shared) == 2
    assert all(base.vae is view.vae for _, base, view in shared)
    assert manager._active_pipeline is manager._pipeline
    manager.unload_for_training()
    assert manager._pipeline is None and manager._workflow_pipelines == {} and manager._active_pipeline is None


def test_ollama_cancel_closes_stream_and_awaits_unload(request_context, monkeypatch):
    request, context = request_context
    entered, closed, unloading, release = (asyncio.Event() for _ in range(4))
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            entered.set()
            yield b'{"message":{"content":"A blue rectangle"}}\n'
            await asyncio.Event().wait()
        async def aclose(self):
            closed.set()
    async def handler(req):
        if req.url.path == "/api/show":
            return httpx.Response(200, json={"capabilities": ["vision"]})
        if req.url.path == "/api/chat":
            return httpx.Response(200, stream=Stream())
        assert req.url.path == "/api/generate"
        assert closed.is_set()
        unloading.set()
        await release.wait()
        return httpx.Response(200, json={"done": True})
    client_type = httpx.AsyncClient
    monkeypatch.setattr(adapters.httpx, "AsyncClient", lambda **kwargs:
        client_type(transport=httpx.MockTransport(handler), **kwargs))
    async def scenario():
        task = asyncio.create_task(adapters.OllamaProvider().execute(request, context))
        await asyncio.wait_for(entered.wait(), 2)
        context.cancel_event.set()
        task.cancel()
        await asyncio.wait_for(unloading.wait(), 2)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(task, 2)
    asyncio.run(scenario())
