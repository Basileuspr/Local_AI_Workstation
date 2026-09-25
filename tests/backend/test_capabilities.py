import sys
from types import SimpleNamespace

import pytest

from services import capabilities


@pytest.mark.parametrize("ram,expected", [(None, 4096), (8, 4096), (16, 4096), (24, 8192), (32, 8192), (64, 16384)])
def test_memory_aware_defaults(ram, expected):
    assert capabilities.default_context_limit(ram * capabilities.GIB if ram else None) == expected


def test_explicit_context_and_thread_settings_override_detection(monkeypatch):
    import config
    monkeypatch.setattr(capabilities, "host_resources", lambda: {"memory_total_bytes": 8 * capabilities.GIB, "logical_cpus": 2})
    monkeypatch.delenv("LAW_NUM_CTX", raising=False)
    monkeypatch.delenv("LAW_FACE_INTRA_OP_THREADS", raising=False)
    detected = config.load_settings()
    assert detected.num_ctx == 4096
    assert detected.face_intra_op_threads == 1
    monkeypatch.setenv("LAW_NUM_CTX", "12288")
    monkeypatch.setenv("LAW_FACE_INTRA_OP_THREADS", "4")
    explicit = config.load_settings()
    assert explicit.num_ctx == 12288 and explicit.face_intra_op_threads == 4


def test_capability_changes_are_independent_and_rechecked(monkeypatch):
    from services import image_generation
    from services.faces import providers
    monkeypatch.setattr(capabilities, "missing_packages", lambda names: [])
    monkeypatch.setattr(image_generation, "discover_models", lambda: [{"id": "sdxl"}])
    monkeypatch.setattr(providers, "catalog", lambda: [SimpleNamespace(ready=True, detail="Ready on CPU", device="cpu")])
    status = {"ollama": {"reachable": True}, "models": {"chat_count": 1, "embedding_ready": True},
              "knowledge_base": {"ok": True}, "runtime": {"image": {"ready": False, "error": "No CUDA"}}}
    first = capabilities.probe_capabilities(status, 4096)
    assert first["features"]["chat"]["available"]
    assert first["features"]["knowledge"]["available"]
    assert first["features"]["face_detection"]["device"] == "cpu"
    assert not first["features"]["image_generation"]["available"]
    assert not first["features"]["training"]["available"]
    status["runtime"]["image"] = {"ready": True, "device": "NVIDIA"}
    second = capabilities.probe_capabilities(status, 4096)
    assert second["features"]["image_generation"]["available"]
    assert second["features"]["training"]["available"]
    monkeypatch.setattr(image_generation, "discover_models", lambda: [])
    third = capabilities.probe_capabilities(status, 4096)
    assert not third["features"]["image_generation"]["available"]
    assert third["features"]["local_data"]["available"]


def test_training_does_not_require_generation_only_packages(monkeypatch):
    from services import image_generation
    from services.faces import providers
    monkeypatch.setattr(capabilities, "missing_packages", lambda names: [])
    monkeypatch.setattr(image_generation, "discover_models", lambda: [{"id": "sdxl"}])
    monkeypatch.setattr(providers, "catalog", lambda: [])
    status = {"runtime": {"image": {"cuda_available": True, "ready": False, "error": "compel missing"}}}
    report = capabilities.probe_capabilities(status, 4096)["features"]
    assert not report["image_generation"]["available"]
    assert report["training"]["available"]


def test_small_gpu_uses_sequential_offload_without_changing_request(monkeypatch):
    from services.image_generation import ImageGenerationManager
    calls = []
    pipeline = SimpleNamespace(enable_sequential_cpu_offload=lambda: calls.append("sequential"),
                               enable_model_cpu_offload=lambda: calls.append("model"))
    manager = ImageGenerationManager()
    manager._offload_strategy = capabilities.image_offload_strategy(4 * capabilities.GIB)
    manager._enable_offload(pipeline)
    manager._offload_strategy = capabilities.image_offload_strategy(8 * capabilities.GIB)
    manager._enable_offload(pipeline)
    assert calls == ["sequential", "model"]


def test_face_gpu_initialization_falls_back_atomically_to_cpu(monkeypatch):
    from services.faces.insight_onnx import InsightOnnxProvider
    provider = InsightOnnxProvider()
    monkeypatch.setattr(provider, "missing", lambda: [])
    calls = []
    def session(filename, options, providers):
        calls.append((filename, providers))
        if "CUDAExecutionProvider" in providers and "w600k" in filename:
            raise RuntimeError("GPU driver failed")
        return SimpleNamespace(get_providers=lambda: providers)
    monkeypatch.setitem(sys.modules, "onnxruntime", SimpleNamespace(
        get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"],
        SessionOptions=SimpleNamespace, InferenceSession=session))
    detector, recognizer = provider._sessions()
    assert detector is not None and recognizer is not None
    assert provider.device == "cpu" and not provider.uses_gpu()
    assert len(calls) == 4
    assert all(order == ["CPUExecutionProvider"] for _, order in calls[-2:])
    provider._sessions()
    assert len(calls) == 4  # No repeated driver failure once CPU works.
    assert "automatically uses CPU" in provider.status().detail


def test_face_failure_never_commits_a_partial_session(monkeypatch):
    from services.faces.insight_onnx import InsightOnnxProvider
    provider = InsightOnnxProvider()
    monkeypatch.setattr(provider, "missing", lambda: [])
    def session(filename, options, providers):
        if "w600k" in filename:
            raise RuntimeError("Invalid model")
        return object()
    monkeypatch.setitem(sys.modules, "onnxruntime", SimpleNamespace(
        get_available_providers=lambda: ["CUDAExecutionProvider", "CPUExecutionProvider"],
        SessionOptions=SimpleNamespace, InferenceSession=session))
    with pytest.raises(RuntimeError, match="Invalid model"):
        provider._sessions()
    assert provider._detector is None and provider._recognizer is None
