"""Command-line interface.

  media-organizer check
  media-organizer scan  SOURCE --dest DEST          (dry run - the default and only scan mode)
  media-organizer move  RUN_FOLDER [--execute]       (preview unless --execute)
  media-organizer undo  MOVE_FOLDER [--execute]
  media-organizer snapshot FOLDER --out FILE.json
  media-organizer compare BEFORE.json AFTER.json
  media-organizer evaluate REVIEWED_MANIFEST.csv
  media-organizer                                    (interactive menu)
"""
from __future__ import annotations

import argparse
import csv
import glob
import os
import sys
from collections import Counter

from . import __version__
from . import constants as C
from . import mover, scan, snapshot, tools, winfs


def _fix_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream.isatty():
                stream.reconfigure(errors="replace")
            else:
                stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------
def cmd_check(args) -> int:
    print(f"Media Organizer {__version__} - dependency check")
    print(f"  Python {sys.version.split()[0]} at {sys.executable}: OK")
    ffprobe = tools.find_tool("ffprobe", args.ffprobe)
    exif = tools.find_tool("exiftool", args.exiftool)
    for info, role in ((ffprobe, "REQUIRED for scanning"), (exif, "recommended")):
        print(f"  [{role}]\n    {info.describe()}")
        if not info.ok and info.status == "missing":
            for line in tools.INSTALL_HELP[info.name]:
                print(f"      {line}")
    if winfs.IS_WINDOWS:
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\FileSystem") as k:
                enabled = winreg.QueryValueEx(k, "LongPathsEnabled")[0] == 1
        except OSError:
            enabled = False
        print(f"  Windows long paths: {'enabled' if enabled else 'not enabled'} "
              "(the organizer handles paths over 260 characters either way)")
    print("RESULT: ready to scan" if ffprobe.ok else "RESULT: FFprobe is required (or use --allow-missing-tools)")
    return 0 if ffprobe.ok else 2


def cmd_scan(args) -> int:
    opts = scan.ScanOptions(
        source=args.source, dest=args.dest, reports=args.reports or scan.default_reports_dir(),
        workers=args.workers, hash_workers=args.hash_workers, duplicates=args.duplicates,
        min_class_confidence=args.min_class_confidence.capitalize(), ffprobe=args.ffprobe, exiftool=args.exiftool,
        use_exiftool=not args.no_exiftool, allow_missing_tools=args.allow_missing_tools,
        require_exiftool=args.require_exiftool, resume=args.resume, include_cloud_files=args.include_cloud_files,
        quiet=args.quiet)
    try:
        scan.run_scan(opts)
    except scan.ScanError as exc:
        print(f"\nCANNOT START SCAN:\n{exc}", file=sys.stderr)
        return 2
    except scan.ScanInterrupted as exc:
        print(f"\nScan interrupted. Nothing was moved or modified. Partial results: {exc.run_dir}\n"
              f"Re-run with  --resume \"{exc.run_dir}\"  to reuse the files already analysed.", file=sys.stderr)
        return 130
    return 0


def cmd_move(args) -> int:
    opts = mover.MoveOptions(target=args.run, execute=args.execute, yes=args.yes,
                             include_invalid=args.include_invalid, approvals=args.approvals, limit=args.limit,
                             verify="always" if args.verify_hash else "auto", quiet=args.quiet)
    try:
        return mover.run_move(opts)
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


def cmd_undo(args) -> int:
    try:
        return mover.run_undo(args.log, execute=args.execute, yes=args.yes, quiet=args.quiet)
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


def cmd_snapshot(args) -> int:
    snap = snapshot.take(args.folder, with_hash=not args.no_hash, quiet=args.quiet)
    snapshot.save(snap, args.out)
    state = "does not exist" if not snap["exists"] else f"{snap['file_count']:,} files, {snap['dir_count']:,} folders"
    print(f"Snapshot of {snap['root']} ({state}) written to {args.out}")
    return 0


def cmd_compare(args) -> int:
    diff = snapshot.compare(snapshot.load(args.before), snapshot.load(args.after))
    print(snapshot.format_diff(diff))
    return 0 if snapshot.is_identical(diff) else 3


def cmd_evaluate(args) -> int:
    """Compare reviewer corrections in an edited manifest.csv with the tool's results."""
    with open(args.csv, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    reviewed = [r for r in rows if (r.get("ReviewerClassification") or "").strip()
                or (r.get("ReviewerYear") or "").strip()]
    if not reviewed:
        print("No rows have ReviewerClassification or ReviewerYear filled in.")
        return 1
    aliases = {c.lower(): c for c in list(C.CATEGORIES) + [C.UNKNOWN]}
    aliases.update({v.lower(): k for k, v in C.CATEGORY_FOLDERS.items()})
    cls_total = cls_ok = year_total = year_ok = 0
    by_conf, wrong = Counter(), []
    for r in reviewed:
        truth = aliases.get((r.get("ReviewerClassification") or "").strip().lower())
        if truth:
            cls_total += 1
            hit = truth == r.get("Classification")
            cls_ok += hit
            by_conf[(r.get("ClassificationConfidence"), hit)] += 1
            if not hit:
                wrong.append({"RecordId": r.get("RecordId"), "OriginalPath": r.get("OriginalPath"), "Kind": "classification",
                              "Tool": f"{r.get('Classification')} ({r.get('ClassificationConfidence')})",
                              "Reviewer": truth, "Evidence": r.get("ClassificationEvidence"),
                              "ReviewerNotes": r.get("ReviewerNotes")})
        year = (r.get("ReviewerYear") or "").strip()
        if year:
            year_total += 1
            hit = year == (r.get("ResolvedYear") or "")
            year_ok += hit
            if not hit:
                wrong.append({"RecordId": r.get("RecordId"), "OriginalPath": r.get("OriginalPath"), "Kind": "year",
                              "Tool": f"{r.get('ResolvedYear')} ({r.get('DateConfidence')}, {r.get('DateSource')})",
                              "Reviewer": year, "Evidence": r.get("DateNotes"), "ReviewerNotes": r.get("ReviewerNotes")})
    if cls_total:
        print(f"Classification: {cls_ok}/{cls_total} correct ({100 * cls_ok / cls_total:.0f}%)")
        for level in (C.HIGH, C.MEDIUM, C.LOW, C.UNKNOWN_CONF):
            ok, bad = by_conf[(level, True)], by_conf[(level, False)]
            if ok or bad:
                print(f"  {level:<8} confidence: {ok}/{ok + bad} correct")
    if year_total:
        print(f"Year: {year_ok}/{year_total} correct ({100 * year_ok / year_total:.0f}%)")
    out = os.path.join(os.path.dirname(os.path.abspath(args.csv)), "evaluation_mismatches.csv")
    from .manifest import write_csv
    write_csv(out, wrong, ["RecordId", "Kind", "Tool", "Reviewer", "OriginalPath", "Evidence", "ReviewerNotes"])
    print(f"Mismatches ({len(wrong)}) written to {out} - use them to tune the rules in classify.py / dates.py.")
    return 0


# ---------------------------------------------------------------------------
# interactive menu
# ---------------------------------------------------------------------------
def _ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        value = input(f"{prompt}{suffix}: ")
    except EOFError:
        value = ""
    value = value.strip().strip('"').strip("'").strip()  # pasted paths often carry quotes
    return value or default


def _yes(prompt: str, default: str) -> bool:
    return _ask(f"{prompt} (yes/no)", default).lower() in ("yes", "y")


def _last_destination() -> str:
    """Destination used by the most recent scan (read from its summary.txt)."""
    for summary in sorted(glob.glob(os.path.join(scan.default_reports_dir(), "*_scan*", "summary.txt")), reverse=True):
        try:
            with open(summary, encoding="utf-8") as f:
                for line in f:
                    if line.startswith("Destination:"):
                        return line.split(":", 1)[1].split("   (")[0].strip()
        except OSError:
            continue
    return ""


def _menu_scan(source: str) -> str | None:
    """Dry-run scan from the menu; returns the run folder, or None."""
    dest = _ask("Destination root (where organised files will go)", _last_destination() or r"E:\Organized Videos")
    opts = scan.ScanOptions(source=source, dest=dest, reports=scan.default_reports_dir())
    try:
        run_dir, _data = scan.run_scan(opts)
        return run_dir
    except scan.ScanError as exc:
        print(f"\nCANNOT START SCAN:\n{exc}")
    except scan.ScanInterrupted as exc:
        print(f"\nScan interrupted - nothing was moved or modified. Partial results: {exc.run_dir}")
    return None


def _menu_move(run_dir: str) -> int:
    """Preview a move, then execute only if the user says so (and types MOVE)."""
    rc = cmd_move(build_parser().parse_args(["move", run_dir]))
    if rc == 0 and _yes("Execute this move now?", "no"):
        return cmd_move(build_parser().parse_args(["move", run_dir, "--execute"]))
    return rc


def _scan_then_offer_move(source: str) -> int:
    run_dir = _menu_scan(source)
    if not run_dir:
        return 2
    if _yes("\nPreview moving these files now? (nothing moves without a second confirmation)", "yes"):
        return _menu_move(run_dir)
    print(f"Later: run .\\media-organizer, choose [2] and pick {run_dir}")
    return 0


def cmd_menu(_args=None) -> int:
    print(f"\nMedia Organizer {__version__} (prototype)\n")
    print("  [1] Organise a folder - scan it (dry run), then optionally preview and move")
    print("  [2] Move              - using a scan you already ran (preview first, then confirm)")
    print("  [3] Undo              - restore files moved by an earlier move")
    print("  [4] Check             - verify FFprobe / ExifTool are available")
    print("  [Q] Quit\n")
    choice = _ask("Select").lower()
    if choice == "1":
        source = _ask("Folder to organise (paste its path, e.g. D:\\Old Phone Backups)")
        if not source:
            print("A folder is required.")
            return 2
        return _scan_then_offer_move(source)
    if choice == "2":
        runs = sorted(glob.glob(os.path.join(scan.default_reports_dir(), "*_scan*", "manifest.json")))[-9:]
        if not runs:
            print("No scans yet - choose [1] to scan a folder first.")
        for i, m in enumerate(runs, 1):
            print(f"  [{i}] {os.path.dirname(m)}")
        pick = _ask("Scan to use (number, or path of a scan folder)")
        target = os.path.dirname(runs[int(pick) - 1]) if pick.isdigit() and 0 < int(pick) <= len(runs) else pick
        if not target:
            return 2
        is_scan = os.path.isfile(target) or os.path.isfile(os.path.join(target, "manifest.json"))
        if not is_scan and os.path.isdir(target):
            print(f"\nThat is a folder to organise, not a scan result:\n  {target}")
            if _yes("Scan it now? (a dry run - changes nothing)", "yes"):
                return _scan_then_offer_move(target)
            return 0
        return _menu_move(target)
    if choice == "3":
        logs = sorted(glob.glob(os.path.join(scan.default_reports_dir(), "*", "moves", "move_*", "operations.jsonl")))[-9:]
        for i, m in enumerate(logs, 1):
            print(f"  [{i}] {os.path.dirname(m)}")
        pick = _ask("Move to undo (number or folder path)")
        target = os.path.dirname(logs[int(pick) - 1]) if pick.isdigit() and 0 < int(pick) <= len(logs) else pick
        if not target:
            return 2
        rc = cmd_undo(build_parser().parse_args(["undo", target]))
        if rc == 0 and _ask("Execute this undo now? (yes/no)", "no").lower() == "yes":
            return cmd_undo(build_parser().parse_args(["undo", target, "--execute"]))
        return rc
    if choice == "4":
        return cmd_check(build_parser().parse_args(["check"]))
    return 0


# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="media-organizer",
                                description="Prototype MP4 inventory / organiser for old phone backups. "
                                            "Scans are always dry runs; moving is a separate, explicit step.")
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="command")

    tool_args = argparse.ArgumentParser(add_help=False)
    tool_args.add_argument("--ffprobe", help="path to ffprobe.exe (default: auto-detect)")
    tool_args.add_argument("--exiftool", help="path to exiftool.exe (default: auto-detect)")

    c = sub.add_parser("check", parents=[tool_args], help="check that FFprobe / ExifTool are available")
    c.set_defaults(func=cmd_check)

    s = sub.add_parser("scan", parents=[tool_args], help="DRY RUN: inventory, analyse and plan (moves nothing)")
    s.add_argument("source", help="folder to scan recursively")
    s.add_argument("--dest", required=True, help="destination root for the proposed organisation")
    s.add_argument("--reports", help=f"where run folders are written (default: {scan.default_reports_dir()})")
    s.add_argument("--workers", type=int, default=4, help="files analysed in parallel (default 4)")
    s.add_argument("--hash-workers", type=int, default=2,
                   help="files hashed in parallel (default 2; use 1 for a slow USB hard drive)")
    s.add_argument("--duplicates", choices=["all", "separate", "leave"], default="all",
                   help="all: every copy goes to the year/category folder (default); separate: extra copies go "
                        "to _Duplicates; leave: extra copies stay where they are")
    s.add_argument("--min-class-confidence", choices=["low", "medium", "high"], default="low",
                   help="classifications below this confidence are filed under 'Unknown' (default: low)")
    s.add_argument("--no-exiftool", action="store_true", help="do not use ExifTool even if installed")
    s.add_argument("--require-exiftool", action="store_true", help="refuse to scan without ExifTool")
    s.add_argument("--allow-missing-tools", action="store_true",
                   help="scan even without FFprobe (built-in MP4 parser only)")
    s.add_argument("--resume", help="previous run folder: reuse hashes/metadata of unchanged files")
    s.add_argument("--include-cloud-files", action="store_true",
                   help="also read online-only cloud files (this downloads them)")
    s.add_argument("--quiet", action="store_true", help="no progress display")
    s.set_defaults(func=cmd_scan)

    m = sub.add_parser("move", help="MOVE APPROVED FILES from a scan (preview unless --execute)")
    m.add_argument("run", help="scan run folder (or its manifest.json)")
    m.add_argument("--execute", action="store_true", help="actually move files (otherwise preview only)")
    m.add_argument("--yes", action="store_true", help="skip the typed confirmation (for scripts)")
    m.add_argument("--include-invalid", action="store_true",
                   help="also move invalid/unreadable-but-hashed MP4s into _Invalid or Unreadable")
    m.add_argument("--approvals", help="edited copy of manifest.csv: only rows with Approved=yes are moved")
    m.add_argument("--limit", type=int, help="move at most N files (try a small batch first)")
    m.add_argument("--verify-hash", action="store_true",
                   help="re-hash every file before a same-drive move (slower; cross-drive moves always verify)")
    m.add_argument("--quiet", action="store_true")
    m.set_defaults(func=cmd_move)

    u = sub.add_parser("undo", help="move files back using a move's operation log (preview unless --execute)")
    u.add_argument("log", help="move folder (…\\moves\\move_…) or its operations.jsonl")
    u.add_argument("--execute", action="store_true")
    u.add_argument("--yes", action="store_true")
    u.add_argument("--quiet", action="store_true")
    u.set_defaults(func=cmd_undo)

    sn = sub.add_parser("snapshot", help="record every file/folder (size, times, SHA-256) under a folder")
    sn.add_argument("folder")
    sn.add_argument("--out", required=True)
    sn.add_argument("--no-hash", action="store_true", help="skip hashing (faster, less thorough)")
    sn.add_argument("--quiet", action="store_true")
    sn.set_defaults(func=cmd_snapshot)

    cp = sub.add_parser("compare", help="compare two snapshots (exit code 0 = identical)")
    cp.add_argument("before")
    cp.add_argument("after")
    cp.set_defaults(func=cmd_compare)

    ev = sub.add_parser("evaluate", help="score the tool against ReviewerClassification/ReviewerYear columns")
    ev.add_argument("csv", help="manifest.csv with the Reviewer* columns filled in")
    ev.set_defaults(func=cmd_evaluate)
    return p


def main(argv=None) -> int:
    _fix_console()
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "command", None):
        return cmd_menu()
    try:
        return args.func(args)
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
