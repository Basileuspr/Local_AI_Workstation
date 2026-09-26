"""MOVE APPROVED FILES (and UNDO) - executes exactly what a reviewed manifest proposes.

Safety rules
* Nothing is moved without --execute, plus a typed confirmation (or --yes).
* Only records approved in the manifest move; invalid files only with --include-invalid.
* A file that changed since the scan (size or modified time differ) or has vanished is skipped.
* Nothing is ever overwritten:
    - same drive: a rename, which Windows refuses if the target exists;
    - different drive: copy to a temporary file created exclusively, verify its
      SHA-256 against the manifest, rename it into place, and only then remove
      the source.  If removing the source fails, both copies are kept.
* Each operation is logged to operations.jsonl before it starts and after it
  finishes (write-ahead log).  'undo' replays that log in reverse.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime

from . import constants as C
from . import hashing, manifest, winfs
from .progress import Progress, human_bytes

OPS_CSV_COLUMNS = ["OpId", "RecordId", "Status", "Method", "Verification", "OriginalPath", "DestinationPath",
                   "OriginalFilename", "DestinationFilename", "SHA256", "FileSize", "StartedAt", "FinishedAt",
                   "Note", "Error"]


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _unique_dir(path: str) -> str:
    """Create and return path, or path_2, path_3... if it already exists."""
    candidate, n = path, 2
    while True:
        try:
            os.makedirs(candidate)
            return candidate
        except FileExistsError:
            candidate = f"{path}_{n}"
            n += 1


class OpLog:
    """Append-only JSONL log; every line is flushed and fsync'ed."""

    def __init__(self, path: str):
        self.path = path
        self._f = open(path, "a", encoding="utf-8")

    def write(self, entry: dict) -> None:
        self._f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self._f.flush()
        os.fsync(self._f.fileno())

    def close(self) -> None:
        self._f.close()


# ---------------------------------------------------------------------------
# the primitive
# ---------------------------------------------------------------------------
def _copy_with_hash(src: str, tmp: str) -> str:
    digest = hashlib.sha256()
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0)
    fd = os.open(winfs.long_path(tmp), flags)  # O_EXCL: never clobbers an existing file
    try:
        with open(winfs.long_path(src), "rb", buffering=0) as fin, os.fdopen(fd, "wb") as fout:
            while True:
                chunk = fin.read(hashing.CHUNK_SIZE)
                if not chunk:
                    break
                fout.write(chunk)
                digest.update(chunk)
            fout.flush()
            os.fsync(fout.fileno())
    except BaseException:
        try:
            os.remove(winfs.long_path(tmp))
        except OSError:
            pass
        raise
    return digest.hexdigest().upper()


def _rename_no_replace(src: str, dst: str) -> None:
    if winfs.IS_WINDOWS:
        os.rename(winfs.long_path(src), winfs.long_path(dst))  # MoveFileEx without REPLACE_EXISTING
    else:
        os.link(src, dst)  # fails if dst exists
        os.unlink(src)


def _same_volume(src_stat, dst_dir: str) -> bool:
    return src_stat.st_dev == os.stat(winfs.long_path(dst_dir)).st_dev


def safe_move(src: str, dst: str, expected_sha: str | None, verify: str = "auto", tmp_tag: str = "tmp") -> dict:
    """Move one file without ever overwriting. Returns details; raises on failure (source untouched)."""
    if os.path.lexists(winfs.long_path(dst)):
        raise FileExistsError(f"destination already exists: {dst}")
    os.makedirs(winfs.long_path(os.path.dirname(dst)), exist_ok=True)
    st = os.stat(winfs.long_path(src))
    if _same_volume(st, os.path.dirname(dst)):
        verification = "size + modified time unchanged since scan"
        if verify == "always" and expected_sha:
            sha, _ = hashing.sha256_file(src)
            if sha != expected_sha:
                raise ValueError("content no longer matches the SHA-256 recorded in the manifest")
            verification = "SHA-256 re-verified before rename"
        _rename_no_replace(src, dst)
        return {"method": "rename (same drive)", "verification": verification, "source_removed": True}

    tmp = f"{dst}.{tmp_tag}.partial"
    sha_src = _copy_with_hash(src, tmp)
    try:
        if expected_sha and sha_src != expected_sha:
            raise ValueError("source content no longer matches the SHA-256 recorded in the manifest")
        sha_copy, _ = hashing.sha256_file(tmp)
        if sha_copy != sha_src:
            raise IOError("the copy on the destination drive does not match the source (write error)")
        os.utime(winfs.long_path(tmp), ns=(st.st_atime_ns, st.st_mtime_ns))
        created = getattr(st, "st_birthtime", None)
        if created is not None:
            try:
                winfs.set_creation_time(tmp, created)
            except OSError:
                pass
        _rename_no_replace(tmp, dst)
    except BaseException:
        if os.path.lexists(winfs.long_path(tmp)):
            os.remove(winfs.long_path(tmp))  # our own partial copy, never user data
        raise
    try:
        os.remove(winfs.long_path(src))
        removed = True
    except OSError:
        removed = False
    return {"method": "copy + verify + delete (different drive)",
            "verification": "SHA-256 of source and copy match the manifest", "source_removed": removed}


def _free_name(dst: str, sha: str) -> str:
    base, ext = os.path.splitext(dst)
    tag = (sha or "")[:8].upper()
    n = 1
    while True:
        cand = f"{base}__{tag}__m{n}{ext}" if tag else f"{base}__m{n}{ext}"
        if not os.path.lexists(winfs.long_path(cand)):
            return cand
        n += 1


def _confirm(message: str, yes: bool, word: str, out) -> bool:
    if yes:
        return True
    if not sys.stdin or not sys.stdin.isatty():
        out("Refusing to continue without an interactive confirmation. Re-run in a terminal, or add --yes.")
        return False
    try:
        answer = input(f"{message}\nType {word} (in capitals) to proceed, anything else to cancel: ")
    except EOFError:
        return False
    return answer.strip() == word


# ---------------------------------------------------------------------------
# move
# ---------------------------------------------------------------------------
@dataclass
class MoveOptions:
    target: str
    execute: bool = False
    yes: bool = False
    include_invalid: bool = False
    approvals: str | None = None
    limit: int | None = None
    verify: str = "auto"
    quiet: bool = False


def select_operations(data: dict, opts: MoveOptions) -> tuple[list, list]:
    approvals = manifest.load_approvals(opts.approvals) if opts.approvals else None
    ops, excluded = [], []
    for r in data["records"]:
        dest = r.get("ProposedDestination")
        if not dest:
            excluded.append((r, r.get("OperationStatus") or "no destination"))
            continue
        invalid = r.get("IntegrityStatus") not in C.MOVABLE_STATUSES
        eligible = r.get("Approved") == "yes" or (invalid and opts.include_invalid and bool(r.get("SHA256")))
        reason = "" if eligible else ("invalid file - only with --include-invalid" if invalid else "not approved in manifest")
        if eligible and approvals is not None:
            a = approvals.get(r["RecordId"])
            if a is None:
                eligible, reason = False, "not listed in the approvals file"
            elif a[1] and a[1] != r.get("SHA256"):
                eligible, reason = False, "approvals row does not match this record (SHA-256 differs)"
            elif not a[0]:
                eligible, reason = False, "Approved = no in the approvals file"
        if eligible:
            ops.append(r)
        else:
            excluded.append((r, reason))
    if opts.limit is not None:
        # count only files still at their source, so repeated --limit runs continue where the last one stopped
        present = [r for r in ops if os.path.lexists(winfs.long_path(r["OriginalPath"]))]
        present_ids = {id(r) for r in present}
        excluded += [(r, "source no longer present (already moved?)") for r in ops if id(r) not in present_ids]
        excluded += [(r, f"beyond --limit {opts.limit}") for r in present[opts.limit:]]
        ops = present[:opts.limit]
    return ops, excluded


def _preflight(r: dict) -> str | None:
    src = r["OriginalPath"]
    try:
        st = os.stat(winfs.long_path(src))
    except FileNotFoundError:
        return "source file no longer exists (already moved, renamed or deleted?)"
    except OSError as exc:
        return f"cannot access source: {winfs.describe_error(exc)}"
    if r.get("FileSize") is not None and st.st_size != r["FileSize"]:
        return f"source changed since the scan (size {r['FileSize']:,} -> {st.st_size:,}); re-scan first"
    if r.get("MtimeNs") and st.st_mtime_ns != r["MtimeNs"]:
        return "source changed since the scan (modified time differs); re-scan first"
    return None


def _ops_row(entry: dict) -> dict:
    return {"OpId": entry.get("op_id"), "RecordId": entry.get("record_id"), "Status": entry.get("status"),
            "Method": entry.get("method", ""), "Verification": entry.get("verification", ""),
            "OriginalPath": entry.get("source"), "DestinationPath": entry.get("final_destination") or entry.get("destination"),
            "OriginalFilename": entry.get("original_filename"), "DestinationFilename": entry.get("destination_filename"),
            "SHA256": entry.get("sha256"), "FileSize": entry.get("size"), "StartedAt": entry.get("started"),
            "FinishedAt": entry.get("finished"), "Note": entry.get("note", ""), "Error": entry.get("error", "")}


def run_move(opts: MoveOptions, out=print, on_progress=None) -> int:
    notify = on_progress or (lambda **_: None)
    notify(phase="preparing")
    data = manifest.load_manifest(opts.target)
    run = data["run"]
    run_dir = os.path.dirname(data["_path"])
    dest_root = run["destination_root"]
    if winfs.is_within(dest_root, run["source_root"]):
        out("ERROR: the manifest's destination is inside its source - refusing to move.")
        return 2
    ops, excluded = select_operations(data, opts)
    total_bytes = sum(r.get("FileSize") or 0 for r in ops)
    reasons: dict = {}
    for _r, why in excluded:
        reasons[why] = reasons.get(why, 0) + 1

    out(f"Manifest:     {data['_path']}")
    out(f"Scanned:      {run['finished']}  (source {run['source_root']})")
    out(f"Destination:  {dest_root}")
    out(f"Files to move: {len(ops):,} ({human_bytes(total_bytes)})")
    for why, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        out(f"  not moving {n:,}: {why}")

    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    moves_dir = os.path.join(run_dir, "moves")
    os.makedirs(moves_dir, exist_ok=True)

    if not opts.execute:
        preview_path = os.path.join(moves_dir, f"preview_{stamp}.csv")
        rows = []
        for r in ops:
            problem = _preflight(r)
            dest_exists = os.path.lexists(winfs.long_path(r["ProposedDestination"]))
            rows.append({"RecordId": r["RecordId"], "OriginalPath": r["OriginalPath"],
                         "ProposedDestination": r["ProposedDestination"], "SHA256": r.get("SHA256"),
                         "FileSize": r.get("FileSize"), "Check": problem or "ok",
                         "DestinationExistsNow": "yes (will get a new name)" if dest_exists else "no"})
        manifest.write_csv(preview_path, rows, ["RecordId", "Check", "OriginalPath", "ProposedDestination",
                                                "DestinationExistsNow", "SHA256", "FileSize"])
        out("")
        for row in rows[:15]:
            out(f"  FROM {row['OriginalPath']}\n    TO {row['ProposedDestination']}" +
                ("" if row["Check"] == "ok" else f"   [{row['Check']}]"))
        if len(rows) > 15:
            out(f"  ... and {len(rows) - 15:,} more (see {preview_path})")
        problems = sum(1 for row in rows if row["Check"] != "ok")
        out("")
        out(f"PREVIEW ONLY - nothing was moved. {problems:,} of {len(rows):,} would currently be skipped by checks.")
        out(f"Full preview: {preview_path}")
        out(f"To perform the move (from the Media Organizer folder):  .\\media-organizer move \"{run_dir}\" --execute")
        return 0

    if not ops:
        out("Nothing to move.")
        return 0
    if not _confirm(f"\nAbout to MOVE {len(ops):,} files ({human_bytes(total_bytes)}) into {dest_root}.", opts.yes,
                    "MOVE", out):
        out("Cancelled - nothing was moved.")
        return 1

    move_dir = _unique_dir(os.path.join(moves_dir, f"move_{stamp}"))
    move_id = os.path.basename(move_dir)
    oplog = OpLog(os.path.join(move_dir, "operations.jsonl"))
    oplog.write({"type": "session", "format": C.OPLOG_FORMAT, "action": "move", "move_id": move_id,
                 "manifest": data["_path"], "source_root": run["source_root"], "destination_root": dest_root,
                 "started": _now(), "include_invalid": opts.include_invalid, "approvals": opts.approvals,
                 "verify": opts.verify})
    prog = Progress(enabled=not opts.quiet)
    finished, counts = [], {"success": 0, "skipped": 0, "failed": 0, "renamed_at_move_time": 0, "source_kept": 0}
    notify(phase="moving", total=len(ops))
    try:
        for i, r in enumerate(ops, 1):
            notify(phase="moving", completed=i - 1, total=len(ops), currentFile=r["OriginalPath"])
            prog.update(f"Moving {i:,}/{len(ops):,} | {r['OriginalPath']}")
            entry = {"type": "op", "op_id": i, "record_id": r["RecordId"], "source": r["OriginalPath"],
                     "destination": r["ProposedDestination"], "original_filename": r["OriginalFilename"],
                     "sha256": r.get("SHA256"), "size": r.get("FileSize"), "mtime_ns": r.get("MtimeNs"),
                     "started": _now()}
            problem = _preflight(r)
            if problem:
                entry.update(phase="end", status="skipped", note=problem, finished=_now())
                oplog.write(entry)
                finished.append(entry)
                counts["skipped"] += 1
                notify(phase="moving", completed=i, total=len(ops))
                continue
            final = r["ProposedDestination"]
            if os.path.lexists(winfs.long_path(final)):
                final = _free_name(final, r.get("SHA256"))
                entry["note"] = "a file appeared at the planned destination after the scan; used a new name instead"
                counts["renamed_at_move_time"] += 1
            entry["final_destination"] = final
            entry["destination_filename"] = os.path.basename(final)
            oplog.write(dict(entry, phase="begin"))
            try:
                detail = safe_move(r["OriginalPath"], final, r.get("SHA256"), opts.verify, tmp_tag=f"op{i}")
                status = "success" if detail["source_removed"] else "copied-source-kept"
                entry.update(phase="end", status=status, method=detail["method"],
                             verification=detail["verification"], finished=_now())
                if not detail["source_removed"]:
                    entry["note"] = (entry.get("note", "") + " verified copy made, but the source could not be "
                                     "removed - both copies kept").strip()
                    counts["source_kept"] += 1
                else:
                    counts["success"] += 1
            except Exception as exc:
                entry.update(phase="end", status="failed", error=f"{type(exc).__name__}: {exc}", finished=_now())
                counts["failed"] += 1
            oplog.write(entry)
            finished.append(entry)
            notify(phase="moving", completed=i, total=len(ops))
    except KeyboardInterrupt:
        prog.clear()
        out("\nInterrupted - the operation log is complete up to the last finished file.")
    finally:
        oplog.write({"type": "session_end", "finished": _now(), "counts": counts})
        oplog.close()
        prog.clear()

    notify(phase="finalizing", completed=len(finished), total=len(ops))
    ops_csv = os.path.join(move_dir, "operations.csv")
    manifest.write_csv(ops_csv, [_ops_row(e) for e in finished], OPS_CSV_COLUMNS)
    lines = ["MOVE COMPLETE" if not counts["failed"] else "MOVE FINISHED WITH ERRORS",
             f"  moved successfully:                 {counts['success']:,}",
             f"  skipped by safety checks:           {counts['skipped']:,}",
             f"  failed (source left in place):      {counts['failed']:,}",
             f"  new name at move time (no overwrite): {counts['renamed_at_move_time']:,}",
             f"  copied but source kept:             {counts['source_kept']:,}",
             f"  operation log:  {oplog.path}",
             f"  operations CSV: {ops_csv}",
             f"  undo (preview): .\\media-organizer undo \"{move_dir}\"",
             f"  undo (execute): .\\media-organizer undo \"{move_dir}\" --execute"]
    with open(os.path.join(move_dir, "move_summary.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    try:  # keep a copy of the log with the organised files
        log_copy = os.path.join(dest_root, C.LOGS_FOLDER, f"{run['id']}__{move_id}")
        os.makedirs(winfs.long_path(log_copy), exist_ok=True)
        for name in ("operations.jsonl", "operations.csv", "move_summary.txt"):
            shutil.copy2(os.path.join(move_dir, name), os.path.join(winfs.long_path(log_copy), name))
        lines.append(f"  log copy:       {log_copy}")
    except OSError as exc:
        lines.append(f"  (could not copy the log into the destination: {winfs.describe_error(exc)})")
    out("\n".join(lines))
    return 0 if not counts["failed"] else 3


# ---------------------------------------------------------------------------
# undo
# ---------------------------------------------------------------------------
def load_oplog(target: str) -> tuple[str, list, list]:
    path = os.path.join(target, "operations.jsonl") if os.path.isdir(target) else target
    if not os.path.isfile(path):
        raise FileNotFoundError(f"operation log not found: {path}")
    begins, ends = {}, {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            e = json.loads(line)
            if e.get("type") != "op":
                continue
            (begins if e.get("phase") == "begin" else ends)[e["op_id"]] = e
    done = [ends[i] for i in sorted(ends) if ends[i].get("status") in ("success", "copied-source-kept")]
    incomplete = [begins[i] for i in sorted(begins) if i not in ends]
    return path, done, incomplete


def run_undo(target: str, execute: bool = False, yes: bool = False, quiet: bool = False, out=print) -> int:
    path, done, incomplete = load_oplog(target)
    out(f"Operation log: {path}")
    out(f"Completed moves in log: {len(done):,}")
    for e in incomplete:
        out(f"WARNING: operation {e['op_id']} started but has no end record (interrupted?). "
            f"Check both {e['source']} and {e.get('final_destination')}")
    plan = []
    for e in reversed(done):
        if e.get("status") == "copied-source-kept":
            plan.append((e, "the original was never removed - nothing to restore"))
            continue
        cur, orig = e.get("final_destination"), e["source"]
        problem = None
        try:
            st = os.stat(winfs.long_path(cur))
            if e.get("size") is not None and st.st_size != e["size"]:
                problem = "file at the destination has a different size now - not touched"
        except OSError:
            problem = "file is no longer at its destination - not touched"
        if problem is None and os.path.lexists(winfs.long_path(orig)):
            problem = "a file already exists at the original location - not overwritten"
        plan.append((e, problem))
    ready = [e for e, p in plan if p is None]
    for e, p in plan:
        if p:
            out(f"  cannot restore op {e['op_id']}: {p}\n     {e.get('final_destination')}")
    out(f"Restorable: {len(ready):,}")
    if not execute:
        for e in ready[:15]:
            out(f"  FROM {e['final_destination']}\n    TO {e['source']}")
        out("PREVIEW ONLY - nothing was moved. Add --execute to restore these files.")
        return 0
    if not ready:
        return 0
    if not _confirm(f"\nAbout to move {len(ready):,} files back to their original locations.", yes, "UNDO", out):
        out("Cancelled - nothing was moved.")
        return 1
    undo_dir = _unique_dir(os.path.join(os.path.dirname(path), f"undo_{datetime.now().strftime('%Y-%m-%d_%H%M%S')}"))
    oplog = OpLog(os.path.join(undo_dir, "operations.jsonl"))
    oplog.write({"type": "session", "format": C.OPLOG_FORMAT, "action": "undo", "undo_of": path, "started": _now()})
    counts = {"success": 0, "failed": 0}
    rows = []
    prog = Progress(enabled=not quiet)
    try:
        for i, e in enumerate(ready, 1):
            prog.update(f"Restoring {i:,}/{len(ready):,} | {e['source']}")
            entry = {"type": "op", "op_id": i, "record_id": e.get("record_id"), "source": e["final_destination"],
                     "destination": e["source"], "final_destination": e["source"],
                     "original_filename": e.get("destination_filename"),
                     "destination_filename": e.get("original_filename"), "sha256": e.get("sha256"),
                     "size": e.get("size"), "started": _now(), "undo_of_op": e["op_id"]}
            oplog.write(dict(entry, phase="begin"))
            try:
                detail = safe_move(e["final_destination"], e["source"], e.get("sha256"), "auto", tmp_tag=f"undo{i}")
                entry.update(phase="end", status="success" if detail["source_removed"] else "copied-source-kept",
                             method=detail["method"], verification=detail["verification"], finished=_now())
                counts["success"] += 1
            except Exception as exc:
                entry.update(phase="end", status="failed", error=f"{type(exc).__name__}: {exc}", finished=_now())
                counts["failed"] += 1
            oplog.write(entry)
            rows.append(_ops_row(entry))
    finally:
        oplog.write({"type": "session_end", "finished": _now(), "counts": counts})
        oplog.close()
        prog.clear()
    manifest.write_csv(os.path.join(undo_dir, "operations.csv"), rows, OPS_CSV_COLUMNS)
    out(f"UNDO FINISHED: restored {counts['success']:,}, failed {counts['failed']:,}. Log: {oplog.path}")
    out("(Empty year/category folders created by the move are left in place; they can be deleted by hand.)")
    return 0 if not counts["failed"] else 3
