"""Offline desktop reset. Never imports stores, models, or the live application.

The desktop stops its owned backend before invoking reset. Archives contain
only aggregate inventory and numeric configuration, never user file contents.
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

MARKER = ".reset-in-progress.json"
CATEGORIES = {
    "sessions": "Chats", "blobs": "Image blobs", "generated_images": "Generated images",
    "image_workflows": "Image workflows", "image_library": "Image library / review",
    "locked_images": "Locked images", "lora": "LoRAs / training", "backups": "Recovery backups",
    "trash": "Trash", "knowledge_base": "Knowledge base", "web": "Web data",
    "thinking": "Thinking history", "logs": "App logs",
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
        raise ValueError("Save the inventory ZIP outside the app data folder.")
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


def reset_data(archive, sha256, confirmation, root=None):
    if confirmation != "RESET": raise ValueError("Type RESET to confirm permanent deletion.")
    root = checked_root(root)
    verify_archive(archive, sha256, root)
    scan(root)  # Validate every target before the first mutation.
    root.mkdir(parents=True, exist_ok=True)
    marker = root / MARKER
    index_path = root / "image_library" / "index.json"
    if marker.exists():
        preserved = json.loads(marker.read_text(encoding="utf-8"))
    else:
        index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
        tags = index.get("tags", [])
        if not isinstance(tags, list) or any(not isinstance(tag, dict) or not isinstance(tag.get("id"), str) or not isinstance(tag.get("name"), str) for tag in tags):
            raise ValueError("Image tag buttons are unreadable; nothing was deleted.")
        preserved = {"version": 1, "tags": [{"id": tag["id"], "name": tag["name"]} for tag in tags]}
        write_atomic(marker, preserved)
    # The marker blocks backend startup after interruption. Do not serve a
    # partly cleared vault or lose preserved buttons on a retry.
    try:
        for target in list(root.iterdir()):
            if target.name == MARKER: continue
            if is_link(target) or target.resolve().parent != root:
                raise ValueError("A reset target changed; cleanup stopped.")
            if target.is_dir(): shutil.rmtree(target)
            else: target.unlink()
        write_atomic(index_path, {"version": 1, "folders": [], "images": [], "tags": preserved["tags"]})
        marker.unlink()
    except (OSError, ValueError):
        raise RuntimeError("Reset is incomplete. The backend remains stopped. Close programs using app data, then retry Reset; preserved buttons are retained.") from None
    return {"ok": True}


def main():
    try:
        request = json.load(sys.stdin)
        if request.get("action") == "export": result = export_inventory(request["destination"])
        elif request.get("action") == "reset": result = reset_data(request["archive"], request["sha256"], request.get("confirmation"))
        elif request.get("action") == "recovery": result = {"pending": (checked_root() / MARKER).exists()}
        else: raise ValueError("Unknown maintenance action.")
        print(json.dumps(result))
    except Exception as error:
        # Do not expose file names, user content, or full exception traces.
        message = str(error) if isinstance(error, (ValueError, RuntimeError)) else "Maintenance could not access its files. Check permissions and try again."
        print(json.dumps({"error": message}))
        sys.exit(1)


if __name__ == "__main__": main()
