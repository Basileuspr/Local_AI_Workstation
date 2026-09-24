import sys
from types import SimpleNamespace

import pytest

from services import image_generation


class FakeCuda:
    def empty_cache(self):
        return None

    def reset_peak_memory_stats(self):
        return None

    def synchronize(self):
        return None

    def max_memory_allocated(self):
        return 123


class FakeGenerator:
    def __init__(self, device):
        self.device = device

    def manual_seed(self, seed):
        self.seed = seed
        return self


class FakeGpuCoordinator:
    def __init__(self):
        self.owner = None

    def acquire(self, owner):
        self.owner = owner
        return True

    def release(self, owner):
        if self.owner == owner:
            self.owner = None
            return True
        return False

    def current_owner(self):
        return self.owner


def configure_manager(monkeypatch, tmp_path, pipeline):
    manager = image_generation.ImageGenerationManager()
    coordinator = FakeGpuCoordinator()
    fake_torch = SimpleNamespace(cuda=FakeCuda(), Generator=FakeGenerator)

    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setattr(image_generation, "gpu_coordinator", coordinator)
    monkeypatch.setattr(image_generation, "OUTPUT_DIR", tmp_path)
    monkeypatch.setattr(
        image_generation,
        "discover_models",
        lambda: [{"id": "local", "name": "Local", "path": "unused"}],
    )
    monkeypatch.setattr(
        image_generation,
        "prompt_token_status",
        lambda *_args: {
            "prompt": {"chunks_required": 1},
            "negative_prompt": {"chunks_required": 1},
            "long_prompt_max_tokens": 300,
        },
    )
    def load(_model):
        manager._pipeline = manager._active_pipeline = pipeline
    monkeypatch.setattr(manager, "_load", load)
    return manager, coordinator


def generation_options(request_id="image-request-1"):
    return {
        "request_id": request_id,
        "model_id": "local",
        "prompt": "test image",
        "negative_prompt": "",
        "width": 512,
        "height": 512,
        "steps": 12,
        "guidance_scale": 5.5,
        "seed": 7,
    }


@pytest.mark.parametrize("previous_lora", [None, "previous-adapter"])
def test_base_model_generation_never_requires_lora_discovery(monkeypatch, tmp_path, previous_lora):
    from PIL import Image
    from services import lora_store

    class Pipeline:
        active_lora = previous_lora
        unloads = 0

        def unload_lora_weights(self):
            self.active_lora = None
            self.unloads += 1

        def __call__(self, **kwargs):
            assert self.active_lora is None
            return SimpleNamespace(images=[Image.new("RGB", (8, 8))])

    def unavailable():
        pytest.fail("Base-model generation must not discover or load a LoRA")

    monkeypatch.setattr(lora_store, "list_adapters", unavailable)
    pipeline = Pipeline()
    manager, coordinator = configure_manager(monkeypatch, tmp_path, pipeline)
    manager._lora_id = previous_lora
    manager._workflow_pipelines["cached"] = object()
    result = manager.generate(**generation_options())
    assert (tmp_path / result["filename"]).is_file()
    assert manager._lora_id is None
    assert pipeline.unloads == (1 if previous_lora else 0)
    if previous_lora:
        assert manager._workflow_pipelines == {}
    assert coordinator.current_owner() is None


def test_cancel_reaches_the_diffusers_step_callback(monkeypatch, tmp_path):
    holder = {}

    class Pipeline:
        def __call__(self, **kwargs):
            callback = kwargs["callback_on_step_end"]
            holder["manager"].cancel("image-request-1")
            callback(self, 0, None, {})
            pytest.fail("cancel callback must interrupt the upstream pipeline")

    manager, coordinator = configure_manager(monkeypatch, tmp_path, Pipeline())
    holder["manager"] = manager

    with pytest.raises(image_generation.ImageGenerationCancelled):
        manager.generate(**generation_options())

    assert manager.active_request_id() is None
    assert manager.generation_progress("image-request-1") is None
    assert coordinator.current_owner() is None


@pytest.mark.parametrize("steps,guidance", [(12, 5.5), (200, 30)])
def test_progress_tracks_real_steps_and_cleans_up(monkeypatch, tmp_path, steps, guidance):
    from PIL import Image
    holder = {}
    observed = []

    class Pipeline:
        def __call__(self, **kwargs):
            assert kwargs["guidance_scale"] == guidance
            for step in range(kwargs["num_inference_steps"]):
                kwargs["callback_on_step_end"](self, step, None, {})
                observed.append(holder["manager"].generation_progress("image-request-1"))
            return SimpleNamespace(images=[Image.new("RGB", (8, 8))])

    manager, coordinator = configure_manager(monkeypatch, tmp_path, Pipeline())
    holder["manager"] = manager
    assert manager.generation_progress("other-request") is None
    result = manager.generate(**{**generation_options(), "steps": steps, "guidance_scale": guidance})
    assert [item["step"] for item in observed] == list(range(1, steps + 1))
    assert all(item["total_steps"] == steps for item in observed)
    assert observed[-1]["phase"] == "Decoding image"
    assert all(item["elapsed_seconds"] >= 0 for item in observed)
    assert "started" not in observed[0]
    assert result["generation_seconds"] >= 0
    assert manager.generation_progress("image-request-1") is None
    assert coordinator.current_owner() is None


def test_progress_http_remains_available_during_generation(monkeypatch, tmp_path):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from PIL import Image
    from routes import image_generation as routes

    reached_step, resume = threading.Event(), threading.Event()

    class Pipeline:
        def __call__(self, **kwargs):
            kwargs["callback_on_step_end"](self, 0, None, {})
            reached_step.set()
            assert resume.wait(timeout=10)
            return SimpleNamespace(images=[Image.new("RGB", (8, 8))])

    manager, _ = configure_manager(monkeypatch, tmp_path, Pipeline())
    monkeypatch.setattr(routes, "manager", manager)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client, ThreadPoolExecutor(max_workers=1) as executor:
        work = executor.submit(manager.generate, **generation_options())
        try:
            assert reached_step.wait(timeout=5)
            response = client.get("/image-generation/progress/image-request-1")
            assert response.status_code == 200
            assert response.json()["progress"]["step"] == 1
            assert client.get("/image-generation/progress/unknown").json() == {"progress": None}
        finally:
            resume.set()
        work.result(timeout=5)
        assert client.get("/image-generation/progress/image-request-1").json() == {"progress": None}


def test_reset_cancels_active_request_then_unloads_pipeline(monkeypatch):
    manager = image_generation.ImageGenerationManager()
    manager._pipeline = object()
    manager._model_id = "local"
    event = image_generation.threading.Event()
    manager._cancel_events["active"] = event
    manager._active_request_id = "active"

    assert manager.cancel_all() == 1
    assert event.is_set()
    assert manager.reset_runtime(timeout=0.1) is True
    assert manager._pipeline is None
    assert manager.runtime_status()["loaded_model"] is None
