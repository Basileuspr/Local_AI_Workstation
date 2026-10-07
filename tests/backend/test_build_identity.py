"""Capture provenance and cross-language desktop/backend identity contracts."""
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

from services.build_info import read_build_info

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("capture_review_identity_tests", ROOT / "scripts/capture-app-review.py")
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


def fixture_record(root):
    (root / "src").mkdir()
    (root / "src/example.js").write_bytes('const label = "π";\r\n'.encode())
    (root / "package.json").write_text('{"version":"1.0.1-dev"}', encoding="utf-8")
    value = {"id": "2026-10-01T053000-123456Z", "captured_at": "2026-09-30T23:30:00.123456-06:00",
        "captured_at_utc": "2026-10-01T05:30:00.123456+00:00", "timezone": "America/Denver",
        "app_version": "1.0.1-dev", "git": {"head": "a" * 40, "dirty": True, "worktree_entry_count": 3,
        "worktree": [{"status": " M", "path": "src/example.js"}]}, "environment": {"python": "3.13"},
        "node_dependencies": [{"name": "react", "declared": "^19", "locked": "19.2.8", "installed": "19.2.8"}],
        "node_lock_versions": {"node_modules/react": "19.2.8"}, "python_packages": {"fastapi": "0.141.1"},
        "commits": [{"hash": "a" * 40, "author_at": "2026-09-24T10:00:00-06:00", "committed_at": "2026-09-25T10:00:00-06:00"}],
        "files": {name: capture.metadata((root / name).read_bytes()) for name in ("package.json", "src/example.js")}}
    record = capture.build_record(value)
    (root / "build-info.json").write_text(json.dumps(record), encoding="utf-8")
    return value, record


def desktop_record(root):
    # Invoke the actual portable loader used by Electron's IPC, without Electron
    # or Git available in the synthetic source folder.
    code = "const {readBuildInfo}=require(process.argv[1]); process.stdout.write(JSON.stringify(readBuildInfo(process.argv[2])));"
    result = subprocess.run(["node", "-e", code, str(ROOT / "electron/buildInfo.js"), str(root)],
                            capture_output=True, text=True, check=True, timeout=15)
    return json.loads(result.stdout)


def test_desktop_and_backend_agree_on_one_complete_portable_record(tmp_path):
    _, record = fixture_record(tmp_path)
    backend = read_build_info(tmp_path)
    assert desktop_record(tmp_path) == backend
    assert backend["build_id"] == record["build_id"]
    assert backend["source_status"] == "recorded_files_match"
    assert backend["source_dirty"] is True
    assert backend["worktree_entry_count"] == 3
    assert backend["source_commit_at"] != backend["captured_at"]
    assert backend["dependencies"]["node"][0]["installed"] == "19.2.8"
    assert "source_files" not in backend


def test_dirty_content_changes_identifier_even_with_same_version_commit_and_time(tmp_path):
    snapshot, original = fixture_record(tmp_path)
    snapshot["files"]["src/example.js"] = capture.metadata(b"new feature\n")
    changed = capture.build_record(snapshot)
    assert changed["build_id"] != original["build_id"]
    assert changed["source_commit"] == original["source_commit"]
    assert changed["app_version"] == original["app_version"]


@pytest.mark.parametrize("change", ["edit", "remove", "version"])
def test_stale_source_is_labeled_without_relabeling_the_saved_capture(tmp_path, change):
    _, record = fixture_record(tmp_path)
    if change == "edit":
        (tmp_path / "src/example.js").write_text("new feature", encoding="utf-8")
    elif change == "remove":
        (tmp_path / "src/example.js").unlink()
    else:
        (tmp_path / "package.json").write_text('{"version":"1.0.2-dev"}', encoding="utf-8")
    backend = read_build_info(tmp_path)
    assert desktop_record(tmp_path) == backend
    assert backend["build_id"] == record["build_id"]
    assert backend["source_status"] == ("version_mismatch" if change == "version" else "changed_since_capture")


@pytest.mark.parametrize("contents", [None, "{broken", "{}"])
def test_missing_or_invalid_record_is_explicit_and_does_not_require_git(tmp_path, contents):
    (tmp_path / "package.json").write_text('{"version":"1.0.1-dev"}', encoding="utf-8")
    if contents is not None:
        (tmp_path / "build-info.json").write_text(contents, encoding="utf-8")
    backend = read_build_info(tmp_path)
    assert desktop_record(tmp_path) == backend
    assert backend["build_id"] is None
    assert backend["source_status"] == "unrecorded"


def test_capture_does_not_hash_its_generated_identity_or_invent_creation_dates():
    assert not capture.included("build-info.json")
    assert not capture.included("dist/build-info.json")
    assert capture.included("RELEASES.md")


@pytest.mark.parametrize("name", [
    "docs/README.md", "docs/images/GENERATION.md",
    "docs/workspace/STORAGE_AND_BACKUP.md", "docs/archive/PROJECT_STATUS.md",
])
def test_capture_tracks_relocated_documentation(name):
    assert capture.included(name)


@pytest.mark.parametrize("name", [
    "docs/archive/SESSION_HANDOFF.md", "docs/archive/ARCHITECTURE_CURRENT.md",
    "docs/archive/ROADMAP_ORIGINAL_7_SEGMENTS.md", "docs/application-review/AUDIT.md",
    "docs/application-review/HISTORY.md", "docs/application-review/index.html",
    "docs/application-review/snapshots/example.json",
])
def test_capture_excludes_private_and_generated_documentation(name):
    assert not capture.included(name)


def test_api_openapi_health_and_software_inventory_use_process_identity(monkeypatch, tmp_path):
    import main
    from fastapi.testclient import TestClient
    from conftest import API_BASE_URL, AUTH_HEADERS
    from services import software_specs
    _, record = fixture_record(tmp_path)
    build = read_build_info(tmp_path)
    monkeypatch.setattr(main, "APP_BUILD", build)
    monkeypatch.setattr(main.app.state, "build_info", build)
    # Keep the existing manifest-driven OpenAPI version and health contract.
    with TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS) as client:
        response = client.get("/version")
        assert response.json() == desktop_record(tmp_path)
        assert response.headers["cache-control"] == "no-store"
        assert client.get("/openapi.json").json()["info"]["version"] == main.app.version
        health = client.get("/health")
        assert health.json() == {"status": "ok"}
        assert health.headers["x-law-build"] == record["build_id"]
        assert health.headers["x-law-version"] == main.app.version
    inventory = software_specs.snapshot(main.app.routes, tmp_path, build_info=build)
    assert inventory["build"] == build
