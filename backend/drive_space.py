"""Read-only, on-demand folder size worker. Never opens file contents."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import stat
import sys
import time
from datetime import datetime, timezone


def drive_root(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z]:[\\/]", value):
        raise ValueError("Choose a local drive root, such as C:\\.")
    root = value[0].upper() + ":\\"
    if os.name != "nt": raise ValueError("Drive folder scans are available on Windows.")
    import ctypes
    kind = ctypes.windll.kernel32.GetDriveTypeW(root)
    if kind not in {2, 3, 6}: raise ValueError("Choose an available local fixed or removable drive.")
    return Path(root)


def _linked(info):
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def scan_folders(root, progress=lambda value: None, canceled=lambda: False):
    """Aggregate unique logical file bytes under each immediate child directory.

    The caller supplies a validated drive root; temporary roots are supported
    here for isolated testing. Reparse points are excluded before traversal.
    """
    root = Path(root)
    root_info = root.lstat()
    if _linked(root_info) or not stat.S_ISDIR(root_info.st_mode):
        raise ValueError("Choose a regular, accessible drive root.")
    started = datetime.now(timezone.utc).isoformat()
    folders, seen = [], set()
    def row(name, kind="folder"):
        return {"name": name, "kind": kind, "bytes": 0, "files": 0, "errors": 0,
                "skipped_links": 0, "shared_files": 0, "status": "pending"}
    root_files = row("Files in drive root", "files")
    current = None
    last_update = 0

    def snapshot(done=False, stopped=False):
        rows = [*folders, root_files]
        return {"root": str(root), "started_at": started, "sampled_at": datetime.now(timezone.utc).isoformat(),
                "finished": done, "canceled": stopped, "current_folder": current,
                "folders": sorted((dict(item) for item in folders), key=lambda item: (-item["bytes"], item["name"].casefold())),
                "root_files": dict(root_files), "total_bytes": sum(item["bytes"] for item in rows),
                "files": sum(item["files"] for item in rows), "errors": sum(item["errors"] for item in rows),
                "skipped_links": sum(item["skipped_links"] for item in rows),
                "shared_files": sum(item["shared_files"] for item in rows)}

    def publish(force=False):
        nonlocal last_update
        now = time.monotonic()
        if force or now - last_update >= .5:
            progress(snapshot())
            last_update = now

    def count_file(path, info, owner):
        if _linked(info):
            owner["skipped_links"] += 1
        elif stat.S_ISREG(info.st_mode):
            # DirEntry.stat returns zero file IDs on Windows. os.stat provides
            # the real volume/file identity needed to avoid hardlink duplication.
            identity = (info.st_dev, info.st_ino)
            if info.st_ino and info.st_nlink > 1:
                if identity in seen:
                    owner["shared_files"] += 1
                    return
                seen.add(identity)
            owner["bytes"] += info.st_size
            owner["files"] += 1

    # Establish all top-level rows before reporting progress. Only a drive's
    # immediate entries are materialized; deep traversal uses a directory stack.
    with os.scandir(root) as entries:
        top = sorted(entries, key=lambda entry: (entry.name.casefold(), entry.name))
    directories = []
    root_files["status"] = "scanning"
    for entry in top:
        if canceled(): return snapshot(stopped=True)
        try:
            info = os.stat(entry.path, follow_symlinks=False)
            if stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
                owner = row(entry.name)
                folders.append(owner)
                if _linked(info):
                    owner.update(skipped_links=1, status="skipped")
                else: directories.append((Path(entry.path), owner))
            else: count_file(entry.path, info, root_files)
        except OSError:
            try: is_directory = entry.is_dir(follow_symlinks=False)
            except OSError: is_directory = True
            if is_directory:
                owner = row(entry.name)
                owner.update(errors=1, status="partial")
                folders.append(owner)
            else: root_files["errors"] += 1
        publish()
    root_files["status"] = "partial" if root_files["errors"] or root_files["skipped_links"] else "done"
    for directory, owner in directories:
        current = owner["name"]
        owner["status"] = "scanning"
        stack = [directory]
        publish()
        while stack:
            if canceled(): return snapshot(stopped=True)
            path = stack.pop()
            try:
                # Recheck directories immediately before traversal in case a
                # folder was replaced with a junction while scanning.
                info = os.stat(path, follow_symlinks=False)
                if _linked(info):
                    owner["skipped_links"] += 1
                    continue
                with os.scandir(path) as entries:
                    for entry in entries:
                        if canceled(): return snapshot(stopped=True)
                        try:
                            info = os.stat(entry.path, follow_symlinks=False)
                            if _linked(info): owner["skipped_links"] += 1
                            elif stat.S_ISDIR(info.st_mode): stack.append(Path(entry.path))
                            else: count_file(entry.path, info, owner)
                        except OSError: owner["errors"] += 1
                        publish()
            except OSError: owner["errors"] += 1
        owner["status"] = "partial" if owner["errors"] or owner["skipped_links"] else "done"
        publish()
    current = None
    result = snapshot(done=True)
    progress(result)
    return result


def main():
    def emit(value): print(json.dumps(value), flush=True)
    try:
        root = drive_root(sys.argv[1] if len(sys.argv) == 2 else None)
        result = scan_folders(root, lambda report: emit({"type": "progress", "report": report}))
        emit({"type": "complete", "report": result})
    except Exception as error:
        emit({"type": "error", "error": str(error) if isinstance(error, ValueError) else "Could not scan this drive. Check that it is connected and accessible."})
        sys.exit(1)


if __name__ == "__main__": main()
