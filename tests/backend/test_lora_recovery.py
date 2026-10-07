import asyncio
import errno
import json
import os
import subprocess
import sys
from pathlib import Path

import psutil
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import lora
from services import lora_recovery, lora_store, lora_training, request_queue
from services.gpu_coordination import GpuCoordinator
from services.request_queue import RequestQueue


@pytest.fixture
def recovery(lora_paths, monkeypatch):
    coordinator = GpuCoordinator()
    manager = lora_training.LoRATrainingManager()
    queue = RequestQueue(coordinator)
    monkeypatch.setattr(lora_training, "gpu_coordinator", coordinator)
    monkeypatch.setattr(lora, "manager", manager)
    monkeypatch.setattr(lora, "queue", queue)
    monkeypatch.setattr(request_queue, "queue", queue)
    monkeypatch.setattr(lora_recovery, "find_workers", lambda: ([], False))
    return manager, coordinator


def interrupted_project(status="running", **training):
    project = lora_store.create_project("Restart test", training_goal="style")
    lora_store.update_training(project["id"], {"status": status, "run_id": "old-run", "step": 17,
        "logs": ["Original progress"], **training})
    lora_store._atomic_write(lora_store.TRAINING_LOCK_PATH, {"project_id": project["id"], "run_id": "old-run"})
    return project


@pytest.mark.parametrize("status", ["queued", "starting", "running", "cancelling"])
def test_startup_persists_all_dead_states_and_unblocks_edits(recovery, status):
    manager, coordinator = recovery
    project = interrupted_project(status)
    checkpoint = lora_store.RUNS_DIR / project["id"] / "old-run" / "weights" / "checkpoint.safetensors"
    checkpoint.parent.mkdir(parents=True)
    checkpoint.write_bytes(b"keep checkpoint")
    dataset = lora_store._project_dir(project["id"]) / "dataset" / "originals" / "original.png"
    dataset.write_bytes(b"keep original")
    adapter = {"id": "older-adapter", "path": "preserved"}
    lora_store.register_adapter(project["id"], adapter)
    lora_store.update_training(project["id"], {"status": status})

    app = FastAPI()
    app.include_router(lora.router)
    with TestClient(app) as client:
        saved = client.get(f"/lora/projects/{project['id']}/training").json()
        assert saved["status"] == "interrupted"
        assert saved["step"] == 17
        assert saved["logs"][0] == "Original progress"
        assert "new run" in saved["error"]
        assert not lora_store.TRAINING_LOCK_PATH.exists()
        assert coordinator.current_owner() is None
        disk = json.loads(lora_store._project_path(project["id"]).read_text())
        assert disk["training"]["status"] == "interrupted"
        assert disk["adapter"] == adapter
        assert lora_store.update_project(project["id"], {"name": "Editable again"})["name"] == "Editable again"
        assert manager.reconcile_restarted_runs()["recovered"] == []
    assert dataset.read_bytes() == b"keep original"
    assert checkpoint.read_bytes() == b"keep checkpoint"


def test_saved_completion_is_reattached_instead_of_marked_interrupted(recovery, tmp_path):
    manager, _ = recovery
    project = interrupted_project()
    source = tmp_path / "finished-model"
    source.mkdir()
    (source / "adapter.safetensors").write_bytes(b"finished weights")
    adapter = lora_store.publish_completion(project["id"], run_id="old-run", adapter_id="a" * 32, model_source=source)
    before = {path: path.read_bytes() for path in Path(adapter["complete_path"]).rglob("*") if path.is_file()}
    manager.reconcile_restarted_runs()
    saved = lora_store.get_project(project["id"])
    assert saved["training"]["status"] == "completed"
    assert saved["training"]["error"] is None
    assert saved["adapter"]["id"] == adapter["id"]
    assert all(path.read_bytes() == content for path, content in before.items())


@pytest.mark.parametrize("status", ["queued", "running"])
def test_live_orphan_holds_gpu_until_deliberate_recovery(recovery, monkeypatch, status):
    manager, coordinator = recovery
    project = interrupted_project(status)
    process = type("Worker", (), {"pid": 123})()
    workers = [(process, project["id"], "old-run")]
    monkeypatch.setattr(lora_recovery, "find_workers", lambda: (list(workers), False))
    stopped = []
    def stop(child, project_id, run_id):
        assert coordinator.current_owner() == manager._recovery_owner
        assert (child, project_id, run_id) == workers[0]
        stopped.append(child.pid)
        workers.clear()
    monkeypatch.setattr(lora_recovery, "stop_worker", stop)
    manager.reconcile_restarted_runs()
    assert not stopped
    assert manager.is_active()
    assert lora_store.TRAINING_LOCK_PATH.exists()
    assert lora.training_status(project["id"])["recovery_required"]
    assert lora_store.get_project(project["id"])["training"]["status"] == status
    with pytest.raises(ValueError, match="training is active"):
        lora_store.update_project(project["id"], {"name": "Unsafe"})
    assert not coordinator.acquire("image-generation")
    result = asyncio.run(lora.recover_training(project["id"]))
    assert stopped == [123]
    assert result["status"] == "interrupted"
    assert not manager.is_active()
    assert not lora_store.TRAINING_LOCK_PATH.exists()
    assert coordinator.acquire("image-generation")
    coordinator.release("image-generation")


def test_unverifiable_ownership_never_unlocks_or_stops_a_process(recovery, monkeypatch):
    manager, coordinator = recovery
    project = interrupted_project()
    monkeypatch.setattr(lora_recovery, "find_workers", lambda: ([], True))
    manager.reconcile_restarted_runs()
    with pytest.raises(ValueError, match="could not be verified"):
        manager.reconcile_restarted_runs(project["id"])
    assert lora_store.get_project(project["id"])["training"]["status"] == "running"
    assert coordinator.current_owner() == manager._recovery_owner
    assert lora_store.TRAINING_LOCK_PATH.exists()


def test_disk_full_keeps_retryable_state_and_lock(recovery, monkeypatch):
    manager, _ = recovery
    project = interrupted_project()
    original = lora_store._save
    def full(_project):
        raise OSError(errno.ENOSPC, "No space left")
    monkeypatch.setattr(lora_store, "_save", full)
    with pytest.raises(OSError):
        manager.reconcile_restarted_runs()
    assert lora_store.TRAINING_LOCK_PATH.exists()
    assert lora_store.get_project(project["id"])["training"]["status"] == "running"
    status = lora.training_status(project["id"])
    assert status["recovery_required"] and "Retry recovery" in status["error"]
    monkeypatch.setattr(lora_store, "_save", original)
    manager.reconcile_restarted_runs()
    assert lora_store.get_project(project["id"])["training"]["status"] == "interrupted"
    assert not lora_store.TRAINING_LOCK_PATH.exists()


def test_monitor_failure_stops_child_and_recovers_after_disk_failure(recovery, monkeypatch):
    manager, coordinator = recovery
    project = interrupted_project()
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], stdout=subprocess.PIPE, text=True,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    manager._process, manager._project_id, manager._run_id = child, project["id"], "old-run"
    manager._gpu_owner = "lora:old-run"
    coordinator.acquire(manager._gpu_owner)
    original_save = lora_store._save
    def full(_project):
        raise OSError(errno.ENOSPC, "No space left")
    class BrokenOutput:
        def __iter__(self):
            raise OSError("Training output broke")
    original_stdout = child.stdout
    child.stdout = BrokenOutput()
    monkeypatch.setattr(lora_store, "_save", full)
    try:
        manager._watch(child, project["id"], "old-run")
        assert child.poll() is not None
        assert coordinator.current_owner() is None
        assert not manager.is_run_pending("old-run")
        assert lora_store.TRAINING_LOCK_PATH.exists()
        monkeypatch.setattr(lora_store, "_save", original_save)
        manager.reconcile_restarted_runs()
        assert lora_store.get_project(project["id"])["training"]["status"] == "interrupted"
        assert not lora_store.TRAINING_LOCK_PATH.exists()
    finally:
        original_stdout.close()
        if child.poll() is None:
            child.kill()
            child.wait(timeout=10)


def test_current_queue_and_monitor_ownership_are_preserved(recovery):
    manager, _ = recovery
    project = interrupted_project()
    job = request_queue.queue.enqueue("training", "current queue", project_id=project["id"])
    manager.reconcile_restarted_runs()
    assert lora_store.get_project(project["id"])["training"]["status"] == "running"
    request_queue.queue.finish(job)
    manager._project_id, manager._run_id = project["id"], "old-run"
    manager.reconcile_restarted_runs()
    assert lora_store.get_project(project["id"])["training"]["status"] == "running"


def test_process_identity_requires_exact_module_project_and_run(lora_paths):
    project = lora_store.create_project("Identity", training_goal="style")
    command = [sys.executable, "-m", "services.lora_worker", "--project", str(lora_store._project_path(project["id"])), "--run-id", "run"]
    assert lora_recovery.worker_identity(command) == (project["id"], "run")
    assert lora_recovery.worker_identity([sys.executable, "-c", " ".join(command)]) is None
    assert lora_recovery.worker_identity([*command[:-1], ""]) is None
    command[4] = str(lora_paths.parent / "other-app" / project["id"] / "project.json")
    assert lora_recovery.worker_identity(command) is None


@pytest.mark.parametrize("reused", [False, True])
def test_reused_pid_does_not_identify_or_terminate_unrelated_process(lora_paths, monkeypatch, reused):
    project = lora_store.create_project("Reused PID", training_goal="style")
    current = psutil.Process()
    lora_store._atomic_write(lora_store.TRAINING_LOCK_PATH, {"project_id": project["id"], "run_id": "old",
        "worker_pid": current.pid, "worker_created_at": current.create_time() - (100 if reused else 0)})
    monkeypatch.setattr(psutil, "process_iter", lambda: iter([current]))
    assert lora_recovery.find_workers() == ([], False)


@pytest.mark.parametrize("name,blocked", [("python.exe", True), ("System", False)])
def test_legacy_lock_fails_closed_for_inaccessible_python_commands(lora_paths, monkeypatch, name, blocked):
    interrupted_project()
    class InaccessibleProcess:
        pid = os.getpid() + 1
        def cmdline(self):
            raise psutil.AccessDenied(self.pid)
        def name(self):
            return name
    monkeypatch.setattr(psutil, "process_iter", lambda: iter([InaccessibleProcess()]))
    assert lora_recovery.find_workers() == ([], blocked)


def test_damaged_lock_is_reconciled_by_command_discovery(lora_paths, monkeypatch):
    manager = lora_training.LoRATrainingManager()
    coordinator = GpuCoordinator()
    monkeypatch.setattr(lora_training, "gpu_coordinator", coordinator)
    monkeypatch.setattr(request_queue, "queue", RequestQueue(coordinator))
    current = psutil.Process()
    monkeypatch.setattr(psutil, "process_iter", lambda: iter([current]))
    project = interrupted_project()
    lora_store.TRAINING_LOCK_PATH.write_text('{broken')
    manager.reconcile_restarted_runs()
    assert lora_store.get_project(project["id"])["training"]["status"] == "interrupted"
    assert not lora_store.TRAINING_LOCK_PATH.exists()


def test_verified_worker_exit_before_recovery_releases_reservation(recovery, monkeypatch):
    manager, coordinator = recovery
    project = interrupted_project()
    workers = [(type("Worker", (), {"pid": 123})(), project["id"], "old-run")]
    monkeypatch.setattr(lora_recovery, "find_workers", lambda: (list(workers), False))
    manager.reconcile_restarted_runs()
    workers.clear()
    assert lora.training_status(project["id"])["status"] == "interrupted"
    assert coordinator.current_owner() is None


def test_dead_run_can_be_submitted_again_through_http(recovery, monkeypatch):
    project = interrupted_project()
    monkeypatch.setattr(lora_store, "validate_project", lambda *args: {"valid": True, "errors": []})
    monkeypatch.setattr(lora, "discover_models", lambda: [])
    request_queue.queue.paused = True
    app = FastAPI()
    app.include_router(lora.router)
    with TestClient(app) as client:
        assert lora_store.get_project(project["id"])["training"]["status"] == "interrupted"
        response = client.post(f"/lora/projects/{project['id']}/train")
        assert response.status_code == 202
        assert response.json()["status"] == "queued"
        assert client.post(f"/lora/projects/{project['id']}/cancel").status_code == 200


def test_backend_death_with_real_synthetic_orphan(lora_paths, tmp_path, monkeypatch):
    # No models/CUDA: a disposable module has the same invocation contract as
    # the worker. Its parent exits abruptly, leaving a real child to reconcile.
    coordinator = GpuCoordinator()
    monkeypatch.setattr(lora_training, "gpu_coordinator", coordinator)
    project = interrupted_project()
    fixture_root = tmp_path / "synthetic-backend"
    package = fixture_root / "services"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("")
    (package / "lora_worker.py").write_text("import time\ntime.sleep(120)\n")
    parent = fixture_root / "parent.py"
    parent.write_text("""import json, os, psutil, subprocess, sys
from pathlib import Path
project, lock = sys.argv[1:]
child = subprocess.Popen([sys.executable, '-m', 'services.lora_worker', '--project', project, '--run-id', 'old-run'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
Path(lock).write_text(json.dumps({'project_id': Path(project).parent.name, 'run_id': 'old-run', 'worker_pid': child.pid, 'worker_created_at': psutil.Process(child.pid).create_time()}))
os._exit(17)
""")
    result = subprocess.run([sys.executable, str(parent), str(lora_store._project_path(project["id"])), str(lora_store.TRAINING_LOCK_PATH)],
        cwd=fixture_root, capture_output=True, text=True, timeout=15,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
    assert result.returncode == 17, result.stderr
    record = json.loads(lora_store.TRAINING_LOCK_PATH.read_text())
    child = psutil.Process(record["worker_pid"])
    manager = lora_training.LoRATrainingManager()
    try:
        manager.reconcile_restarted_runs()
        assert lora_store.get_project(project["id"])["training"]["recovery_required"]
        assert not coordinator.acquire("image-generation")
        manager.reconcile_restarted_runs(project["id"])
        assert not child.is_running()
        assert coordinator.current_owner() is None
        assert lora_store.get_project(project["id"])["training"]["status"] == "interrupted"
    finally:
        workers, _ = lora_recovery.find_workers()
        for process, project_id, run_id in workers:
            lora_recovery.stop_worker(process, project_id, run_id)
