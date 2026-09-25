"""Native-package failures must remain local to optional capabilities."""
import builtins
import types

import pytest


@pytest.mark.parametrize("failure", [ImportError("missing"), OSError("DLL load failed"), RuntimeError("driver failed")])
def test_optional_native_failures_do_not_escape_status(monkeypatch, failure):
    from services.image_generation import ImageGenerationManager
    from services.lora_store import hardware_status
    from services.faces.insight_onnx import InsightOnnxProvider

    original = builtins.__import__
    def importing(name, *args, **kwargs):
        if name in {"torch", "onnxruntime"}:
            raise failure
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", importing)
    assert ImageGenerationManager().runtime_status()["ready"] is False
    assert hardware_status()["cuda_available"] is False
    assert InsightOnnxProvider().status().ready is False


def test_cuda_device_probe_failure_is_degraded(monkeypatch):
    import sys
    from services.image_generation import ImageGenerationManager
    def broken(_index):
        raise RuntimeError("CUDA driver error")
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(cuda=types.SimpleNamespace(
        is_available=lambda: True, get_device_name=broken)))
    assert ImageGenerationManager().runtime_status()["ready"] is False


def test_missing_knowledge_package_is_actionable(monkeypatch):
    from services import optional_dependencies, knowledge_base
    def broken(_module):
        raise OSError("DLL load failed")
    monkeypatch.setattr(optional_dependencies.importlib, "import_module", broken)
    with pytest.raises(optional_dependencies.FeatureUnavailable, match="requirements-knowledge.txt"):
        knowledge_base.list_documents()


@pytest.mark.parametrize("failure", [MemoryError(), RuntimeError("CUDA out of memory")])
def test_image_memory_failure_releases_lease_without_replaying(monkeypatch, failure):
    from services import image_generation
    from services.gpu_coordination import GpuCoordinator
    coordinator = GpuCoordinator()
    monkeypatch.setattr(image_generation, "gpu_coordinator", coordinator)
    monkeypatch.setattr(image_generation, "discover_models", lambda: [{"id": "test"}])
    manager = image_generation.ImageGenerationManager()
    calls = []
    def load(_model):
        calls.append("load")
        raise failure
    monkeypatch.setattr(manager, "_load", load)
    monkeypatch.setattr(manager, "_unload", lambda: calls.append("unload"))
    with pytest.raises(RuntimeError, match="Try a smaller image"):
        manager.generate(model_id="test", prompt="test", request_id="low-memory", negative_prompt=None,
                         width=512, height=512, steps=1, guidance_scale=5.5, seed=1)
    assert calls == ["load", "unload"]
    assert coordinator.current_owner() is None
    assert manager.active_request_id() is None
