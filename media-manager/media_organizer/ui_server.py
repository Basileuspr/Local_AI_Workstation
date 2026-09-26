"""Local UI adapter. The scanner and mover remain the authoritative engines.

Run with python -m media_organizer.ui_server. No additional packages required.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import custom_folders, manifest, mover, scan, media_actions, frames, image_tools, catalog, folder_browser, captures
from .progress import JobProgress
from .thumbnails import ThumbnailCache, ThumbnailUnavailable

WEB_ROOT = Path(__file__).resolve().parent.parent / "frontend"


def choose_folder(title: str) -> str:
    # Tk must run on its own main thread, separate from HTTP request threads.
    script = """import json, sys, tkinter as tk
from tkinter import filedialog
root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)
try:
    path = filedialog.askdirectory(title=sys.argv[1], parent=root)
    print(json.dumps(path))
finally:
    root.destroy()
"""
    result = subprocess.run([sys.executable, "-c", script, title], capture_output=True,
                            text=True, encoding="utf-8", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise ValueError("The folder picker could not open. Paste the full folder path instead.")
    return json.loads(result.stdout)


class UIState:
    def __init__(self, reports: str):
        self.reports = Path(reports).resolve()
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.closing = False
        self.job = {"status": "idle", "kind": "", "message": "Ready", "runId": None}
        self.progress = None
        self.thumbnails = ThumbnailCache()
        self.frame_probes = {}
        self.frame_timelines = {}
        self.image_batches = {}
        self.cancel_event = threading.Event()

    def job_snapshot(self):
        with self.lock:
            return dict(self.job, progress=self.progress.snapshot() if self.progress else None)

    def run_path(self, run_id: str) -> Path:
        if not re.fullmatch(r"[\w-]+", run_id or ""):
            raise ValueError("Choose a saved scan first.")
        path = (self.reports / run_id).resolve()
        if path.parent != self.reports:
            raise ValueError("Invalid scan folder.")
        return path

    def runs(self) -> list:
        result = []
        for file in sorted(self.reports.glob("*/manifest.json"), reverse=True):
            try:
                data = manifest.load_manifest(str(file))
                result.append({"id": file.parent.name, "source": data["run"]["source_root"],
                               "finished": data["run"]["finished"], "count": len(data["records"])})
            except (OSError, ValueError, KeyError):
                continue
        return result

    def library(self, run_id: str) -> dict:
        if run_id == catalog.ALL_SCANS:
            return catalog.library(self)
        path = self.run_path(run_id)
        data = manifest.load_manifest(str(path))
        moved = {}
        logs = list((path / 'moves').rglob('operations.jsonl')) if (path / 'moves').exists() else []
        shared_moves = self.reports / catalog.ALL_SCANS / 'moves'
        if shared_moves.exists(): logs.extend(shared_moves.rglob('operations.jsonl'))
        for log in sorted(logs, key=lambda file: (file.stat().st_mtime_ns, str(file))):
            # An active log may have a partial last line. Completed records remain usable.
            for line in log.read_text(encoding="utf-8").splitlines():
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if entry.get("phase") == "end" and entry.get("status") in ("success", "copied-source-kept"):
                    record_id = str(entry['record_id'])
                    if log.is_relative_to(shared_moves):
                        if not record_id.startswith(run_id + '~'): continue
                        record_id = record_id[len(run_id) + 1:]
                    moved.setdefault(record_id, []).append(entry)
        saved_folders = custom_folders.folders(self.reports)
        folder_paths = {Path(folder['path']).resolve(): folder['id'] for folder in saved_folders}
        rotations = self.rotations()
        metadata = media_actions.metadata(self.reports)
        for row in data["records"]:
            row["RecordId"] = str(row["RecordId"])
            row['ViewRotation'] = rotations.get(f"item:{run_id}:{row['RecordId']}", rotations.get(row.get('SHA256'), 0))
            history = moved.get(row['RecordId'], [])
            candidates = [location for entry in reversed(history) for location in
                          (entry.get('final_destination') or entry['destination'], entry['source'])]
            current = next((location for location in candidates if os.path.isfile(location)), row['OriginalPath'])
            row['Moved'] = Path(current).resolve() != Path(row['OriginalPath']).resolve() and os.path.isfile(current)
            row['ActualDestination'] = current if row['Moved'] else ''
            row['CurrentPath'] = current
            row['KnownPaths'] = list(dict.fromkeys([row['OriginalPath'], *candidates]))
            row['ScannedFilename'] = row['OriginalFilename']
            row['OriginalFilename'] = Path(current).name
            latest = history[-1] if history else {}
            row['Trashed'] = latest.get('media_action') == 'delete' and current == latest.get('final_destination')
            row['RestorePath'] = latest.get('source', '') if row['Trashed'] else ''
            row['TagIds'] = metadata['assignments'].get(row.get('SHA256'), [])
            row['Tags'] = [tag['name'] for tag in metadata['tags'] if tag['id'] in row['TagIds']]
            row["Available"] = os.path.isfile(row["CurrentPath"])
            row['CustomFolderId'] = folder_paths.get(Path(current).resolve().parent, '') if row['Available'] else ''
        data["uiRunId"] = run_id
        data['customFolders'] = saved_folders
        data['tags'] = metadata['tags']
        by_hash = {}
        for row in data['records']:
            if row.get('SHA256'): by_hash.setdefault(row['SHA256'], []).append(row)
        for members in by_hash.values():
            active = [r for r in members if r['Available'] and not r['Trashed']]
            primary = next((r for r in active if r.get('DuplicatePrimary') == 'yes'), active[0] if active else None)
            for row in members:
                row['ActiveCopies'] = len(active)
                if len(members) > 1: row['DuplicatePrimary'] = 'yes' if row is primary else 'no'
        return data

    def rotations(self):
        file = self.reports / 'view-rotations.json'
        return json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}

    def rotate(self, run_id, record_id, direction):
        if type(direction) is not int or direction not in (-1, 1):
            raise ValueError('Choose left or right rotation.')
        with self.lock:
            row = next((row for row in self.library(run_id)['records'] if row['RecordId'] == str(record_id)), None)
            if not row or not re.fullmatch(r'[a-fA-F0-9]{64}', row.get('SHA256', '')):
                raise ValueError('Choose a scanned media item first.')
            rotations = self.rotations()
            key = f"item:{row.get('OriginRunId', run_id)}:{row.get('OriginRecordId', row['RecordId'])}"
            angle = (row['ViewRotation'] + direction * 90) % 360
            rotations[key] = angle
            file = self.reports / 'view-rotations.json'
            temporary = file.with_suffix('.tmp')
            temporary.write_text(json.dumps(rotations), encoding='utf-8')
            temporary.replace(file)
            return {'rotation': angle, 'recordId': row['RecordId']}

    def media_path(self, run_id: str, record_id: str, data=None) -> Path:
        if run_id == catalog.ALL_SCANS and data is None:
            source_run, source_record = catalog.split_record(record_id)
            return self.media_path(source_run, source_record)
        data = data if data is not None else self.library(run_id)
        row = next((r for r in data["records"] if r["RecordId"] == record_id), None)
        if not row or not row["Available"]:
            raise ValueError("This file is no longer available. Re-scan its current folder.")
        path = Path(row["CurrentPath"]).resolve()
        roots = ([Path(row[key]).resolve() for key in ('ScanSource', 'ScanDestination')] if data.get('aggregate')
                 else [Path(data["run"][key]).resolve() for key in ("source_root", "destination_root")])
        roots.extend(Path(folder['path']).resolve() for folder in custom_folders.folders(self.reports))
        if path.suffix.lower() != ".mp4" or not any(path.is_relative_to(root) for root in roots):
            raise ValueError("The media path is outside this scan's folders.")
        return path

    def start(self, kind: str, payload: dict) -> dict:
        with self.lock:
            if self.closing:
                raise ValueError("Media Manager is closing. Reopen it before starting another operation.")
            if self.job["status"] == "running":
                raise ValueError("An operation is already running. Wait for it to finish.")
            if kind in ('move', 'custom-move') and payload.get("confirmation") != "MOVE":
                raise ValueError("Type MOVE to confirm moving the reviewed files.")
            if kind == "scan":
                if not payload.get("source", "").strip() or not payload.get("destination", "").strip():
                    raise ValueError("Choose both a source and a destination folder.")
                opts = scan.ScanOptions(source=payload["source"], dest=payload["destination"],
                                        reports=str(self.reports), duplicates=payload.get("duplicates", "all"), quiet=True)
                scan.validate_paths(opts)
                source, destination = Path(opts.source).resolve(), Path(opts.dest).resolve()
                if source.is_relative_to(destination) or destination.is_relative_to(source):
                    raise ValueError("Choose separate source and destination folders; neither may contain the other.")
            elif kind == "move":
                if payload.get('runId') == catalog.ALL_SCANS:
                    raise ValueError('Choose a specific saved scan to review its archive plan, or select clips and use Place in folder.')
                target = self.run_path(payload.get("runId"))
                manifest.load_manifest(str(target))
            elif kind == 'custom-move':
                plan = custom_folders.consume_plan(self, payload.get('runId'), payload.get('planId'))
            elif kind in ('image-inspect', 'image-process'):
                pass
            elif kind in ('file-action', 'frame-info', 'frame-extract', 'frame-timeline', 'snapshot', 'clip'):
                media_actions.current_row(self, payload)
            else:
                raise ValueError("Unknown operation.")
            self.job = {"status": "running", "kind": kind, "message": {"image-inspect":"Reading image folder…", "image-process":"Processing image copies…", "scan":"Scanning files…", "frame-info":"Counting video frames…", "frame-timeline":"Reading frame timing…", "snapshot":"Saving snapshot…", "clip":"Creating video clip…", "frame-extract":"Parsing video frames…", "file-action":"Updating the selected file…"}.get(kind, "Moving reviewed files…"),
                        "runId": payload.get("runId")}
            self.progress = JobProgress()
            self.cancel_event = threading.Event()
            self.job['id'] = secrets.token_hex(16)

            def work():
                try:
                    if kind == "scan":
                        run_dir, data = scan.run_scan(opts, out=lambda *_: None, on_progress=self.progress.update)
                        result = {"runId": Path(run_dir).name, "message": f"Scan complete. {len(data['records'])} MP4 files found. Nothing has moved."}
                    elif kind == 'custom-move':
                        result = custom_folders.execute(self, plan, self.progress.update)
                    elif kind == 'image-inspect':
                        result = image_tools.inspect(self, payload, self.progress.update, self.cancel_event)
                    elif kind == 'image-process':
                        result = image_tools.execute(self, payload, self.progress.update, self.cancel_event)
                    elif kind == 'file-action':
                        result = media_actions.execute(self, payload, self.progress.update)
                    elif kind in ('snapshot', 'clip'):
                        result = captures.execute(self, payload, self.progress.update, self.cancel_event, kind)
                    elif kind == 'frame-timeline':
                        result = frames.timeline(self, payload, self.progress.update, self.cancel_event)
                    elif kind == 'frame-info':
                        result = frames.inspect(self, payload, self.progress.update, self.cancel_event)
                    elif kind == 'frame-extract':
                        result = frames.extract(self, payload, self.progress.update, self.cancel_event)
                    else:
                        output = []
                        code = mover.run_move(mover.MoveOptions(str(target), execute=True, yes=True,
                                                               verify="always", quiet=True), out=output.append,
                                              on_progress=self.progress.update)
                        result = {"runId": target.name, "message": "Move finished. Review the file locations and operation report.",
                                  "details": "\n".join(output), "status": "complete" if code == 0 else "error"}
                        if code:
                            result["message"] = "Some files could not be moved. Check the operation report before retrying."
                    with self.lock:
                        self.job.update(status="complete", **{k: v for k, v in result.items() if k != "status"})
                        self.job["status"] = result.get("status", "complete")
                        self.progress.finish(self.job["status"] == "complete")
                except Exception as exc:
                    with self.lock:
                        self.job.update(status="error", message=str(exc))
                        self.progress.finish(False)
            threading.Thread(target=work, daemon=True).start()
            return self.job_snapshot()


class UIHandler(BaseHTTPRequestHandler):
    server_version = "MediaOrganizer/1"

    def log_message(self, *_):
        pass  # Media URLs contain session credentials; do not log request URLs.

    @property
    def state(self):
        return self.server.state

    def guarded(self, authenticated=False):
        origin = f"http://127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host") != urlsplit(origin).netloc:
            raise PermissionError("Invalid host.")
        if self.headers.get("Origin") not in (None, origin):
            raise PermissionError("Cross-origin requests are not allowed.")
        if self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
            raise PermissionError("Cross-site requests are not allowed.")
        if authenticated:
            query = parse_qs(urlsplit(self.path).query)
            token = self.headers.get("X-Organizer-Token", "") or query.get("token", [""])[0]
            if not secrets.compare_digest(token, self.state.token):
                raise PermissionError("Session expired. Reload the page.")

    def send_headers(self, status, content_type, size, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_headers(status, "application/json; charset=utf-8", len(raw))
        self.wfile.write(raw)

    def do_GET(self):
        try:
            route = urlsplit(self.path)
            self.guarded(route.path.startswith("/api/"))
            query = parse_qs(route.query)
            if route.path == "/api/state":
                job = self.state.job_snapshot()
                return self.json({"job": job, "runs": self.state.runs(), 'customFolders': custom_folders.folders(self.state.reports), 'tags': media_actions.metadata(self.state.reports)['tags'], 'managedRoot': str(folder_browser.media_root(self.state.reports))})
            if route.path == '/api/capture-media':
                path = captures.media_path(self.state, query.get('id', [''])[0])
                if path.suffix == '.mp4': return self.stream_media(path)
                raw = path.read_bytes(); self.send_headers(200, 'image/png', len(raw)); self.wfile.write(raw); return
            if route.path == '/api/browse-folders':
                return self.json(folder_browser.browse(self.state.reports, query.get('path', [''])[0]))
            if route.path == "/api/library":
                return self.json(self.state.library(query.get("runId", [""])[0]))
            if route.path == '/api/frame-timeline':
                with self.state.lock:
                    times = self.state.frame_timelines.get(query.get('id', [''])[0])
                if times is None: raise ValueError('Frame timing expired. Reopen the player to read it again.')
                return self.json({'frameTimeline': times})
            if route.path == "/api/media":
                path = self.state.media_path(query.get("runId", [""])[0], query.get("recordId", [""])[0])
                return self.stream_media(path)
            if route.path == "/api/thumbnail":
                path = self.state.media_path(query.get("runId", [""])[0], query.get("recordId", [""])[0])
                try:
                    raw = self.state.thumbnails.get(path, query.get("size", ["small"])[0])
                except ThumbnailUnavailable as exc:
                    return self.json({"error": str(exc)}, 404)
                self.send_headers(200, "image/jpeg", len(raw))
                self.wfile.write(raw)
                return
            assets = {"/": ("index.html", "text/html"), "/organizer.js": ("organizer.js", "text/javascript"),
                      "/organizer.css": ("organizer.css", "text/css"), "/adapter.js": ("adapter.js", "text/javascript"),
                      "/library.js": ("library.js", "text/javascript"), "/actions.js": ("actions.js", "text/javascript"), "/image-tools.js": ("image-tools.js", "text/javascript"), "/playback.js": ("playback.js", "text/javascript"), "/folder-picker.js": ("folder-picker.js", "text/javascript"), "/captures.js": ("captures.js", "text/javascript")}
            if route.path not in assets:
                return self.json({"error": "Not found"}, 404)
            filename, mime = assets[route.path]
            raw = (WEB_ROOT / filename).read_bytes().replace(b"__SESSION_TOKEN__", self.state.token.encode())
            self.send_headers(200, mime + "; charset=utf-8", len(raw))
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except PermissionError as exc:
            self.json({"error": str(exc)}, 403)
        except (ValueError, OSError, KeyError) as exc:
            self.json({"error": str(exc)}, 400)

    def stream_media(self, path):
        with path.open("rb") as file:
            size = os.fstat(file.fileno()).st_size
            start, end, status = 0, size - 1, 200
            extra = {"Accept-Ranges": "bytes"}
            requested = self.headers.get("Range")
            if requested:
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", requested)
                if not match or not any(match.groups()):
                    self.send_headers(416, "video/mp4", 0, {"Content-Range": f"bytes */{size}"})
                    return
                left, right = match.groups()
                if left:
                    start = int(left)
                    end = min(int(right), size - 1) if right else size - 1
                else:
                    start = max(0, size - int(right))
                if start > end or start >= size:
                    self.send_headers(416, "video/mp4", 0, {"Content-Range": f"bytes */{size}"})
                    return
                status = 206
                extra["Content-Range"] = f"bytes {start}-{end}/{size}"
            self.send_headers(status, "video/mp4", max(0, end - start + 1), extra)
            file.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = file.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_POST(self):
        try:
            self.guarded(True)
            size = int(self.headers.get("Content-Length", "0"))
            maximum = 68*1024**2 if urlsplit(self.path).path == '/api/snapshot' else 524288
            if size < 0 or size > maximum:
                raise ValueError("Request is too large.")
            data = json.loads(self.rfile.read(size) or b"{}")
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object.")
            route = urlsplit(self.path).path
            if route == '/api/rotate':
                return self.json(self.state.rotate(data.get('runId'), data.get('recordId'), data.get('direction')))
            if route == '/api/tags':
                return self.json(media_actions.tag_action(self.state, data))
            if route == '/api/cancel-frames':
                with self.state.lock:
                    if self.state.job.get('id') != data.get('jobId') or self.state.job['kind'] not in ('frame-info', 'frame-extract', 'frame-timeline', 'image-inspect', 'image-process', 'snapshot', 'clip'):
                        raise ValueError('This media operation is no longer active.')
                    self.state.cancel_event.set()
                return self.json({'ok': True})
            if route == '/api/captures':
                return self.json(captures.gallery(self.state, data.get('kind')))
            if route == '/api/create-directory':
                return self.json({'path': str(folder_browser.create(data.get('parent'), data.get('name')))})
            if route == "/api/pick-folder":
                title = {'source': 'source folder', 'custom': 'custom folder'}.get(data.get('kind'), 'destination folder')
                return self.json({"path": choose_folder("Choose " + title)})
            if route in ('/api/custom-folders', '/api/custom-preview'):
                with self.state.lock:
                    if self.state.job['status'] == 'running':
                        raise ValueError('Wait for the current operation to finish first.')
                    if route == '/api/custom-folders':
                        if data.get('mode') in ('managed', 'external'):
                            folder = custom_folders.create_folder(self.state.reports, data.get('name'), data.get('path') if data['mode'] == 'external' else None)
                        else:
                            if data.get('mode') == 'existing' and not Path(str(data.get('path', ''))).is_dir():
                                raise ValueError('Choose an existing folder, or use Create new folder.')
                            folder = custom_folders.add_folder(self.state.reports, data.get('path'), data.get('name'))
                        return self.json(dict(folder=folder, customFolders=custom_folders.folders(self.state.reports)))
                    return self.json(custom_folders.prepare(self.state, data.get('runId'), data.get('folderId'), data.get('recordIds')))
            if route == "/api/open-folder":
                if data.get('captureId'):
                    path = captures.media_path(self.state, data['captureId'])
                    subprocess.Popen(['explorer.exe', '/select,', str(path)])
                elif data.get("recordId") is not None:
                    path = self.state.media_path(data.get("runId", ""), str(data["recordId"]))
                    subprocess.Popen(["explorer.exe", "/select,", str(path)])
                else:
                    path = Path(data.get("path", "")).resolve()
                    if not data.get("path") or not path.is_dir():
                        raise ValueError("This folder does not exist yet. It will be created when files are moved.")
                    os.startfile(str(path))
                return self.json({"ok": True})
            if route in ("/api/scan", "/api/move", '/api/custom-move', '/api/file-action', '/api/frame-info', '/api/frame-extract', '/api/frame-timeline', '/api/image-inspect', '/api/image-process', '/api/snapshot', '/api/clip'):
                return self.json(self.state.start(route.rsplit("/", 1)[-1], data), 202)
            self.json({"error": "Not found"}, 404)
        except PermissionError as exc:
            self.json({"error": str(exc)}, 403)
        except (ValueError, OSError, KeyError, TypeError, scan.ScanError) as exc:
            self.json({"error": str(exc)}, 400)


def make_server(port=0, reports=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), UIHandler)
    server.state = UIState(reports or scan.default_reports_dir())
    return server


def serve_desktop(server):
    """Private parent pipe owns lifetime; EOF drains existing work, never kills it."""
    def close_on_parent_exit():
        sys.stdin.readline()
        with server.state.lock:
            server.state.closing = True
        server.shutdown()

    threading.Thread(target=close_on_parent_exit, daemon=True).start()
    print(json.dumps({"mediaManagerReady": 1, "url": f"http://127.0.0.1:{server.server_port}"}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
        while server.state.job_snapshot()["status"] == "running":
            threading.Event().wait(0.1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--reports", help="Scan history directory (default: runs)")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--desktop-bridge", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    server = make_server(args.port, args.reports)
    if args.desktop_bridge:
        return serve_desktop(server)
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Media Organizer: {url}\nKeep this window open. Ctrl+C stops the UI.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        if server.state.job["status"] == "running":
            print("Waiting for the current operation to finish safely…", flush=True)
            while server.state.job["status"] == "running":
                threading.Event().wait(0.5)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
