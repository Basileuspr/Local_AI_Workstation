"""Recursive directory walker: iterative, link-safe and error-tolerant.

* Uses an explicit stack, so nesting depth is unlimited (no recursion limit).
* Never follows symbolic links, directory junctions or mount points, and also
  remembers every directory identity it has entered, so loops are impossible.
* An unreadable folder is logged and skipped; the walk continues.
* Only metadata (names, sizes, timestamps) is collected here - no file content.
"""
from __future__ import annotations

import os
import time
from collections import Counter
from dataclasses import dataclass, field

from . import winfs

SYSTEM_DIR_NAMES = {".media-manager-trash", "$recycle.bin", "system volume information", "recycler", "recycled",
                    "$windows.~bt", "$windows.~ws"}


@dataclass
class Mp4Candidate:
    path: str                    # absolute path (display form, no \\?\ prefix)
    rel_parts: tuple             # folder names between the source root and the file
    size: int = -1
    mtime_ns: int = 0
    mtime: float | None = None
    created: float | None = None
    attributes: int = 0
    cloud_placeholder: bool = False
    stat_error: str = ""


@dataclass
class WalkResult:
    source_root: str
    candidates: list = field(default_factory=list)
    dirs_scanned: int = 0
    files_examined: int = 0
    ext_counts: Counter = field(default_factory=Counter)
    skipped: list = field(default_factory=list)            # dicts: Path, Kind, Reason
    name_contains_mp4: list = field(default_factory=list)  # e.g. clip.mp4.part
    max_depth: int = 0
    elapsed: float = 0.0
    interrupted: bool = False


def walk(source_root: str, exclude=(), on_progress=None, stop_event=None,
         wanted_ext: str = ".mp4") -> WalkResult:
    root = os.path.abspath(source_root)
    res = WalkResult(source_root=root)
    excluded = [e for e in exclude if e]
    visited: set = set()
    stack = [(root, ())]
    t0 = time.monotonic()

    while stack:
        if stop_event is not None and stop_event.is_set():
            res.interrupted = True
            break
        dir_path, rel = stack.pop()

        try:
            st = os.stat(winfs.long_path(dir_path))
            if st.st_ino:
                ident = (st.st_dev, st.st_ino)
                if ident in visited:
                    res.skipped.append({"Path": dir_path, "Kind": "loop",
                                        "Reason": "directory already visited (filesystem loop) - not scanned again"})
                    continue
                visited.add(ident)
        except OSError as exc:
            res.skipped.append({"Path": dir_path, "Kind": "unreadable folder",
                                "Reason": f"cannot open folder: {winfs.describe_error(exc)}"})
            continue

        try:
            with os.scandir(winfs.long_path(dir_path)) as it:
                entries = list(it)
        except OSError as exc:
            res.skipped.append({"Path": dir_path, "Kind": "unreadable folder",
                                "Reason": f"cannot list folder: {winfs.describe_error(exc)}"})
            continue

        res.dirs_scanned += 1
        res.max_depth = max(res.max_depth, len(rel))
        entries.sort(key=lambda e: e.name.lower())
        subdirs = []
        for entry in entries:
            name = entry.name
            full = os.path.join(dir_path, name)
            try:
                link = winfs.link_kind(entry)
                is_dir = entry.is_dir(follow_symlinks=False)
            except OSError as exc:
                res.skipped.append({"Path": full, "Kind": "unreadable entry",
                                    "Reason": winfs.describe_error(exc)})
                continue

            if link:
                res.skipped.append({"Path": full, "Kind": "link (not followed)",
                                    "Reason": f"{link}; links are never followed to avoid loops and double counting"})
                continue

            if is_dir:
                if name.lower() in SYSTEM_DIR_NAMES:
                    res.skipped.append({"Path": full, "Kind": "system folder",
                                        "Reason": "Windows system/recycle folder - skipped"})
                    continue
                if any(winfs.is_within(full, ex) for ex in excluded):
                    res.skipped.append({"Path": full, "Kind": "excluded folder",
                                        "Reason": "destination or reports folder - never scanned"})
                    continue
                subdirs.append((full, rel + (name,)))
                continue

            res.files_examined += 1
            ext = os.path.splitext(name)[1].lower()
            res.ext_counts[ext or "(no extension)"] += 1
            if ext == wanted_ext:
                res.candidates.append(_candidate(entry, full, rel))
            elif wanted_ext in name.lower():
                res.name_contains_mp4.append(full)

        stack.extend(reversed(subdirs))  # reversed so folders are visited alphabetically
        if on_progress is not None:
            on_progress(res, dir_path)

    res.elapsed = time.monotonic() - t0
    return res


def _candidate(entry, full: str, rel: tuple) -> Mp4Candidate:
    cand = Mp4Candidate(path=full, rel_parts=rel)
    try:
        st = entry.stat(follow_symlinks=False)
    except OSError as exc:
        cand.stat_error = winfs.describe_error(exc)
        return cand
    cand.size = st.st_size
    cand.mtime_ns = st.st_mtime_ns
    cand.mtime, cand.created = winfs.file_times(st)
    cand.attributes = getattr(st, "st_file_attributes", 0)
    cand.cloud_placeholder = winfs.is_cloud_placeholder(cand.attributes)
    return cand
