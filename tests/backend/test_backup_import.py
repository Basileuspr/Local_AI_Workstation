import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

import pytest
import maintenance
import backup_import as service


@pytest.fixture
def current(tmp_path):
    root = tmp_path / "app-data"
    root.mkdir()
    (root / "old.txt").write_bytes(b"CURRENT PRIVATE DATA")
    return root


def archive_at(path, payloads=None, change=None, extra=None):
    payloads = payloads or {"data/new.txt": b"BACKED UP DATA", "desktop/local-storage.json": json.dumps({"buttons": "café 🎨"}).encode()}
    manifest = {"format": service.FORMAT, "content_backup": True, "created_at": "2026-09-22T00:00:00Z", "files": [
        {"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()} for name, content in payloads.items()
    ]}
    if change: change(manifest)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in payloads.items(): archive.writestr(name, payload)
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("RESTORE.txt", "Instructions")
        if extra: archive.writestr(*extra)
    return path


def import_fixture(current, archive):
    report = service.validate_backup(archive, current)
    result = service.import_backup(archive, report["sha256"], "IMPORT", {"old-preference": "KEEP"}, current)
    return result


def test_export_import_round_trip_and_preimport_data_retained(current):
    original = current.parent / "source-data"
    (original / "blobs").mkdir(parents=True)
    (original / "blobs" / "image.bin").write_bytes(bytes(range(256)))
    (original / "memory.db").write_bytes(b"database with its sidecar")
    (original / "memory.db-wal").write_bytes(b"wal")
    exported = maintenance.export_backup(current.parent / "backup.zip", {"buttons": "café 🎨"}, original)
    inspected = service.validate_backup(exported["archive"], current)
    assert inspected["report"]["files"] == 3
    result = import_fixture(current, exported["archive"])
    assert not (current / "old.txt").exists()
    assert (current / "blobs" / "image.bin").read_bytes() == bytes(range(256))
    assert (current / "memory.db-wal").read_bytes() == b"wal"
    assert result["desktop_storage"] == {"buttons": "café 🎨"}
    recovery = Path(result["recovery"])
    assert (recovery / "data" / "old.txt").read_bytes() == b"CURRENT PRIVATE DATA"
    assert json.loads((recovery / "desktop-local-storage.json").read_text()) == {"old-preference": "KEEP"}
    assert service.import_status(current)["pending"]
    service.finish_import(current)
    assert not service.import_status(current)["pending"]
    assert recovery.exists()


@pytest.mark.parametrize("confirmation", [None, "", "import", "RESET"])
def test_confirmation_required_before_staging(current, confirmation):
    archive = archive_at(current.parent / "backup.zip")
    with pytest.raises(ValueError, match="Type IMPORT"):
        service.import_backup(archive, "invalid", confirmation, {}, current)
    assert (current / "old.txt").exists()
    assert not list(current.parent.glob(".law-import-*"))


@pytest.mark.parametrize("name", ["data/../escape", "/absolute", "data/C:/escape", "data/a\\b", "data/a:stream", "data/NUL.txt", "data/trailing.", "data/.backend.lock", "data/.reset-in-progress.json", "data/CONOUT$"])
def test_unsafe_paths_never_touch_current_data(current, name):
    archive = archive_at(current.parent / "unsafe.zip", {name: b"bad", "desktop/local-storage.json": b"{}"})
    with pytest.raises(ValueError): service.validate_backup(archive, current)
    assert (current / "old.txt").read_bytes() == b"CURRENT PRIVATE DATA"


def test_metadata_zip_cannot_be_imported(current):
    exported = maintenance.export_inventory(current.parent / "metadata.zip", current)
    with pytest.raises(ValueError, match="Metadata ZIPs"):
        service.validate_backup(exported["archive"], current)


@pytest.mark.parametrize("mutate", [
    lambda m: m.update(format="future-version"),
    lambda m: m["files"][0].update(sha256="0" * 64),
    lambda m: m["files"][0].update(bytes=999),
    lambda m: m["files"].pop(),
    lambda m: m["files"].append(m["files"][0]),
])
def test_manifest_mismatch_and_unsupported_versions_rejected(current, mutate):
    archive = archive_at(current.parent / "bad.zip", change=mutate)
    with pytest.raises(ValueError): service.validate_backup(archive, current)
    assert (current / "old.txt").exists()


@pytest.mark.parametrize("extra", [("unlisted.txt", b"extra"), ("data/NEW.txt", b"case collision"), ("data/new.txt/child", b"file-folder conflict")])
def test_conflicting_and_unlisted_members_rejected(current, extra):
    archive = archive_at(current.parent / "bad.zip", extra=extra)
    with pytest.raises(ValueError): service.validate_backup(archive, current)


def test_symlink_member_rejected(current):
    archive = archive_at(current.parent / "bad.zip")
    with zipfile.ZipFile(archive, "a") as handle:
        info = zipfile.ZipInfo("data/link")
        info.create_system = 3
        info.external_attr = 0o120777 << 16
        handle.writestr(info, "../../elsewhere")
    with pytest.raises(ValueError, match="regular"): service.validate_backup(archive, current)


@pytest.mark.parametrize("payload", [b"[]", b'{"key":42}', b'{"same":"first","same":"last"}'])
def test_invalid_desktop_preferences_rejected_before_data_replacement(current, payload):
    archive = archive_at(current.parent / "backup.zip", {"data/new.txt": b"new", "desktop/local-storage.json": payload})
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    with pytest.raises(ValueError): service.import_backup(archive, digest, "IMPORT", {}, current)
    assert (current / "old.txt").exists()
    assert not service.import_status(current)["pending"]


def test_source_inside_app_data_is_refused(current):
    archive = archive_at(current / "backup.zip")
    with pytest.raises(ValueError, match="outside app data"): service.validate_backup(archive, current)
    assert archive.exists()


def test_running_backend_lock_prevents_swap(current):
    archive = archive_at(current.parent / "backup.zip")
    digest = service.validate_backup(archive, current)["sha256"]
    with service.acquire(current):
        with pytest.raises(RuntimeError, match="Another backend"):
            service.import_backup(archive, digest, "IMPORT", {}, current)
        assert (current / "old.txt").read_bytes() == b"CURRENT PRIVATE DATA"
    service.rollback_import(current)
    service.finish_import(current)
    assert (current / "old.txt").exists()


def test_changed_archive_and_disk_shortage_do_not_replace_data(current, monkeypatch):
    archive = archive_at(current.parent / "backup.zip")
    reviewed = service.validate_backup(archive, current)
    archive_at(archive, {"data/changed": b"new", "desktop/local-storage.json": b"{}"})
    with pytest.raises(ValueError, match="changed"):
        service.import_backup(archive, reviewed["sha256"], "IMPORT", {}, current)
    reviewed = service.validate_backup(archive, current)
    from types import SimpleNamespace
    monkeypatch.setattr(service.shutil, "disk_usage", lambda path: SimpleNamespace(free=1))
    with pytest.raises(ValueError, match="free disk space"):
        service.import_backup(archive, reviewed["sha256"], "IMPORT", {}, current)
    assert (current / "old.txt").exists()
    assert not service.import_status(current)["pending"]
    assert not list(current.parent.glob(".law-import-*-stage-*"))


@pytest.mark.parametrize("failure_point", ["old", "staging"])
def test_interrupted_directory_swap_can_be_recovered(current, monkeypatch, failure_point):
    archive = archive_at(current.parent / "backup.zip")
    digest = service.validate_backup(archive, current)["sha256"]
    rename = Path.rename
    def fail(path, target):
        if (failure_point == "old" and path == current) or (failure_point == "staging" and "-stage-" in path.name):
            raise OSError("simulated locked directory")
        return rename(path, target)
    monkeypatch.setattr(Path, "rename", fail)
    with pytest.raises(OSError): service.import_backup(archive, digest, "IMPORT", {"old": "settings"}, current)
    assert service.import_status(current)["pending"]
    monkeypatch.setattr(Path, "rename", rename)
    result = service.rollback_import(current)
    assert result["desktop_storage"] == {"old": "settings"}
    assert (current / "old.txt").read_bytes() == b"CURRENT PRIVATE DATA"
    assert not (current / "new.txt").exists()
    assert service.rollback_import(current)["pending"]  # retry after profile cleanup failure
    service.finish_import(current)
    assert not service.import_status(current)["pending"]


def test_installed_import_can_rollback_and_blocks_other_maintenance(current):
    result = import_fixture(current, archive_at(current.parent / "backup.zip"))
    with pytest.raises(ValueError, match="interrupted import"):
        maintenance.reset_data(confirmation="RESET", root=current)
    with pytest.raises(ValueError, match="interrupted import"):
        maintenance.export_backup(current.parent / "another.zip", {}, current)
    service.rollback_import(current)
    assert (current / "old.txt").exists()
    assert (Path(result["recovery"]) / "imported-data" / "new.txt").exists()
    service.finish_import(current)


def test_unsafe_recovery_journal_cannot_move_outside_files(current):
    outside = current.parent / "precious"
    outside.mkdir()
    (outside / "keep").write_text("keep")
    service.journal_path(current).write_text(json.dumps({"version": 1, "phase": "prepared", "staging": str(outside), "recovery": str(outside)}))
    with pytest.raises(ValueError, match="unsafe"): service.rollback_import(current)
    assert (outside / "keep").read_text() == "keep"
    assert (current / "old.txt").exists()


def test_worker_protocol_and_backend_startup_guard(current):
    archive = archive_at(current.parent / "backup.zip")
    environment = {**os.environ, "LAW_DATA_DIR": str(current), "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    def worker(request):
        result = subprocess.run([sys.executable, str(Path(maintenance.__file__))], input=json.dumps(request),
                                text=True, encoding="utf-8", capture_output=True, env=environment, timeout=30)
        assert result.returncode == 0, result.stdout
        return json.loads(result.stdout)
    reviewed = worker({"action": "inspect-backup", "archive": str(archive)})
    assert "desktop_storage" not in reviewed
    worker({"action": "import-backup", "archive": str(archive), "sha256": reviewed["sha256"], "confirmation": "IMPORT", "previous_storage": {"old": "value"}})
    backend = subprocess.run([sys.executable, str(Path(maintenance.__file__).with_name("main.py"))], env=environment, capture_output=True, text=True, timeout=30)
    assert backend.returncode != 0
    assert "import was interrupted" in backend.stderr
    assert worker({"action": "import-status"})["pending"]
    assert worker({"action": "rollback-import"})["desktop_storage"] == {"old": "value"}
    worker({"action": "finish-import"})
    assert (current / "old.txt").exists()
