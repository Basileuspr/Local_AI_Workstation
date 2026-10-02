"""Persistent, read-only source-file audits. No source move/delete/write operations."""
from __future__ import annotations

import base64
import csv
from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import threading
import time
from datetime import datetime, timezone
from uuid import uuid4

from config import settings

MODES = {
    "hash": ("sha256", "size"),
    "name_size": ("name_key", "size"),
    "size_modified": ("size", "modified_ns"),
    "name_size_modified": ("name_key", "size", "modified_ns"),
}
TERMINAL = {"completed", "completed_with_errors", "cancelled", "interrupted", "failed"}
COLUMNS = ("path_key", "path", "name", "name_key", "size", "modified_ns", "created_ns", "physical_id",
           "links", "sha256", "status", "error", "scanned_at", "scan_id")


def now():
    return datetime.now(timezone.utc).isoformat()


def path_key(path):
    return os.path.normcase(os.path.abspath(path)).replace("\\", "/").rstrip("/") + ("/" if str(path) == "/" else "")


def beneath(path, root):
    return path == root or path.startswith(root.rstrip("/") + "/")


def linked(info):
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def unavailable_offline(info):
    # Do not hydrate cloud placeholders or offline files by opening them.
    return bool(getattr(info, "st_file_attributes", 0) & (0x1000 | 0x40000 | 0x400000))


def excluded_vendor(path):
    parts = [part.casefold() for part in Path(path).parts]
    return any("nvidia" in part or part in {".nv", "nv_cache"} for part in parts) or (
        Path(path).name.casefold().startswith("nv") and Path(path).suffix.casefold() in {".dll", ".sys"})


def normalize_roots(values, *, must_exist=True):
    roots = []
    for value in values:
        path = Path(value.strip())
        if not path.is_absolute() or str(path).startswith(("\\\\", "//")):
            raise ValueError("Choose an absolute local folder or drive path; network shares are not supported.")
        if must_exist:
            info = path.lstat()
            if linked(info) or unavailable_offline(info):
                raise ValueError(f"Choose the real target folder instead of a link, junction or cloud placeholder: {path}")
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError(f"Choose a directory: {path}")
        path = path.resolve(strict=must_exist)
        if must_exist and excluded_vendor(path):
            raise ValueError("NVIDIA locations are excluded from audits.")
        if not any(beneath(path_key(path), path_key(root)) for root in roots):
            roots = [root for root in roots if not beneath(path_key(root), path_key(path))]
            roots.append(str(path))
    return roots


def signature(info):
    # Compare ctime only within the same stat method below. On Windows,
    # path stat and handle fstat can expose different ctime semantics.
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


class AuditCancelled(Exception):
    pass


class FileChanged(Exception):
    pass


def hash_file(path, before, cancel, progress):
    digest = hashlib.sha256()
    size = 0
    # O_NOFOLLOW closes a link-swap race on platforms that expose it. Windows
    # reparse points are excluded by lstat and the resolved-path checks below.
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    with os.fdopen(os.open(path, flags), "rb") as source:
        opened = os.fstat(source.fileno())
        if not stat.S_ISREG(opened.st_mode) or signature(opened) != signature(before):
            raise FileChanged("File changed before hashing began; rescan it.")
        while True:
            if cancel.is_set():
                raise AuditCancelled()
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
            progress(len(chunk))
            if size > before.st_size:
                raise FileChanged("File grew while being hashed; rescan it.")
        after = os.fstat(source.fileno())
    latest = path.lstat()
    if (linked(latest) or signature(before) != signature(after) or signature(before) != signature(latest)
            or before.st_ctime_ns != latest.st_ctime_ns or opened.st_ctime_ns != after.st_ctime_ns or size != before.st_size):
        raise FileChanged("File changed while being hashed; rescan it.")
    return digest.hexdigest()


class HashAuditor:
    def __init__(self, database):
        self.database = Path(database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._thread = None
        self._cancel = threading.Event()
        self._progress = None
        with closing(self.connect()) as db, db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS scans (
                    id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
                    status TEXT NOT NULL, roots TEXT NOT NULL, excludes TEXT NOT NULL,
                    discovered INTEGER NOT NULL DEFAULT 0, hashed INTEGER NOT NULL DEFAULT 0,
                    bytes_hashed INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
                    errors INTEGER NOT NULL DEFAULT 0, not_seen INTEGER NOT NULL DEFAULT 0,
                    current_path TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS files (
                    path_key TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL,
                    size INTEGER, modified_ns TEXT, created_ns TEXT, physical_id TEXT, links INTEGER,
                    sha256 TEXT, status TEXT NOT NULL, error TEXT, scanned_at TEXT NOT NULL, scan_id TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS files_hash ON files(status, sha256, size);
                CREATE INDEX IF NOT EXISTS files_name_size ON files(status, name_key, size);
                CREATE INDEX IF NOT EXISTS files_modified ON files(status, size, modified_ns);
                CREATE TABLE IF NOT EXISTS issues (
                    id INTEGER PRIMARY KEY, scan_id TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, message TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS issues_scan ON issues(scan_id, id);
            """)
            db.execute("UPDATE scans SET status='interrupted', finished_at=?, current_path='', message='App stopped before this audit finished. Start another audit to recheck these roots.' WHERE status IN ('running','cancelling')", (now(),))

    def connect(self, *, check_same_thread=True):
        db = sqlite3.connect(self.database, timeout=15, check_same_thread=check_same_thread)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA synchronous=NORMAL")
        return db

    @property
    def busy(self):
        with self._lock:
            return bool(self._thread and self._thread.is_alive())

    def status(self):
        with closing(self.connect()) as db, db:
            history = [dict(row) for row in db.execute("SELECT * FROM scans ORDER BY started_at DESC LIMIT 20")]
            counts = dict(db.execute("SELECT status, COUNT(*) FROM files GROUP BY status").fetchall())
        with self._lock:
            active = dict(self._progress) if self.busy and self._progress else None
            latest = dict(self._progress) if self._progress else None
        for scan in history:
            scan["roots"], scan["excludes"] = json.loads(scan["roots"]), json.loads(scan["excludes"])
            if latest and scan["id"] == latest["id"]:
                scan.update(latest)
        return {"active": active, "scans": history, "counts": counts, "algorithm": "SHA-256"}

    def start(self, roots, excludes=()):
        roots = normalize_roots(roots)
        if not roots:
            raise ValueError("Select at least one folder or drive.")
        excludes = normalize_roots(excludes, must_exist=False)
        if any(any(beneath(path_key(root), path_key(exclude)) for exclude in excludes) for root in roots):
            raise ValueError("A selected root is also excluded. Remove it from one of the lists.")
        with self._lock:
            if self.busy:
                raise RuntimeError("A hash audit is already running. Finish or cancel it first.")
            self._cancel = threading.Event()
            self._progress = {"id": uuid4().hex, "started_at": now(), "finished_at": None, "status": "running",
                              "roots": roots, "excludes": excludes, "discovered": 0, "hashed": 0,
                              "bytes_hashed": 0, "skipped": 0, "errors": 0, "not_seen": 0, "current_path": "", "message": "Reading selected folders"}
            job = dict(self._progress)
            with closing(self.connect()) as db, db:
                db.execute("INSERT INTO scans(id,started_at,status,roots,excludes) VALUES (?,?,?,?,?)",
                           (job["id"], job["started_at"], "running", json.dumps(roots), json.dumps(excludes)))
            self._thread = threading.Thread(target=self._run, args=(job,), name="hash-auditor", daemon=True)
            self._thread.start()
            return job

    def cancel(self, scan_id):
        with self._lock:
            if self.busy and self._progress["id"] == scan_id:
                self._cancel.set()
                self._progress.update(status="cancelling", message="Stopping after the current read; recorded results are kept.")
                return {"cancelled": True}
        return {"cancelled": False}

    def _run(self, job):
        db = self.connect()
        records, issues = [], []
        excluded = [path_key(item) for item in [*job["excludes"], self.database.parent]]
        last_flush = time.monotonic()
        fields = ",".join(COLUMNS)
        upsert = f"INSERT INTO files({fields}) VALUES ({','.join('?' for _ in COLUMNS)}) ON CONFLICT(path_key) DO UPDATE SET " + ",".join(f"{column}=excluded.{column}" for column in COLUMNS[1:])

        def publish():
            with self._lock:
                self._progress = dict(job)
                if self._cancel.is_set() and job["status"] == "running":
                    self._progress.update(status="cancelling", message="Stopping after the current read; recorded results are kept.")

        def flush(force=False):
            nonlocal last_flush
            publish()
            if not force and len(records) + len(issues) < 100 and time.monotonic() - last_flush < .5:
                return
            with db:
                db.executemany(upsert, records)
                db.executemany("INSERT INTO issues(scan_id,kind,path,message) VALUES (?,?,?,?)", issues)
                db.execute("UPDATE scans SET status=?,finished_at=?,discovered=?,hashed=?,bytes_hashed=?,skipped=?,errors=?,not_seen=?,current_path=?,message=? WHERE id=?",
                           tuple(job[key] for key in ("status", "finished_at", "discovered", "hashed", "bytes_hashed", "skipped", "errors", "not_seen", "current_path", "message", "id")))
            records.clear(); issues.clear(); last_flush = time.monotonic()

        def issue(kind, path, message):
            job["skipped" if kind == "skipped" else "errors"] += 1
            issues.append((job["id"], kind, str(path), message))
            flush()

        def progress(amount):
            job["bytes_hashed"] += amount
            flush()

        def record(path, info, digest, status, error=""):
            key = path_key(path)
            physical = f"{info.st_dev}:{info.st_ino}" if info and info.st_ino else key
            created_ns = getattr(info, "st_birthtime_ns", info.st_ctime_ns if os.name == "nt" else None) if info else None
            records.append((key, str(path), path.name, path.name.casefold(), info.st_size if info else None,
                            str(info.st_mtime_ns) if info else None, str(created_ns) if created_ns is not None else None,
                            physical, info.st_nlink if info else None, digest, status, error, now(), job["id"]))
            flush()

        try:
            for root_value in job["roots"]:
                root = Path(root_value)
                stack = [root]
                while stack:
                    if self._cancel.is_set(): raise AuditCancelled()
                    directory = stack.pop()
                    try:
                        info = directory.lstat()
                        if linked(info) or unavailable_offline(info) or not beneath(path_key(directory.resolve()), path_key(root)):
                            issue("skipped", directory, "Link, junction or changed directory target")
                            continue
                        if any(beneath(path_key(directory), item) for item in excluded) or excluded_vendor(directory):
                            issue("skipped", directory, "Excluded directory")
                            continue
                        with os.scandir(directory) as entries:
                            for entry in entries:
                                if self._cancel.is_set(): raise AuditCancelled()
                                path = Path(entry.path)
                                try:
                                    # Windows DirEntry.stat omits file identity and
                                    # link count. lstat supplies both and is fresh.
                                    info = path.lstat()
                                    if linked(info) or unavailable_offline(info) or excluded_vendor(path) or any(beneath(path_key(path), item) for item in excluded):
                                        issue("skipped", path, "Link, cloud/offline item, NVIDIA path, or excluded location")
                                        continue
                                    if stat.S_ISDIR(info.st_mode):
                                        stack.append(path)
                                        continue
                                    if not stat.S_ISREG(info.st_mode):
                                        issue("skipped", path, "Not a regular file")
                                        continue
                                    job["discovered"] += 1
                                    job["current_path"] = str(path)
                                    job["message"] = "Hashing full file contents"
                                    publish()
                                    if not beneath(path_key(path.resolve(strict=True)), path_key(root)):
                                        raise FileChanged("File target moved outside the selected root")
                                    digest = hash_file(path, info, self._cancel, progress)
                                    record(path, info, digest, "verified")
                                    job["hashed"] += 1
                                except FileChanged as exc:
                                    record(path, info, None, "changed", str(exc))
                                    issue("changed", path, str(exc))
                                except AuditCancelled:
                                    record(path, info, None, "interrupted", "Stopped before the whole file could be hashed.")
                                    raise
                                except OSError as exc:
                                    record(path, None, None, "unreadable", str(exc))
                                    issue("error", path, str(exc))
                    except OSError as exc:
                        issue("error", directory, str(exc))
            if self._cancel.is_set(): raise AuditCancelled()
            flush(True)
            # A completed walk invalidates old records in these roots that
            # were not reached. "Not seen" does not claim a file was deleted:
            # it may be excluded, inaccessible, or gone. Cancel never prunes.
            unseen = 0
            with db:
                for root in job["roots"]:
                    if self._cancel.is_set(): raise AuditCancelled()
                    prefix = path_key(root).rstrip("/") + "/"
                    cursor = db.execute("UPDATE files SET status='not_seen', error='Not seen in the latest audit of this root; missing, excluded or inaccessible.' WHERE substr(path_key,1,?)=? AND scan_id<>? AND status<>'not_seen'",
                                        (len(prefix), prefix, job["id"]))
                    unseen += cursor.rowcount
                if self._cancel.is_set(): raise AuditCancelled()
            job["not_seen"] = unseen
            job.update(status="completed_with_errors" if job["errors"] else "completed", message="Audit finished. Matches describe recorded observations, not a live filesystem check.")
        except AuditCancelled:
            job.update(status="cancelled", message="Audit cancelled. Completed file hashes were saved; unseen paths from earlier audits were retained.")
        except Exception as exc:
            job.update(status="failed", message=f"Audit failed: {exc}")
        finally:
            job.update(finished_at=now(), current_path="")
            try: flush(True)
            except Exception as exc:
                job.update(status="failed", message=f"Could not save the audit: {exc}")
                publish()
            finally: db.close()

    def issues(self, scan_id, offset=0, limit=100):
        with closing(self.connect()) as db, db:
            return {"total": db.execute("SELECT COUNT(*) FROM issues WHERE scan_id=?", (scan_id,)).fetchone()[0],
                    "items": [dict(row) for row in db.execute("SELECT kind,path,message FROM issues WHERE scan_id=? ORDER BY id LIMIT ? OFFSET ?", (scan_id, limit, offset))]}

    def groups(self, mode="hash", offset=0, limit=20):
        columns = MODES[mode]
        fields = ",".join(columns)
        query = f"SELECT {fields}, COUNT(*) AS file_count, COUNT(DISTINCT physical_id) AS physical_files FROM files WHERE status='verified' GROUP BY {fields} HAVING COUNT(*)>1"
        with closing(self.connect()) as db, db:
            total = db.execute(f"SELECT COUNT(*) FROM ({query})").fetchone()[0]
            groups = []
            for row in db.execute(f"{query} ORDER BY file_count DESC, {fields} LIMIT ? OFFSET ?", (limit, offset)):
                values = [row[column] for column in columns]
                key = base64.urlsafe_b64encode(json.dumps(values, ensure_ascii=True).encode()).decode()
                group = {"key": key, "values": dict(zip(columns, values)), "file_count": row["file_count"], "physical_files": row["physical_files"]}
                group["files"] = self._group_files(db, columns, values, 0, 30)
                groups.append(group)
        return {"groups": groups, "total": total, "mode": mode, "offset": offset}

    def _group_files(self, db, columns, values, offset, limit):
        where = " AND ".join(f"{column}=?" for column in columns)
        return [public_file(row) for row in db.execute(f"SELECT * FROM files WHERE status='verified' AND {where} ORDER BY path_key LIMIT ? OFFSET ?", (*values, limit, offset))]

    def group_files(self, mode, key, offset=0, limit=100):
        try:
            values = json.loads(base64.urlsafe_b64decode(key).decode())
            if not isinstance(values, list) or len(values) != len(MODES[mode]): raise ValueError()
            for column, value in zip(MODES[mode], values):
                if column == "size":
                    if type(value) is not int or not 0 <= value <= 2**63 - 1: raise ValueError()
                elif not isinstance(value, str): raise ValueError()
        except (ValueError, TypeError, UnicodeError) as exc:
            raise ValueError("Invalid match group.") from exc
        with closing(self.connect()) as db, db:
            return {"items": self._group_files(db, MODES[mode], values, offset, limit)}

    def inventory(self, offset=0, limit=100, search=""):
        # instr treats %, _, quotes and backslashes as literal path text.
        where, args = ("WHERE instr(lower(path), lower(?)) > 0", (search,)) if search else ("", ())
        with closing(self.connect()) as db, db:
            return {"total": db.execute(f"SELECT COUNT(*) FROM files {where}", args).fetchone()[0],
                    "items": [public_file(row) for row in db.execute(f"SELECT * FROM files {where} ORDER BY path_key LIMIT ? OFFSET ?", (*args, limit, offset))]}

    def export_csv(self, scope="inventory", mode="hash"):
        fields = ",".join(MODES[mode])
        where = f"WHERE status='verified' AND ({fields}) IN (SELECT {fields} FROM files WHERE status='verified' GROUP BY {fields} HAVING COUNT(*)>1)" if scope == "matches" else ""
        # StreamingResponse resumes this generator on pooled worker threads.
        # One generator owns the connection and uses it sequentially.
        db = self.connect(check_same_thread=False)
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        columns = ["path", "size", "sha256", "modified_at", "modified_ns", "created_ns", "scanned_at", "status", "physical_id", "links", "error", "scan_id"]
        try:
            yield "\ufeff"
            writer.writerow(columns)
            yield stream.getvalue(); stream.seek(0); stream.truncate(0)
            for row in db.execute(f"SELECT * FROM files {where} ORDER BY {fields}, path_key"):
                item = public_file(row)
                writer.writerow([csv_cell(item.get(column)) for column in columns])
                yield stream.getvalue(); stream.seek(0); stream.truncate(0)
        finally:
            db.close()


def public_file(row):
    item = dict(row)
    item.pop("path_key", None); item.pop("name_key", None)
    try: item["modified_at"] = datetime.fromtimestamp(int(item["modified_ns"]) / 1e9, timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError, OSError): item["modified_at"] = None
    return item


def csv_cell(value):
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
        return "'" + value
    return value


_instance = None
_instance_lock = threading.Lock()


def manager():
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = HashAuditor(settings.data_dir / "hash_auditor" / "catalog.sqlite3")
        return _instance


def is_busy():
    return bool(_instance and _instance.busy)
