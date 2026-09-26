"""The dry-run scan: discover -> inspect -> hash -> probe -> date -> classify -> plan -> report.

A scan only READS the source tree.  Everything it writes goes to its own run
folder (which may not be inside the source), so a dry run can never move,
rename, overwrite or modify a media file.
"""
from __future__ import annotations

import json
import logging
import math
import os
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import asdict, dataclass
from datetime import datetime

from . import __version__
from . import classify, dates, hashing, manifest, metadata, mp4box, planner, report, scanner, tools, winfs
from . import constants as C
from .progress import Progress, human_bytes, human_duration

log = logging.getLogger("media_organizer")


class ScanError(Exception):
    """A problem that prevents the scan from starting (bad paths, missing tools...)."""


class ScanInterrupted(Exception):
    def __init__(self, run_dir: str):
        super().__init__(run_dir)
        self.run_dir = run_dir


@dataclass
class ScanOptions:
    source: str
    dest: str
    reports: str
    workers: int = 4
    hash_workers: int = 2
    duplicates: str = "all"
    min_class_confidence: str = C.LOW
    ffprobe: str | None = None
    exiftool: str | None = None
    use_exiftool: bool = True
    allow_missing_tools: bool = False
    require_exiftool: bool = False
    resume: str | None = None
    include_cloud_files: bool = False
    quiet: bool = False


def default_reports_dir() -> str:
    return os.path.join(tools.PROJECT_ROOT, "runs")


# ---------------------------------------------------------------------------
# preparation
# ---------------------------------------------------------------------------
def validate_paths(opts: ScanOptions) -> None:
    opts.source = os.path.abspath(opts.source)
    opts.dest = os.path.abspath(opts.dest)
    opts.reports = os.path.abspath(opts.reports)
    if not os.path.isdir(winfs.long_path(opts.source)):
        raise ScanError(f"source folder does not exist or is not a folder: {opts.source}")
    if winfs.is_within(opts.dest, opts.source):
        raise ScanError("the destination must not be the source folder or inside it "
                        f"(source: {opts.source}, destination: {opts.dest})")
    if winfs.is_within(opts.reports, opts.source):
        raise ScanError("the reports folder must not be inside the source folder - a dry run must not "
                        f"write anything into the source (reports: {opts.reports})")
    if opts.duplicates not in planner.DUPLICATE_POLICIES:
        raise ScanError(f"--duplicates must be one of {', '.join(planner.DUPLICATE_POLICIES)}")


def detect_tools(opts: ScanOptions, out=print) -> tuple:
    ffprobe = tools.find_tool("ffprobe", opts.ffprobe)
    if opts.use_exiftool:
        exif = tools.find_tool("exiftool", opts.exiftool)
    else:
        exif = tools.ToolInfo("exiftool", status="disabled", detail="--no-exiftool")
    problems = []
    if not ffprobe.ok:
        msg = [f"FFprobe is not usable: {ffprobe.describe()}"] + ["  " + h for h in tools.INSTALL_HELP["ffprobe"]]
        if opts.allow_missing_tools:
            out("WARNING: " + "\n".join(msg))
            out("WARNING: continuing without FFprobe (--allow-missing-tools): validation and metadata will rely "
                "on the built-in MP4 parser only.")
        else:
            problems.append("\n".join(msg) + "\n  (or re-run with --allow-missing-tools to use only the built-in parser)")
    if not exif.ok and exif.status != "disabled":
        msg = [f"ExifTool is not usable: {exif.describe()}"] + ["  " + h for h in tools.INSTALL_HELP["exiftool"]]
        if opts.require_exiftool:
            problems.append("\n".join(msg))
        else:
            out("NOTE: " + "\n".join(msg))
            out("NOTE: continuing without ExifTool - maker/XMP metadata will be less complete.")
    if problems:
        raise ScanError("\n\n".join(problems))
    return ffprobe, exif


def _new_run_dir(reports: str) -> str:
    os.makedirs(reports, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    path = os.path.join(reports, f"{stamp}_scan")
    n = 2
    while os.path.exists(path):
        path = os.path.join(reports, f"{stamp}_scan_{n}")
        n += 1
    os.makedirs(path)
    return path


def _setup_log(run_dir: str) -> logging.Handler:
    handler = logging.FileHandler(os.path.join(run_dir, "scan.log"), encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    return handler


def _load_cache(resume: str | None, needed_sources: set) -> dict:
    """Reuse hashes and metadata from a previous run for unchanged files."""
    if not resume:
        return {}
    folder = resume if os.path.isdir(resume) else os.path.dirname(resume)
    rows = []
    partial = os.path.join(folder, "records.partial.jsonl")
    if os.path.isfile(partial):
        with open(partial, encoding="utf-8") as f:
            for line in f:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    elif os.path.isfile(os.path.join(folder, "manifest.json")):
        with open(os.path.join(folder, "manifest.json"), encoding="utf-8") as f:
            rows = json.load(f).get("records", [])
    else:
        raise ScanError(f"--resume: no records.partial.jsonl or manifest.json in {folder}")
    cache = {}
    for r in rows:
        srcs = set((r.get("Metadata") or {}).get("sources") or [])
        if r.get("SHA256") and needed_sources <= srcs:
            cache[(r["OriginalPath"].lower(), r.get("FileSize"), r.get("MtimeNs"))] = r
    return cache


# ---------------------------------------------------------------------------
# per-file analysis
# ---------------------------------------------------------------------------
class _Context:
    def __init__(self, opts, ffprobe_path, exif_session, cache, stop):
        self.opts = opts
        self.ffprobe = ffprobe_path
        self.exif = exif_session
        self.cache = cache
        self.stop = stop
        self.hash_sem = threading.Semaphore(max(1, opts.hash_workers))
        self.lock = threading.Lock()
        self.bytes_done = 0
        self.active: dict = {}
        self.reused = 0
        self.now = datetime.now()

    def add_bytes(self, n: int) -> None:
        with self.lock:
            self.bytes_done += n


def _base_record(cand: scanner.Mp4Candidate, index: int) -> dict:
    name = os.path.basename(cand.path)
    return {
        "RecordId": f"F{index:06d}", "OriginalPath": cand.path, "OriginalFilename": name,
        "Extension": os.path.splitext(name)[1], "FileSize": cand.size if cand.size >= 0 else None,
        "MtimeNs": cand.mtime_ns, "RelativeFolder": "\\".join(cand.rel_parts), "RelParts": list(cand.rel_parts),
        "FilesystemCreated": winfs.format_local(cand.created), "FilesystemModified": winfs.format_local(cand.mtime),
        "FsCreatedTs": cand.created, "FsModifiedTs": cand.mtime,
        "SHA256": "", "IntegrityStatus": "", "IntegrityNotes": "", "Container": "", "Error": "",
        "MetadataSources": "", "ReviewerClassification": "", "ReviewerYear": "", "ReviewerNotes": "",
    }


def _integrity(box: dict, probe: dict | None, probe_msg: str | None, have_ffprobe: bool) -> tuple[str, list]:
    status = box["status"]
    notes = list(box["problems"]) + list(box["warnings"])
    streams = (probe or {}).get("streams") or []
    if status in C.MOVABLE_STATUSES and have_ffprobe:
        if not probe or "error" in probe or not streams:
            status = C.PROBE_FAILED
            notes.insert(0, f"FFprobe could not read the file: {probe_msg or 'no streams found'}")
        elif not any(s.get("codec_type") == "video" for s in streams):
            status = C.OK_WARNINGS
            notes.append("FFprobe found no decodable video stream although the container declares one")
        elif probe_msg:
            status = C.OK_WARNINGS
            notes.append(f"FFprobe reported: {probe_msg[:300]}")
    elif status == C.NOT_MP4 and streams and any(s.get("codec_type") == "video" for s in streams):
        fmt = (probe.get("format") or {}).get("format_long_name") or (probe.get("format") or {}).get("format_name")
        notes.append(f"FFprobe recognises it as '{fmt}' with a video stream: a real video in another "
                     "container format, but not an MP4")
    return status, notes


def _aspect(w, h) -> str:
    if not w or not h:
        return ""
    g = math.gcd(int(w), int(h))
    return f"{int(w) // g}:{int(h) // g} ({w / h:.3f})"


def _fill_technical(rec: dict, md: dict) -> None:
    v = md.get("video") or {}
    a = md.get("audio")
    rec.update({
        "Width": v.get("width"), "Height": v.get("height"),
        "DisplayWidth": v.get("display_width"), "DisplayHeight": v.get("display_height"),
        "Rotation": v.get("rotation"), "AspectRatio": _aspect(v.get("display_width"), v.get("display_height")),
        "Duration": round(md["duration"], 3) if md.get("duration") else None,
        "FrameRate": round(v["fps"], 3) if v.get("fps") else None,
        "VariableFrameRate": {True: "yes", False: "no"}.get(v.get("vfr"), ""),
        "VideoCodec": v.get("codec") or v.get("codec_tag") or "",
        "AudioCodec": (a.get("codec") or "") if a else "none",
        "BitRate": md.get("bit_rate"), "VideoBitRate": v.get("bit_rate"),
        "Encoder": md.get("encoder") or "",
        "HandlerNames": " / ".join(x for x in (md.get("handler_video"), md.get("handler_audio")) if x),
        "Make": md.get("make") or "", "Model": md.get("model") or "", "Software": md.get("software") or "",
        "GPS": (md.get("gps") or {}).get("text", ""),
        "MetadataComment": md.get("comment") or "", "MetadataTitle": md.get("title") or "",
        "OtherSignatureTags": md.get("signature_tags") or "",
        "MetadataSources": ", ".join(md.get("sources") or []),
    })


def analyse_record(rec: dict, now: datetime | None = None) -> dict:
    """(Re)compute dates and classification from the stored metadata of a record."""
    md = rec.get("Metadata") or {}
    if md:
        _fill_technical(rec, md)
    stem = os.path.splitext(rec["OriginalFilename"])[0]
    cands = dates.build_candidates(md.get("embedded_dates") or [], stem, rec.get("FsModifiedTs"),
                                   rec.get("FsCreatedTs"), now)
    rec.update(dates.resolve(cands, duration=md.get("duration"),
                             device_written=metadata.device_signature(md) if md else [],
                             processed_by=metadata.processing_signature(md) if md else None))
    em = md.get("embedded_modified")
    rec["EmbeddedModified"] = ""
    if em:
        c = dates.parse_embedded(dates.DateCandidate(2, "mvhd.modification_time", "modification", str(em)))
        rec["EmbeddedModified"] = (c.utc.strftime("%Y-%m-%d %H:%M:%S UTC") if c.utc else str(em)) if c.usable else str(em)
    rec.update(classify.classify(rec.get("RelParts") or [], rec["OriginalFilename"], md or None))
    return rec


def _box_summary(box: dict) -> dict:
    return {k: box.get(k) for k in ("format", "format_description", "container", "major_brand", "minor_version",
                                    "compatible_brands", "has_moov", "has_mdat", "fragmented", "moov_before_mdat",
                                    "truncated_box", "truncated_bytes", "trailing_bytes", "problems", "warnings")} | {
        "top_level_boxes": [b["type"] for b in box.get("top_level_boxes", [])[:40]]}


def process_file(cand: scanner.Mp4Candidate, index: int, ctx: _Context) -> dict:
    rec = _base_record(cand, index)
    with ctx.lock:
        ctx.active[index] = cand.path
    try:
        if cand.stat_error:
            rec.update(IntegrityStatus=C.UNREADABLE, IntegrityNotes=f"could not read file information: {cand.stat_error}")
            return analyse_record(rec, ctx.now)
        if cand.cloud_placeholder and not ctx.opts.include_cloud_files:
            rec.update(IntegrityStatus=C.CLOUD_PLACEHOLDER,
                       IntegrityNotes="online-only cloud file (e.g. OneDrive) - not downloaded or inspected; make it "
                                      "available offline or re-run with --include-cloud-files")
            return analyse_record(rec, ctx.now)

        cached = ctx.cache.get((cand.path.lower(), rec["FileSize"], cand.mtime_ns))
        if cached is not None:
            for k in ("SHA256", "IntegrityStatus", "IntegrityNotes", "Container", "Metadata", "Box",
                      "ProbeMessage", "ExifToolError"):
                rec[k] = cached.get(k)
            rec["Error"] = cached.get("Error") or ""
            ctx.add_bytes(rec["FileSize"] or 0)
            with ctx.lock:
                ctx.reused += 1
            return analyse_record(rec, ctx.now)

        errors = []
        box = mp4box.inspect_file(cand.path, cand.size)
        rec["Box"] = _box_summary(box)
        rec["Container"] = box.get("container") or box.get("format_description") or ""
        if box["status"] == C.UNREADABLE:
            rec.update(IntegrityStatus=C.UNREADABLE, IntegrityNotes="; ".join(box["problems"]))
            return analyse_record(rec, ctx.now)
        if ctx.stop.is_set():
            raise hashing.Interrupted()

        try:
            with ctx.hash_sem:
                sha, nbytes = hashing.sha256_file(cand.path, on_bytes=ctx.add_bytes, stop_event=ctx.stop)
        except OSError as exc:
            rec.update(IntegrityStatus=C.UNREADABLE,
                       IntegrityNotes=f"could not read the file for hashing: {winfs.describe_error(exc)}")
            return analyse_record(rec, ctx.now)
        rec["SHA256"] = sha
        if rec["FileSize"] is not None and nbytes != rec["FileSize"]:
            errors.append(f"file size changed during the scan ({rec['FileSize']:,} -> {nbytes:,} bytes); re-scan later")
            rec["FileSize"] = nbytes

        probe, probe_msg = None, None
        if ctx.ffprobe and box["status"] != C.EMPTY:
            probe, probe_msg = tools.run_ffprobe(ctx.ffprobe, cand.path)
        exif, exif_err = None, None
        if ctx.exif is not None and box["status"] != C.EMPTY:
            exif, exif_err = ctx.exif.read(cand.path)
            if exif_err:
                errors.append(f"ExifTool: {exif_err}")
        md = metadata.normalize(box, probe if probe and probe.get("streams") else None, exif)
        status, notes = _integrity(box, probe, probe_msg, bool(ctx.ffprobe))
        rec.update(IntegrityStatus=status, IntegrityNotes="; ".join(notes), Metadata=md,
                   ProbeMessage=probe_msg or "", ExifToolError=exif_err or "")
        rec["Error"] = "; ".join(errors)
        return analyse_record(rec, ctx.now)
    except hashing.Interrupted:
        raise
    except Exception as exc:  # one bad file must never stop the scan
        log.exception("unexpected error while processing %s", cand.path)
        rec["IntegrityStatus"] = rec.get("IntegrityStatus") or C.UNREADABLE
        rec["Error"] = f"unexpected error: {type(exc).__name__}: {exc}"
        try:
            return analyse_record(rec, ctx.now)
        except Exception:
            rec.setdefault("ResolvedYear", "Unknown")
            rec.setdefault("Classification", C.UNKNOWN)
            rec.setdefault("ClassificationConfidence", C.UNKNOWN_CONF)
            return rec
    finally:
        with ctx.lock:
            ctx.active.pop(index, None)


# ---------------------------------------------------------------------------
# main entry
# ---------------------------------------------------------------------------
def run_scan(opts: ScanOptions, out=print, on_progress=None) -> tuple[str, dict]:
    notify = on_progress or (lambda **_: None)
    notify(phase="preparing")
    validate_paths(opts)
    ffprobe_info, exif_info = detect_tools(opts, out)
    run_dir = _new_run_dir(opts.reports)
    handler = _setup_log(run_dir)
    started = datetime.now()
    t0 = time.monotonic()
    prog = Progress(enabled=not opts.quiet)
    stop = threading.Event()
    exif_session = tools.ExifToolSession(exif_info.path) if exif_info.ok else None
    try:
        log.info("scan started: source=%s dest=%s options=%s", opts.source, opts.dest, asdict(opts))
        log.info("tools: %s | %s", ffprobe_info.describe(), exif_info.describe())
        out(f"Media Organizer {__version__} - DRY RUN (read-only scan)")
        out(f"  Source:      {opts.source}")
        out(f"  Destination: {opts.dest}")
        out(f"  Run folder:  {run_dir}")
        out(f"  {ffprobe_info.describe()}")
        out(f"  {exif_info.describe()}")

        # ---- phase 1: discovery ----
        notify(phase="discovering")
        def on_walk(res, current):
            notify(phase="discovering", completed=len(res.candidates), currentFile=current)
            prog.update(f"Scanning directories... dirs {res.dirs_scanned:,} | files {res.files_examined:,} | "
                        f"MP4 {len(res.candidates):,} | {current}")

        try:
            walk = scanner.walk(opts.source, exclude=[opts.dest, opts.reports], on_progress=on_walk, stop_event=stop)
        except KeyboardInterrupt:
            stop.set()
            prog.clear()
            raise ScanInterrupted(run_dir)
        prog.line(f"Discovery finished: {walk.dirs_scanned:,} folders, {walk.files_examined:,} files, "
                  f"{len(walk.candidates):,} .mp4 files ({human_duration(walk.elapsed)})")
        log.info("discovery: dirs=%d files=%d mp4=%d skipped=%d", walk.dirs_scanned, walk.files_examined,
                 len(walk.candidates), len(walk.skipped))
        for s in walk.skipped:
            log.info("skipped %s: %s (%s)", s["Kind"], s["Path"], s["Reason"])

        # ---- phase 2: per-file analysis ----
        needed = {"ffprobe"} if ffprobe_info.ok else set()
        if exif_session:
            needed.add("exiftool")
        cache = _load_cache(opts.resume, needed)
        if opts.resume:
            out(f"  Resume: {len(cache):,} previously analysed files available for reuse")
        ctx = _Context(opts, ffprobe_info.path if ffprobe_info.ok else None, exif_session, cache, stop)
        total = len(walk.candidates)
        total_bytes = sum(max(c.size, 0) for c in walk.candidates)
        records = []
        partial_path = os.path.join(run_dir, "records.partial.jsonl")
        t_proc = time.monotonic()
        notify(phase="analyzing", total=total, bytesCompleted=0, totalBytes=total_bytes)
        with open(partial_path, "w", encoding="utf-8") as partial, \
                ThreadPoolExecutor(max_workers=max(1, opts.workers)) as pool:
            futures = {pool.submit(process_file, c, i + 1, ctx): c for i, c in enumerate(walk.candidates)}
            pending = set(futures)
            try:
                while pending:
                    done, pending = wait(pending, timeout=0.5, return_when=FIRST_COMPLETED)
                    for fut in done:
                        rec = fut.result()
                        records.append(rec)
                        partial.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
                        log.info("%s | %s | %s | %s | %s (%s) | %s", rec["RecordId"], rec["OriginalPath"],
                                 rec.get("IntegrityStatus"), rec.get("SHA256", "")[:12], rec.get("Classification"),
                                 rec.get("ClassificationConfidence"), rec.get("ResolvedYear"))
                    if done:
                        partial.flush()
                    elapsed = time.monotonic() - t_proc
                    with ctx.lock:
                        done_bytes = ctx.bytes_done
                        current = next(reversed(ctx.active.values()), "") if ctx.active else ""
                    rate = done_bytes / elapsed if elapsed > 0 else 0
                    eta = (total_bytes - done_bytes) / rate if rate > 0 else 0
                    notify(phase="analyzing", completed=len(records), total=total, currentFile=current,
                           bytesCompleted=done_bytes, totalBytes=total_bytes)
                    prog.update(f"Processing MP4 {len(records):,}/{total:,} | {human_bytes(done_bytes)}/"
                                f"{human_bytes(total_bytes)} | {human_bytes(rate)}/s | ETA {human_duration(eta)} | "
                                f"{current}")
            except (KeyboardInterrupt, hashing.Interrupted):
                stop.set()
                for f in pending:
                    f.cancel()
                prog.clear()
                out("\nInterrupted - finishing the files in progress...")
                for f in pending:
                    try:
                        if not f.cancelled():
                            rec = f.result()
                            partial.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
                    except BaseException:
                        pass
                partial.flush()
                raise ScanInterrupted(run_dir)
        prog.line(f"Analysis finished: {len(records):,} files in {human_duration(time.monotonic() - t_proc)}"
                  + (f" ({ctx.reused:,} reused from --resume)" if ctx.reused else ""))

        # ---- phase 3: duplicates, destinations, outputs ----
        notify(phase="finalizing", completed=len(records), total=total)
        records.sort(key=lambda r: r["RecordId"])
        groups = planner.assign_duplicates(records)
        plan_stats = planner.plan_destinations(records, opts.dest, opts.duplicates, opts.min_class_confidence)
        elapsed = time.monotonic() - t0
        summary = report.build_summary(records, walk, groups, plan_stats, elapsed)
        run_info = {
            "id": os.path.basename(run_dir), "mode": "dry-run", "started": started.isoformat(timespec="seconds"),
            "finished": datetime.now().isoformat(timespec="seconds"), "elapsed_seconds": round(elapsed, 1),
            "source_root": opts.source, "destination_root": opts.dest, "reports_dir": run_dir,
            "options": {k: v for k, v in asdict(opts).items() if k not in ("source", "dest", "reports")},
            "tools": {"ffprobe": ffprobe_info.as_dict(), "exiftool": exif_info.as_dict()},
            "local_timezone": time.tzname[0], "python": sys.version.split()[0], "tool_version": __version__,
        }
        data = {"format": C.MANIFEST_FORMAT, "format_version": C.MANIFEST_VERSION, "run": run_info,
                "summary": summary, "duplicate_groups": groups, "skipped": walk.skipped,
                "name_contains_mp4": walk.name_contains_mp4, "extension_counts": dict(walk.ext_counts),
                "records": records}
        manifest.write_run_outputs(run_dir, data)
        text = report.format_summary(summary, run_info)
        with open(os.path.join(run_dir, "summary.txt"), "w", encoding="utf-8") as f:
            f.write(text + "\n")
        out(text)
        log.info("scan finished in %.1fs", elapsed)
        return run_dir, data
    finally:
        if exif_session is not None:
            exif_session.close()
        log.removeHandler(handler)
        handler.close()
