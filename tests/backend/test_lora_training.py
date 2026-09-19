import io
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

from services import image_generation, lora_store, lora_training
from services.gpu_coordination import GpuCoordinator


def _image_bytes():
    image = Image.new("RGB", (96, 96), color="purple")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_start_failure_releases_gpu_and_marks_project_failed(lora_paths, monkeypatch):
    project = lora_store.create_project(
        "Character",
        trigger_word="charx",
        base_model_id="local-sdxl",
        training_goal="character_identity",
    )
    lora_store.add_images(project["id"], [("character.png", _image_bytes())])
    monkeypatch.setattr(lora_store, "hardware_status", lambda: {
        "cuda_available": True,
        "device": "Test GPU",
        "available_vram_gib": 12,
        "total_vram_gib": 12,
    })
    coordinator = GpuCoordinator()
    monkeypatch.setattr(lora_training, "gpu_coordinator", coordinator)
    monkeypatch.setattr(image_generation.manager, "unload_for_training", lambda: None)
    def fail_spawn(command, **kwargs):
        assert command[:3] == [sys.executable, "-m", "services.lora_worker"]
        assert Path(kwargs["cwd"]) == Path(lora_training.__file__).parents[1]
        raise OSError("spawn failed")

    monkeypatch.setattr(lora_training.subprocess, "Popen", fail_spawn)
    manager = lora_training.LoRATrainingManager()

    with pytest.raises(ValueError, match="Could not start"):
        manager.start(project["id"], [{"id": "local-sdxl", "name": "Local SDXL"}])

    assert coordinator.current_owner() is None
    assert not lora_store.TRAINING_LOCK_PATH.exists()
    training = lora_store.get_project(project["id"])["training"]
    assert training["status"] == "failed"
    assert "spawn failed" in training["error"]


def test_worker_module_starts_without_training():
    result = subprocess.run(
        [sys.executable, "-m", "services.lora_worker", "--help"],
        cwd=Path(lora_training.__file__).parents[1],
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "--project" in result.stdout


def test_cancel_terminates_child_and_cleans_only_its_cache(lora_paths, monkeypatch):
    project = lora_store.create_project("Cancel test", training_goal="style")
    project_id, run_id = project["id"], "test-run"
    run_dir = lora_store.RUNS_DIR / project_id / run_id
    cache = run_dir / "input-cache-test"
    cache.mkdir(parents=True)
    (cache / "0.pt").write_bytes(b"cached input")
    checkpoint = run_dir / "weights.partial"
    checkpoint.mkdir()
    coordinator = GpuCoordinator()
    coordinator.acquire("lora:test-run")
    monkeypatch.setattr(lora_training, "gpu_coordinator", coordinator)
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        stdout=subprocess.PIPE, text=True,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )
    manager = lora_training.LoRATrainingManager()
    manager._process = process
    manager._project_id = project_id
    manager._run_id = run_id
    manager._gpu_owner = "lora:test-run"
    try:
        manager.cancel(project_id)
        process.wait(timeout=10)
        manager._watch(process, project_id, run_id)
        assert lora_store.get_project(project_id)["training"]["status"] == "cancelled"
        assert coordinator.current_owner() is None
        assert not cache.exists()
        assert checkpoint.exists()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
