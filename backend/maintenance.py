"""Offline desktop reset. Never imports stores, models, or the live application.

The desktop stops its owned backend before reset or content backup. Metadata
inventories contain no user content; backups explicitly contain private data.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import zipfile
from datetime import datetime, timezone

from config import PROJECT_ROOT, settings
from services.maintenance_paths import import_journal

MARKER = ".reset-in-progress.json"
CATEGORIES = {
    "sessions": "Chats", "blobs": "Image blobs", "generated_images": "Generated images",
    "image_workflows": "Image workflows", "image_library": "Image library / review",
    "locked_images": "Locked images", "lora": "LoRAs / training", "backups": "Recovery backups",
    "trash": "Trash", "knowledge_base": "Knowledge base", "web": "Web data",
    "thinking": "Thinking history", "logs": "App logs",
    "face_datasets": "Face datasets", "face_bank": "Face bank", "character_datasets": "Character parts",
}


def is_link(path):
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400))


def checked_root(root=None):
    candidate = Path(root if root is not None else settings.data_dir).absolute()
    resolved = candidate.resolve()
    # Never treat a filesystem/home/project/model root or their parent as data.
    for protected in (Path.home().resolve(), PROJECT_ROOT.resolve(), settings.models_dir.resolve()):
        if resolved == protected or resolved in protected.parents:
            raise ValueError("Reset refused: the configured data folder overlaps a protected folder.")
    if resolved == Path(resolved.anchor) or resolved != candidate:
        raise ValueError("Reset requires a dedicated data folder without redirected parents.")
    if resolved.is_relative_to(settings.models_dir.resolve()):
        raise ValueError("Reset refused: app data must be separate from installed models.")
    if candidate.exists() and (is_link(candidate) or not candidate.is_dir()):
        raise ValueError("Reset requires a regular data folder.")
    return candidate


def scan(root):
    """Inspect metadata only. Reject links/junctions before any deletion."""
    entries = []
    if root.exists():
        for directory, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                item = Path(directory) / name
                if is_link(item) or not item.resolve().is_relative_to(root):
                    raise ValueError("Reset refused: data contains a linked or redirected file/folder.")
                if not item.is_dir():
                    if not item.is_file(): raise ValueError("Reset refused: data contains a special file.")
                    entries.append((item.relative_to(root), item.stat().st_size))
    return entries


def inventory(root=None):
    root = checked_root(root)
    groups = {label: {"files": 0, "bytes": 0} for label in [*CATEGORIES.values(), "Other app data"]}
    for relative, size in scan(root):
        if relative.name == MARKER: continue
        group = groups[CATEGORIES.get(relative.parts[0], "Other app data")]
        group["files"] += 1
        group["bytes"] += size
    return {
        "format": "local-workstation-metadata-inventory-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "content_backup": False, "inventory": groups,
        "settings": {"backend_port": settings.port, "chunk_size": settings.chunk_size,
                     "chunk_overlap": settings.chunk_overlap, "ocr_timeout_seconds": settings.ocr_timeout_seconds},
        "excludes": ["chat text", "prompts", "file names and paths", "images", "model and training artifacts", "user-created buttons"],
    }


def archive_path(value, root):
    path = Path(value).absolute()
    resolved = path.resolve()
    if resolved.is_relative_to(root) or resolved == root:
        raise ValueError("Save the ZIP outside the app data folder.")
    if path.suffix.lower() != ".zip" or path.exists():
        raise ValueError("Choose a new ZIP filename; existing files are never overwritten.")
    if path != resolved:
        raise ValueError("Choose a ZIP location without redirected folders.")
    return path


def export_inventory(destination, root=None):
    root = checked_root(root)
    destination = archive_path(destination, root)
    report = inventory(root)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("inventory.json", json.dumps(report, indent=2))
        archive.writestr("README.txt", "Metadata inventory only. No chat text, prompts, images, filenames, paths, buttons, or model/training artifacts. This ZIP cannot restore deleted content. Counts describe the time of export.\n")
    payload = buffer.getvalue()
    with destination.open("xb") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    digest = hashlib.sha256(payload).hexdigest()
    verify_archive(destination, digest, root)
    return {"archive": str(destination), "sha256": digest, "report": report}


def verify_archive(path, digest, root):
    path = Path(path).absolute()
    if path.resolve().is_relative_to(root) or path.resolve() != path or is_link(path):
        raise ValueError("The saved ZIP must remain outside the app data folder.")
    if path.stat().st_size > 1024 * 1024:
        raise ValueError("The saved inventory ZIP is invalid.")
    payload = path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != digest:
        raise ValueError("The saved inventory ZIP changed. Export a new ZIP before resetting.")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if archive.testzip() or set(archive.namelist()) != {"inventory.json", "README.txt"}:
            raise ValueError("The saved inventory ZIP could not be verified.")
        if json.loads(archive.read("inventory.json")).get("format") != "local-workstation-metadata-inventory-v1":
            raise ValueError("The saved ZIP is not a metadata inventory.")


def write_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(json.dumps(value).encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())
    try: temporary.replace(path)
    finally: temporary.unlink(missing_ok=True)


def export_backup(destination, desktop_storage, root=None):
    """Stream a stopped backend's data into a verified, recoverable ZIP."""
    root = checked_root(root)
    if import_journal(root).exists(): raise ValueError("Recover the interrupted import before exporting.")
    destination = archive_path(destination, root)
    if (root / MARKER).exists():
        raise ValueError("Complete the interrupted reset before making a backup.")
    if not isinstance(desktop_storage, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in desktop_storage.items()):
        raise ValueError("Desktop preferences could not be captured.")
    entries = [(relative, size) for relative, size in scan(root) if relative.as_posix() != ".backend.lock"]
    signatures = {relative: ((root / relative).stat().st_size, (root / relative).stat().st_mtime_ns) for relative, _ in entries}
    manifest = {
        "format": "local-workstation-backup-v1", "created_at": datetime.now(timezone.utc).isoformat(),
        "content_backup": True, "files": [],
        "excludes": ["installed base models", "external source files and exports", "external logs", "application code and dependencies", "temporary desktop session state"],
    }
    created = False
    try:
        with destination.open("xb") as handle:
            created = True
            with zipfile.ZipFile(handle, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                for relative, size in entries:
                    source = root / relative
                    before = source.stat()
                    if (before.st_size, before.st_mtime_ns) != signatures[relative]:
                        raise ValueError("App data changed during backup. Close other writers and retry.")
                    if is_link(source) or not source.resolve().is_relative_to(root):
                        raise ValueError("Backup source changed. Try again after closing other writers.")
                    name = "data/" + relative.as_posix()
                    digest = hashlib.sha256()
                    with source.open("rb") as reader, archive.open(name, "w", force_zip64=True) as writer:
                        while chunk := reader.read(1024 * 1024):
                            digest.update(chunk)
                            writer.write(chunk)
                    after = source.stat()
                    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or after.st_size != size:
                        raise ValueError("App data changed during backup. Close other writers and retry.")
                    manifest["files"].append({"path": name, "bytes": size, "sha256": digest.hexdigest()})
                preferences = json.dumps(desktop_storage, ensure_ascii=False, indent=2).encode("utf-8")
                archive.writestr("desktop/local-storage.json", preferences)
                manifest["files"].append({"path": "desktop/local-storage.json", "bytes": len(preferences), "sha256": hashlib.sha256(preferences).hexdigest()})
                archive.writestr("manifest.json", json.dumps(manifest, indent=2))
                archive.writestr("RESTORE.txt", "PRIVATE APPLICATION BACKUP - contains chats, prompts, media (including locked images), training data and preferences. Store privately.\n\nRecommended: Dashboard > IMPORT BACK-UP. Select this ZIP, review it, then type IMPORT. Current data and desktop preferences are retained in a separate recovery folder; the app restarts after restoration. Metadata-only ZIPs cannot be imported. Base models and external files are not restored.\n\nManual recovery into a compatible version of Local AI Workstation:\n1. Fully quit the desktop app from its tray and close all backends.\n2. Keep a separate copy of any current data before proceeding.\n3. Extract data/ into a NEW, empty application data directory. Set LAW_DATA_DIR to that directory before launching. Do not merge with existing data.\n4. Reinstall the required base models separately. External originals, exports and external logs are not included. External media references still need their original files.\n5. desktop/local-storage.json contains string key/value entries for the application's localStorage. Import these into the app's origin using Electron Developer Tools, then reload. Do not import into another website. For automatic recovery, use Dashboard > IMPORT BACK-UP and select this ZIP. The app verifies it and retains the previous data before replacing app data and desktop preferences.\n6. manifest.json lists SHA-256 and byte length for each data and preference file. Verify these before recovery.\nThis ZIP excludes application code/dependencies, base models, browser cache and unsaved in-memory edits.\n")
            handle.flush()
            os.fsync(handle.fileno())
        if entries != [(relative, size) for relative, size in scan(root) if relative.as_posix() != ".backend.lock"]:
            raise ValueError("App data changed during backup. Try again.")
        if any(((root / relative).stat().st_size, (root / relative).stat().st_mtime_ns) != signature for relative, signature in signatures.items()):
            raise ValueError("App data changed during backup. Try again.")
        with zipfile.ZipFile(destination) as archive:
            for entry in manifest["files"]:
                digest = hashlib.sha256()
                with archive.open(entry["path"]) as reader:
                    while chunk := reader.read(1024 * 1024): digest.update(chunk)
                if archive.getinfo(entry["path"]).file_size != entry["bytes"] or digest.hexdigest() != entry["sha256"]:
                    raise ValueError("Backup verification failed. Try again.")
        return {"archive": str(destination), "files": len(manifest["files"]), "verified": True}
    except BaseException:
        if created: destination.unlink(missing_ok=True)
        raise


def reset_data(archive=None, sha256=None, confirmation=None, root=None, keep_marker=False):
    if confirmation != "RESET": raise ValueError("Type RESET to confirm permanent deletion.")
    root = checked_root(root)
    if import_journal(root).exists(): raise ValueError("Recover the interrupted import before resetting.")
    if archive is not None: verify_archive(archive, sha256, root)
    scan(root)  # Validate every target before the first mutation.
    root.mkdir(parents=True, exist_ok=True)
    marker = root / MARKER
    write_atomic(marker, {"version": 2, "sanitize": True})
    # The marker blocks backend startup after interruption. Do not serve a
    # partly cleared vault on a retry.
    try:
        for target in list(root.iterdir()):
            if target.name == MARKER: continue
            if is_link(target) or target.resolve().parent != root:
                raise ValueError("A reset target changed; cleanup stopped.")
            if target.is_dir(): shutil.rmtree(target)
            else: target.unlink()
        if not keep_marker: marker.unlink()
    except (OSError, ValueError):
        raise RuntimeError("Reset is incomplete. The backend remains stopped. Close programs using app data, then retry Reset.") from None
    return {"ok": True}


def main():
    try:
        request = json.load(sys.stdin)
        if request.get("action") in {"inspect-backup", "import-backup", "import-status", "rollback-import", "finish-import"}:
            from backup_import import validate_backup, import_backup, import_status, rollback_import, finish_import
            action = request["action"]
            if action == "inspect-backup":
                result = validate_backup(request["archive"])
                result.pop("desktop_storage")
            elif action == "import-backup": result = import_backup(request["archive"], request["sha256"], request.get("confirmation"), request["previous_storage"])
            elif action == "import-status": result = import_status()
            elif action == "rollback-import": result = rollback_import()
            else: result = finish_import()
        elif request.get("action") == "export": result = export_inventory(request["destination"])
        elif request.get("action") == "inventory": result = inventory()
        elif request.get("action") == "backup":
            root = checked_root()
            scan(root)
            from services.process_lock import acquire
            # Keep another desktop backend from opening the data mid-snapshot.
            with acquire(root):
                result = export_backup(request["destination"], request["desktop_storage"], root)
        elif request.get("action") == "reset": result = reset_data(request.get("archive"), request.get("sha256"), request.get("confirmation"), keep_marker=True)
        elif request.get("action") == "finish-reset":
            root = checked_root()
            scan(root)
            (root / MARKER).unlink()
            result = {"ok": True}
        elif request.get("action") == "recovery": result = {"pending": (checked_root() / MARKER).exists()}
        else: raise ValueError("Unknown maintenance action.")
        print(json.dumps(result))
    except Exception as error:
        # Do not expose file names, user content, or full exception traces.
        message = str(error) if isinstance(error, (ValueError, RuntimeError)) else "Maintenance could not access its files. Check permissions and try again."
        print(json.dumps({"error": message}))
        sys.exit(1)


if __name__ == "__main__": main()
