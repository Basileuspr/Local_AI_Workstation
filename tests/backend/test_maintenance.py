import asyncio
import io
import json
from pathlib import Path
import zipfile

import pytest
import maintenance as service


@pytest.fixture
def data(tmp_path):
    root = tmp_path / "app-data"
    for group in service.CATEGORIES:
        directory = root / group
        directory.mkdir(parents=True)
        (directory / "private-name.txt").write_text("PRIVATE CONTENT MUST NEVER ENTER ZIP")
    (root / "memory.db").write_bytes(b"private database")
    (root / "prompt_index.json").write_text("private prompts")
    (root / "image_library" / "index.json").write_text(json.dumps({"tags": [{"id": "tag1", "name": "My button"}], "images": [{"caption": "private"}]}))
    return root


def exported(data):
    return service.export_inventory(data.parent / "inventory.zip", data)


def test_inventory_zip_contains_only_aggregate_metadata(data):
    result = exported(data)
    with zipfile.ZipFile(result["archive"]) as archive:
        assert set(archive.namelist()) == {"inventory.json", "README.txt"}
        text = " ".join(archive.read(name).decode() for name in archive.namelist())
        for private in ["PRIVATE CONTENT", "private-name", "My button", "private database", str(data)]:
            assert private not in text
        report = json.loads(archive.read("inventory.json"))
        assert report["content_backup"] is False
        assert report["inventory"]["Chats"]["files"] == 1
    assert (data / "memory.db").exists()


def test_reset_clears_all_data_including_vault_recovery_training_and_tags(data):
    result = exported(data)
    outside = data.parent / "original.png"
    outside.write_bytes(b"external original")
    service.reset_data(result["archive"], result["sha256"], "RESET", data)
    assert list(data.iterdir()) == []
    assert outside.read_bytes() == b"external original"
    assert Path(result["archive"]).exists()


@pytest.mark.parametrize("confirmation", [None, "", "reset", "DELETE"])
def test_exact_confirmation_required_without_any_mutation(data, confirmation):
    result = exported(data)
    with pytest.raises(ValueError, match="Type RESET"):
        service.reset_data(result["archive"], result["sha256"], confirmation, data)
    assert (data / "memory.db").exists()
    assert not (data / service.MARKER).exists()


def test_refuses_changed_archive_before_deletion(data):
    result = exported(data)
    Path(result["archive"]).write_bytes(b"tampered")
    with pytest.raises(ValueError, match="changed"):
        service.reset_data(result["archive"], result["sha256"], "RESET", data)
    assert (data / "memory.db").exists()


def test_archive_cannot_be_inside_data_or_overwrite_existing_file(data):
    with pytest.raises(ValueError, match="outside"):
        service.export_inventory(data / "inventory.zip", data)
    existing = data.parent / "existing.zip"
    existing.write_bytes(b"keep")
    with pytest.raises(ValueError, match="overwritten"):
        service.export_inventory(existing, data)
    assert existing.read_bytes() == b"keep"


@pytest.mark.parametrize("path", [Path.home(), service.PROJECT_ROOT, service.PROJECT_ROOT.parent, Path(service.PROJECT_ROOT.anchor), service.settings.models_dir])
def test_protected_roots_rejected(path):
    with pytest.raises(ValueError): service.checked_root(path)


def test_linked_target_fails_before_any_deletion(data, monkeypatch):
    result = exported(data)
    original = service.is_link
    monkeypatch.setattr(service, "is_link", lambda path: path == data / "blobs" or original(path))
    with pytest.raises(ValueError, match="linked"):
        service.reset_data(result["archive"], result["sha256"], "RESET", data)
    assert (data / "sessions" / "private-name.txt").exists()
    assert not (data / service.MARKER).exists()


def test_partial_failure_retains_recovery_marker_and_retry_clears_everything(data, monkeypatch):
    result = exported(data)
    original = service.shutil.rmtree
    calls = []
    def fail_after_one(path):
        calls.append(path)
        if len(calls) == 2: raise PermissionError("locked file")
        original(path)
    monkeypatch.setattr(service.shutil, "rmtree", fail_after_one)
    with pytest.raises(RuntimeError, match="incomplete"):
        service.reset_data(result["archive"], result["sha256"], "RESET", data)
    assert (data / service.MARKER).exists()
    monkeypatch.setattr(service.shutil, "rmtree", original)
    service.reset_data(result["archive"], result["sha256"], "RESET", data)
    assert list(data.iterdir()) == []
    assert not (data / service.MARKER).exists()


def test_reset_is_independent_of_export_and_can_clear_corrupt_preferences(data):
    (data / "image_library" / "index.json").write_text('{"tags":null}')
    service.reset_data(confirmation="RESET", root=data)
    assert list(data.iterdir()) == []


def test_desktop_reset_retains_marker_until_profile_cleanup(data):
    service.reset_data(confirmation="RESET", root=data, keep_marker=True)
    assert list(data.iterdir()) == [data / service.MARKER]
    assert json.loads((data / service.MARKER).read_text()) == {"version": 2, "sanitize": True}


def test_backup_round_trip_all_data_and_preferences(data):
    import hashlib
    original = {"data/" + p.relative_to(data).as_posix(): p.read_bytes() for p in data.rglob("*") if p.is_file()}
    (data / ".backend.lock").write_bytes(b"0")
    storage = {"custom-buttons": '["private button"]', "preferences": '{"name":"private"}'}
    result = service.export_backup(data.parent / "backup.zip", storage, data)
    assert result["verified"] is True
    with zipfile.ZipFile(result["archive"]) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["content_backup"] is True
        assert "data/.backend.lock" not in archive.namelist()
        assert json.loads(archive.read("desktop/local-storage.json")) == storage
        for name, content in original.items(): assert archive.read(name) == content
        for entry in manifest["files"]:
            content = archive.read(entry["path"])
            assert len(content) == entry["bytes"]
            assert hashlib.sha256(content).hexdigest() == entry["sha256"]
        assert "Manual recovery" in archive.read("RESTORE.txt").decode()
    assert (data / "memory.db").read_bytes() == b"private database"


def test_backup_rejects_unsafe_destinations_links_and_interrupted_reset(data, monkeypatch):
    with pytest.raises(ValueError, match="outside"):
        service.export_backup(data / "backup.zip", {}, data)
    destination = data.parent / "backup.zip"
    destination.write_bytes(b"keep existing")
    with pytest.raises(ValueError, match="overwritten"):
        service.export_backup(destination, {}, data)
    assert destination.read_bytes() == b"keep existing"
    destination.unlink()
    (data / service.MARKER).write_text('{}')
    with pytest.raises(ValueError, match="interrupted"):
        service.export_backup(destination, {}, data)
    (data / service.MARKER).unlink()
    original = service.is_link
    monkeypatch.setattr(service, "is_link", lambda path: path == data / "blobs" or original(path))
    with pytest.raises(ValueError, match="linked"):
        service.export_backup(destination, {}, data)
    assert not destination.exists()


def test_failed_backup_removes_only_its_partial_archive(data, monkeypatch):
    destination = data.parent / "backup.zip"
    def fail(*args, **kwargs): raise OSError("disk full")
    monkeypatch.setattr(zipfile.ZipFile, "writestr", fail)
    with pytest.raises(OSError): service.export_backup(destination, {}, data)
    assert not destination.exists()
    assert (data / "memory.db").exists()


def test_backup_rejects_data_changed_after_it_was_copied(data, monkeypatch):
    original = zipfile.ZipFile.writestr
    def changed(archive, name, *args, **kwargs):
        if name == "manifest.json": (data / "memory.db").write_bytes(b"changed after copy")
        return original(archive, name, *args, **kwargs)
    monkeypatch.setattr(zipfile.ZipFile, "writestr", changed)
    destination = data.parent / "backup.zip"
    with pytest.raises(ValueError, match="changed"):
        service.export_backup(destination, {}, data)
    assert not destination.exists()


def test_offline_worker_backup_and_reset_protocol(data):
    import os
    import subprocess
    import sys
    environment = {**os.environ, "LAW_DATA_DIR": str(data), "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    def run(request):
        result = subprocess.run([sys.executable, str(Path(service.__file__))], input=json.dumps(request, ensure_ascii=False),
                                text=True, encoding="utf-8", capture_output=True, env=environment, timeout=30)
        assert result.returncode == 0, result.stdout
        return json.loads(result.stdout)
    result = run({"action": "backup", "destination": str(data.parent / "private-backup.zip"), "desktop_storage": {"buttons": "café 🎨"}})
    assert result["verified"] is True
    with zipfile.ZipFile(result["archive"]) as archive:
        assert json.loads(archive.read("desktop/local-storage.json"))["buttons"] == "café 🎨"
    assert run({"action": "reset", "confirmation": "RESET"})["ok"]
    assert run({"action": "recovery"})["pending"] is True
    assert list(data.iterdir()) == [data / service.MARKER]
    assert run({"action": "finish-reset"})["ok"]
    assert run({"action": "recovery"})["pending"] is False
    assert Path(result["archive"]).exists()


def test_maintenance_gate_auth_busy_streaming_and_timeout(monkeypatch):
    import httpx
    from fastapi import FastAPI
    from fastapi.responses import StreamingResponse
    from services import maintenance_gate as module
    monkeypatch.setenv("LAW_DESKTOP_MAINTENANCE_TOKEN", "test-secret")
    gate = module.Gate()
    monkeypatch.setattr(module, "gate", gate)
    monkeypatch.setattr(module, "workers_busy", lambda: False)
    app = FastAPI()
    app.add_middleware(module.MaintenanceMiddleware)
    app.include_router(module.router)
    observed = []
    @app.get("/stream")
    async def stream():
        async def body():
            observed.append(gate.active)
            yield b"ok"
        return StreamingResponse(body())
    async def check():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.post("/maintenance/lock")).status_code == 403
            assert (await client.get("/stream")).status_code == 200
            assert observed == [1] and gate.active == 0
            headers = {"x-desktop-maintenance": "test-secret"}
            monkeypatch.setattr(module, "workers_busy", lambda: True)
            assert (await client.post("/maintenance/lock", headers=headers)).status_code == 409
            assert not gate.locked
            monkeypatch.setattr(module, "workers_busy", lambda: False)
            assert (await client.post("/maintenance/lock", headers=headers)).status_code == 200
            assert (await client.get("/stream")).status_code == 503
            assert (await client.post("/maintenance/unlock", headers=headers)).status_code == 200
            assert (await client.get("/stream")).status_code == 200
            gate.locked = True; gate.expires = 0
            assert (await client.get("/stream")).status_code == 200
    asyncio.run(check())
