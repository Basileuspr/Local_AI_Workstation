"""Folder snapshots for verifying that an operation changed (or did not change) anything.

A snapshot records every folder and every file (relative path, size, modified
and created time, optionally SHA-256).  compare() lists what disappeared,
appeared or changed between two snapshots.
"""
from __future__ import annotations

import json
import os
from datetime import datetime

from . import hashing, winfs
from .progress import Progress


def take(root: str, with_hash: bool = True, quiet: bool = False) -> dict:
    root = os.path.abspath(root)
    snap = {"root": root, "taken": datetime.now().isoformat(timespec="seconds"), "hashed": with_hash,
            "exists": os.path.isdir(winfs.long_path(root)), "files": {}, "dirs": [], "skipped": []}
    if not snap["exists"]:
        return snap
    prog = Progress(enabled=not quiet)
    stack = [root]
    while stack:
        d = stack.pop()
        try:
            with os.scandir(winfs.long_path(d)) as it:
                entries = sorted(it, key=lambda e: e.name.lower())
        except OSError as exc:
            snap["skipped"].append(f"{d}: {winfs.describe_error(exc)}")
            continue
        rel_d = os.path.relpath(d, root)
        if rel_d != ".":
            snap["dirs"].append(rel_d)
        for e in entries:
            full = os.path.join(d, e.name)
            if winfs.link_kind(e):
                snap["skipped"].append(f"{full}: link not followed")
                continue
            if e.is_dir(follow_symlinks=False):
                stack.append(full)
                continue
            st = e.stat(follow_symlinks=False)
            mtime, created = winfs.file_times(st)
            info = {"size": st.st_size, "mtime_ns": st.st_mtime_ns, "created": created}
            if with_hash:
                prog.update(f"Snapshot: hashing {full}")
                try:
                    info["sha256"] = hashing.sha256_file(full)[0]
                except OSError as exc:
                    info["sha256"] = f"unreadable: {winfs.describe_error(exc)}"
            snap["files"][os.path.relpath(full, root)] = info
    prog.clear()
    snap["file_count"] = len(snap["files"])
    snap["dir_count"] = len(snap["dirs"])
    return snap


def save(snap: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def compare(a: dict, b: dict, ignore_prefixes=()) -> dict:
    def keep(p):
        return not any(p.lower().startswith(x.lower()) for x in ignore_prefixes)

    fa = {k: v for k, v in a["files"].items() if keep(k)}
    fb = {k: v for k, v in b["files"].items() if keep(k)}
    changed = []
    for k in sorted(set(fa) & set(fb)):
        diffs = [f for f in ("size", "mtime_ns", "created", "sha256")
                 if f in fa[k] and f in fb[k] and fa[k][f] != fb[k][f]]
        if diffs:
            changed.append({"path": k, "fields": diffs})
    return {
        "missing_files": sorted(set(fa) - set(fb)),
        "new_files": sorted(set(fb) - set(fa)),
        "changed_files": changed,
        "missing_dirs": sorted(set(a["dirs"]) - set(b["dirs"])),
        "new_dirs": sorted(set(b["dirs"]) - set(a["dirs"])),
        "files_before": len(fa), "files_after": len(fb),
        "dirs_before": len(a["dirs"]), "dirs_after": len(b["dirs"]),
    }


def is_identical(diff: dict) -> bool:
    return not (diff["missing_files"] or diff["new_files"] or diff["changed_files"]
                or diff["missing_dirs"] or diff["new_dirs"])


def format_diff(diff: dict, limit: int = 20) -> str:
    lines = [f"Files: {diff['files_before']:,} before, {diff['files_after']:,} after | "
             f"Folders: {diff['dirs_before']:,} before, {diff['dirs_after']:,} after"]
    for key, label in (("missing_files", "disappeared/moved/renamed"), ("new_files", "new"),
                       ("missing_dirs", "folders gone"), ("new_dirs", "new folders")):
        items = diff[key]
        lines.append(f"  {label}: {len(items)}")
        lines += [f"     {x}" for x in items[:limit]]
    lines.append(f"  changed (size/time/content): {len(diff['changed_files'])}")
    lines += [f"     {c['path']}  ({', '.join(c['fields'])})" for c in diff["changed_files"][:limit]]
    lines.append("RESULT: IDENTICAL" if is_identical(diff) else "RESULT: DIFFERENCES FOUND")
    return "\n".join(lines)
