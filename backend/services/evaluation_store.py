"""Private SQLite history with immutable suite snapshots and compact run indexes."""
from __future__ import annotations

from datetime import datetime, timezone
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
from uuid import uuid4

from services.evaluation_contracts import Suite
from services.evaluation_starters import starter_suite


def now():
    return datetime.now(timezone.utc).isoformat()


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def summarize(run):
    groups = []
    for index, target in enumerate(run['request']['targets']):
        rows = [r for r in run['results'] if r['target_index'] == index]
        done = [r for r in rows if r['status'] == 'completed']
        scored = [r['evaluation']['score'] for r in done if r.get('evaluation', {}).get('score') is not None]
        reviewed = [r['review'] for r in done if r.get('review')]
        latencies = [r['metrics']['inference_seconds'] for r in done if r.get('metrics', {}).get('inference_seconds') is not None]
        speeds = [r['metrics']['tokens_per_second'] for r in done if r.get('metrics', {}).get('tokens_per_second') is not None]
        mean = lambda values: round(sum(values) / len(values), 3) if values else None
        groups.append({**target, 'target_index': index, 'total': len(rows), 'completed': len(done),
                       'failed': sum(r['status'] == 'failed' for r in rows),
                       'automated_score': mean(scored), 'automated_count': len(scored),
                       'review_count': len(reviewed),
                       'request_accuracy': mean([r['request_accuracy'] / 4 * 100 for r in reviewed]),
                       'factual_accuracy': mean([r['factual_accuracy'] / 4 * 100 for r in reviewed]),
                       'freshness': mean([r['freshness'] / 4 * 100 for r in reviewed if r.get('freshness') is not None]),
                       'inference_seconds': mean(latencies), 'tokens_per_second': mean(speeds)})
    return {key: run[key] for key in ('id', 'suite_id', 'suite_name', 'suite_hash', 'cohort', 'created_at', 'status')} | {
        'groups': groups, 'total': len(run['results']),
        'completed': sum(r['status'] == 'completed' for r in run['results']),
        'finished_at': run.get('finished_at'), 'error': run.get('error')}


class EvaluationStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS suites (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created TEXT NOT NULL, body TEXT NOT NULL, summary TEXT NOT NULL)')
            db.execute('CREATE INDEX IF NOT EXISTS runs_created ON runs(created DESC)')
            db.execute('CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
            if not db.execute('SELECT 1 FROM suites LIMIT 1').fetchone():
                suite = self.suite_document(Suite.model_validate(starter_suite()).model_dump(mode='json'))
                db.execute('INSERT INTO suites VALUES (?,?)', (suite['id'], json.dumps(suite)))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            db.execute('PRAGMA busy_timeout=30000')
            with db:
                yield db
        finally:
            db.close()

    def suite_document(self, value):
        return {'id': uuid4().hex, 'created_at': now(), 'hash': fingerprint(value), **value}

    def suites(self):
        with self.lock, self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT body FROM suites ORDER BY rowid')]

    def save_suite(self, value):
        suite = self.suite_document(value)
        with self.lock, self.connect() as db:
            db.execute('INSERT INTO suites VALUES (?,?)', (suite['id'], json.dumps(suite)))
        return suite

    def suite(self, id):
        with self.lock, self.connect() as db:
            row = db.execute('SELECT body FROM suites WHERE id=?', (id,)).fetchone()
        if not row:
            raise KeyError('Test suite not found.')
        return json.loads(row[0])

    def run(self, id):
        with self.lock, self.connect() as db:
            row = db.execute('SELECT body FROM runs WHERE id=?', (id,)).fetchone()
        if not row:
            raise KeyError('Run not found.')
        return json.loads(row[0])

    def listing(self):
        with self.lock, self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT summary FROM runs ORDER BY created DESC LIMIT 500')]

    def write_run(self, db, run):
        db.execute('INSERT INTO runs VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, summary=excluded.summary',
                   (run['id'], run['created_at'], json.dumps(run), json.dumps(summarize(run))))

    def add_run(self, run):
        with self.lock, self.connect() as db:
            self.write_run(db, run)
        return run

    def mutate(self, id, callback):
        with self.lock, self.connect() as db:
            run = self.run(id)
            callback(run)
            self.write_run(db, run)
        return run

    def schedules(self):
        with self.lock, self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT body FROM schedules ORDER BY rowid DESC')]

    def put_schedule(self, schedule):
        with self.lock, self.connect() as db:
            db.execute('INSERT INTO schedules VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
                       (schedule['id'], json.dumps(schedule)))
        return schedule

    def claim_schedule(self, schedule, run):
        # Run creation and advancing the due date commit together, including on restart.
        with self.lock, self.connect() as db:
            row = db.execute('SELECT body FROM schedules WHERE id=?', (schedule['id'],)).fetchone()
            if not row or not json.loads(row[0])['enabled']:
                return False
            self.write_run(db, run)
            db.execute('UPDATE schedules SET body=? WHERE id=?', (json.dumps(schedule), schedule['id']))
        return True

    def recover(self):
        with self.lock, self.connect() as db:
            for row in db.execute("SELECT body FROM runs WHERE json_extract(summary, '$.status') IN ('queued', 'running')").fetchall():
                run = json.loads(row[0])
                if run['status'] not in ('queued', 'running'):
                    continue
                run['status'] = 'interrupted'
                run['finished_at'] = now()
                run['error'] = 'Backend stopped during this run. Completed responses were retained; unfinished requests were not replayed.'
                for result in run['results']:
                    if result['status'] in ('queued', 'running'):
                        result['status'] = 'interrupted'
                self.write_run(db, run)
