import os
from pathlib import Path
from types import SimpleNamespace

import pytest
import drive_space as service


def test_nested_totals_sort_largest_first_and_keep_root_files_separate(tmp_path):
    (tmp_path / "small").mkdir()
    (tmp_path / "large" / "nested").mkdir(parents=True)
    (tmp_path / "empty").mkdir()
    (tmp_path / "small" / "one.bin").write_bytes(b"a" * 10)
    (tmp_path / "large" / "nested" / "two.bin").write_bytes(b"b" * 100)
    (tmp_path / "root.bin").write_bytes(b"c" * 5)
    before = {str(path): path.stat().st_mtime_ns for path in tmp_path.rglob("*")}
    updates = []
    result = service.scan_folders(tmp_path, updates.append)
    assert [(row["name"], row["bytes"]) for row in result["folders"]] == [("large", 100), ("small", 10), ("empty", 0)]
    assert result["root_files"]["bytes"] == 5
    assert result["total_bytes"] == 115 and result["files"] == 3
    assert result["finished"] and result["errors"] == 0
    assert updates[-1] == result
    assert {str(path): path.stat().st_mtime_ns for path in tmp_path.rglob("*")} == before


def test_hardlinks_count_once_across_top_level_folders(tmp_path):
    (tmp_path / "alpha").mkdir()
    (tmp_path / "beta").mkdir()
    original = tmp_path / "alpha" / "file"
    original.write_bytes(b"shared" * 10)
    os.link(original, tmp_path / "beta" / "copy")
    result = service.scan_folders(tmp_path)
    assert result["total_bytes"] == 60
    assert result["files"] == 1 and result["shared_files"] == 1
    assert next(row for row in result["folders"] if row["name"] == "beta")["shared_files"] == 1


def test_reparse_points_are_not_traversed(tmp_path, monkeypatch):
    linked = tmp_path / "redirected"
    linked.mkdir()
    (linked / "do-not-count").write_bytes(b"private" * 100)
    original = service.os.stat
    def fake(path, *args, **kwargs):
        info = original(path, *args, **kwargs)
        if Path(path) == linked:
            return SimpleNamespace(st_mode=info.st_mode, st_file_attributes=0x400)
        return info
    monkeypatch.setattr(service.os, "stat", fake)
    result = service.scan_folders(tmp_path)
    assert result["total_bytes"] == 0
    assert result["skipped_links"] == 1
    assert result["folders"][0]["status"] == "skipped"


def test_inaccessible_directory_does_not_hide_other_results(tmp_path, monkeypatch):
    (tmp_path / "blocked").mkdir()
    (tmp_path / "visible").mkdir()
    (tmp_path / "visible" / "file").write_bytes(b"readable")
    original = service.os.scandir
    def guarded(path):
        if Path(path) == tmp_path / "blocked": raise PermissionError("denied")
        return original(path)
    monkeypatch.setattr(service.os, "scandir", guarded)
    result = service.scan_folders(tmp_path)
    assert result["total_bytes"] == 8 and result["errors"] == 1
    blocked = next(row for row in result["folders"] if row["name"] == "blocked")
    assert blocked["status"] == "partial" and blocked["errors"] == 1


def test_unreadable_root_file_is_not_misclassified_as_a_folder(tmp_path, monkeypatch):
    blocked = tmp_path / "locked.sys"
    blocked.write_bytes(b"locked")
    original = service.os.stat
    def guarded(path, *args, **kwargs):
        if Path(path) == blocked: raise PermissionError("denied")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(service.os, "stat", guarded)
    result = service.scan_folders(tmp_path)
    assert result["folders"] == []
    assert result["root_files"]["errors"] == 1


def test_cancellation_returns_explicitly_unfinished_result(tmp_path):
    (tmp_path / "folder").mkdir()
    for index in range(20): (tmp_path / "folder" / str(index)).write_bytes(b"x")
    calls = 0
    def canceled():
        nonlocal calls
        calls += 1
        return calls > 8
    result = service.scan_folders(tmp_path, canceled=canceled)
    assert result["canceled"] and not result["finished"]
    assert result["files"] < 20
    assert len(list((tmp_path / "folder").iterdir())) == 20


def test_worker_emits_json_progress_and_final_result_for_fixture(tmp_path, monkeypatch, capsys):
    import json
    (tmp_path / "folder").mkdir()
    (tmp_path / "folder" / "café.txt").write_bytes(b"test")
    monkeypatch.setattr(service, "drive_root", lambda value: tmp_path)
    monkeypatch.setattr(service.sys, "argv", ["drive_space.py", "C:\\"])
    service.main()
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert events[-1]["type"] == "complete"
    assert events[-1]["report"]["total_bytes"] == 4
    assert any(event["type"] == "progress" for event in events)


@pytest.mark.parametrize("value", [None, "C:", "C:\\Users", "C:\\..\\", "\\\\server\\share", "http://example.com", "/", "cmd.exe"])
def test_cli_rejects_non_drive_roots(value):
    with pytest.raises(ValueError, match="drive root"): service.drive_root(value)
