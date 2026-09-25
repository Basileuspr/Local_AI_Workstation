"""Durable bridge records, separate from local chat and model stores."""
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

TERMINAL = {"completed", "failed", "cancelled", "interrupted"}


class BridgeStore:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.path = self.root / "bridge.sqlite3"
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS peers (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS jobs (direction TEXT, id TEXT, value TEXT NOT NULL, PRIMARY KEY(direction,id))")
        # A restarted worker never silently replays work whose outcome is unknown.
        for job in self.jobs("incoming"):
            if job["status"] not in TERMINAL:
                self.update("incoming", job["id"], status="interrupted", error="Worker restarted. This job was not replayed.")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def setting(self, key, default=None):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_setting(self, key, value):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, json.dumps(value)))

    def peers(self):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT value FROM peers")]

    def peer(self, peer_id):
        return next((peer for peer in self.peers() if peer["id"] == peer_id), None)

    def save_peer(self, peer):
        with self.connect() as db:
            db.execute("INSERT OR REPLACE INTO peers VALUES (?,?)", (peer["id"], json.dumps(peer)))

    def jobs(self, direction=None):
        with self.connect() as db:
            rows = db.execute("SELECT value FROM jobs" + (" WHERE direction=?" if direction else ""), (direction,) if direction else ())
            return sorted([json.loads(row[0]) for row in rows], key=lambda job: job["created"], reverse=True)

    def job(self, direction, job_id):
        with self.connect() as db:
            row = db.execute("SELECT value FROM jobs WHERE direction=? AND id=?", (direction, job_id)).fetchone()
        return json.loads(row[0]) if row else None

    def insert(self, direction, job_id, peer_id, payload):
        with self.lock:
            existing = self.job(direction, job_id)
            if existing:
                if existing["peer_id"] != peer_id or (existing["payload"] is not None and existing["payload"] != payload):
                    raise ValueError("Job ID already belongs to a different request.")
                return existing, False
            jobs = self.jobs(direction)
            if sum(not job.get("archived") for job in jobs) >= 200:
                raise ValueError("Bridge history is full. Remove finished jobs before submitting more.")
            if sum(job["status"] not in TERMINAL for job in jobs) >= 8:
                raise ValueError("Bridge has eight outstanding jobs. Finish or cancel work first.")
            job = dict(id=job_id, direction=direction, peer_id=peer_id, payload=payload,
                       status="queued" if direction == "incoming" else "unknown", result=None,
                       error=None, cancel_requested=False, created=time.time(), updated=time.time())
            with self.connect() as db:
                db.execute("INSERT INTO jobs VALUES (?,?,?)", (direction, job_id, json.dumps(job)))
            return job, True

    def cancel_missing(self, job_id, peer_id):
        """Remember cancellation before delivery, so a late PUT cannot start it."""
        with self.lock:
            job = self.job("incoming", job_id)
            if job:
                if job["peer_id"] != peer_id:
                    raise ValueError("Job not found.")
                return job
            job = dict(id=job_id, direction="incoming", peer_id=peer_id, payload=None,
                       status="cancelled", result=None, error=None, cancel_requested=True,
                       archived=True, created=time.time(), updated=time.time())
            with self.connect() as db:
                db.execute("INSERT INTO jobs VALUES (?,?,?)", ("incoming", job_id, json.dumps(job)))
            return job

    def update(self, direction, job_id, **values):
        with self.lock:
            job = self.job(direction, job_id)
            if job is None:
                raise ValueError("Bridge job not found.")
            job.update(values, updated=time.time())
            with self.connect() as db:
                db.execute("UPDATE jobs SET value=? WHERE direction=? AND id=?", (json.dumps(job), direction, job_id))
            return job

    def delete(self, direction, job_id):
        with self.lock:
            job = self.job(direction, job_id)
            if job and job["status"] not in TERMINAL:
                raise ValueError("Only finished jobs can be removed.")
            if direction == "incoming":
                self.update(direction, job_id, status="failed", result=None, archived=True,
                            error="Worker result was cleared. This job ID will not execute again.")
                return
            with self.connect() as db:
                db.execute("DELETE FROM jobs WHERE direction=? AND id=?", (direction, job_id))
