"""Generation output handoff, memory retention, and Compel offload regression."""
import asyncio
import sys
import threading
from types import SimpleNamespace

import pytest
from PIL import Image

from services import image_generation
from services.gpu_coordination import GpuCoordinator
from services.request_queue import RequestQueue
from test_image_generation_cancel import configure_manager, generation_options


def test_compel_uses_execution_device_even_when_encoder_weights_are_meta(monkeypatch):
    class Encoder:
        device = "meta"
        dtype = "float16"
        def __call__(self, value):
            return value

    encoders = [Encoder(), Encoder()]
    class Compel:
        def __init__(self, pipeline, device):
            self.compel_1, self.compel_2 = [SimpleNamespace(conditioning_provider=
                SimpleNamespace(text_encoder=encoder)) for encoder in encoders]

        def __call__(self, prompt, negative_prompt):
            for part in (self.compel_1, self.compel_2):
                encoder = part.conditioning_provider.text_encoder
                # Compel 2.x uses this device AFTER forward to place weighted
                # embeddings, before concatenating negative/empty padding.
                assert encoder("conditioning") == "conditioning"
                assert encoder.device == "cuda"
                assert encoder.dtype == "float16"
            return SimpleNamespace(embeds=1, pooled_embeds=2, negative_embeds=3, negative_pooled_embeds=4)

    monkeypatch.setitem(sys.modules, "compel", SimpleNamespace(CompelForSDXL=Compel))
    manager = image_generation.ImageGenerationManager()
    manager._pipeline = object()
    for _ in range(2):
        assert manager._long_prompt_embeddings("long positive", "short negative")["negative_prompt_embeds"] == 3
    assert all(encoder.device == "meta" for encoder in encoders)


@pytest.mark.parametrize("available_gib,retained", [(16, True), (2, False)])
def test_chat_handoff_frees_gpu_and_retains_only_with_ram_headroom(monkeypatch, available_gib, retained):
    import psutil
    calls = []
    pipeline = SimpleNamespace(remove_all_hooks=lambda: calls.append("detach"),
                               to=lambda device: calls.append(device))
    manager = image_generation.ImageGenerationManager()
    manager._pipeline = manager._active_pipeline = pipeline
    manager._model_id = "local"
    manager._compel = object()
    monkeypatch.setattr(psutil, "virtual_memory", lambda: SimpleNamespace(
        available=available_gib * 1024**3, total=32 * 1024**3))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(
        empty_cache=lambda: calls.append("free_vram"), is_available=lambda: True)))
    manager.park_for_chat()
    assert calls == ["detach", "cpu", "free_vram"]
    assert (manager._pipeline is pipeline) == retained
    assert manager._compel is None and manager._active_pipeline is None
    if retained:
        manager._load({"id": "local"})  # no reload/import or model file access
        assert manager._pipeline is pipeline
    manager.unload_for_training()
    assert manager._pipeline is None


def test_output_overlap_is_bounded_and_cancel_does_not_release_next_gpu():
    gpu = GpuCoordinator()
    queue = RequestQueue(gpu)
    first = queue.enqueue("image", "first")
    second = queue.enqueue("image", "second")
    third = queue.enqueue("image", "third")
    for job in (first, second):
        assert queue.try_start(job)
        assert gpu.acquire(job.owner)
        queue.release_gpu_for_output(job)
        assert job.status == "running" and job.stage == "saving"
    assert not queue.try_start(third)
    queue.finish(first)
    assert queue.try_start(third)
    asyncio.run(queue.cancel(second))
    queue.finish(second)
    assert gpu.current_owner() == third.owner
    assert second.status == "cancelled"
    queue.finish(third)


def test_next_inference_runs_while_previous_png_is_saving(monkeypatch, tmp_path):
    from routes import image_generation as routes
    from services import image_store

    saving, resume_save, second_inference = threading.Event(), threading.Event(), threading.Event()
    calls = []
    class Pipeline:
        def __call__(self, **kwargs):
            calls.append(kwargs["generator"].seed)
            if len(calls) == 2:
                assert saving.is_set() and not resume_save.is_set()
                second_inference.set()
            return SimpleNamespace(images=[Image.new("RGB", (8, 8), "blue")])

    manager, _ = configure_manager(monkeypatch, tmp_path, Pipeline())
    gpu = GpuCoordinator()
    queue = RequestQueue(gpu)
    monkeypatch.setattr(image_generation, "gpu_coordinator", gpu)
    monkeypatch.setattr(routes, "manager", manager)
    monkeypatch.setattr(routes, "queue", queue)
    monkeypatch.setattr(routes, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(image_store, "put_bytes", lambda data: "blob:test")
    async def prepare(_): pass
    monkeypatch.setattr(routes, "prepare_runtime", prepare)
    original_save = Image.Image.save
    def save(image, path, **kwargs):
        if not saving.is_set():
            saving.set()
            assert resume_save.wait(5)
        return original_save(image, path, **kwargs)
    monkeypatch.setattr(Image.Image, "save", save)
    class Client:
        async def is_disconnected(self): return False

    async def scenario():
        tasks = [asyncio.create_task(routes.generate_image(routes.ImageGenerationRequest(
            **{**generation_options(f"overlap-{index}"), "seed": index}), Client())) for index in range(2)]
        try:
            async with asyncio.timeout(5):
                while not second_inference.is_set():
                    await asyncio.sleep(.01)
            assert not tasks[0].done()
        finally:
            resume_save.set()
        results = await asyncio.gather(*tasks)
        assert [result["seed"] for result in results] == [0, 1]
        assert all((tmp_path / result["filename"]).is_file() for result in results)
        assert all(job.status == "completed" for job in queue.jobs)
        assert queue.active is None and gpu.current_owner() is None
    asyncio.run(scenario())


@pytest.mark.parametrize("failure", [RuntimeError("device meta mismatch"), image_generation.ImageGenerationCancelled("stopped")])
def test_failed_inference_discards_runtime_before_releasing_gpu(monkeypatch, tmp_path, failure):
    class Pipeline:
        def __call__(self, **_kwargs): raise failure
    manager, gpu = configure_manager(monkeypatch, tmp_path, Pipeline())
    with pytest.raises(type(failure)):
        manager.generate(**generation_options())
    assert manager._pipeline is None and manager._active_pipeline is None
    assert gpu.current_owner() is None
    assert not list(tmp_path.iterdir())


def test_failed_png_save_removes_partial_without_unloading_next_runtime(monkeypatch, tmp_path):
    class Pipeline:
        def __call__(self, **kwargs):
            return SimpleNamespace(images=[Image.new("RGB", (8, 8))])
    manager, gpu = configure_manager(monkeypatch, tmp_path, Pipeline())
    next_pipeline = object()
    def handed_off():
        assert gpu.current_owner() is None
        manager._pipeline = next_pipeline
        gpu.acquire("next-job")
    def broken_save(image, path, **kwargs):
        path.write_bytes(b"partial png")
        raise RuntimeError("encoder failed")
    monkeypatch.setattr(Image.Image, "save", broken_save)
    with pytest.raises(RuntimeError, match="encoder failed"):
        manager.generate(**generation_options(), on_gpu_complete=handed_off)
    assert manager._pipeline is next_pipeline
    assert gpu.current_owner() == "next-job"
    assert not list(tmp_path.iterdir())
