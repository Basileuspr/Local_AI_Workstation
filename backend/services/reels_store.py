"""Reel checkpoints and brief results only. No media, transcripts or sessions."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import threading
import time
from urllib.parse import urlsplit
from uuid import uuid4

from config import settings
from services import browser_media

_lock = threading.RLock()
_initialized = set()
ID = re.compile(r'^[a-f0-9]{32}$')


def source(url, *, reel=False):
    u = urlsplit(url)
    # Source checkpoints are canonical public HTTPS paths, never signed URLs.
    if u.scheme != 'https' or u.username or u.password or u.query or u.fragment or not u.hostname:
        raise ValueError('Use an unsigned public HTTPS source address.')
    from services.web_access import address_rejection
    import ipaddress
    try: address = ipaddress.ip_address(u.hostname)
    except ValueError: address = None
    if address is not None and address_rejection(str(address)): raise ValueError('Private source blocked.')
    if u.hostname.lower() in {'localhost', 'localhost.localdomain'} or u.hostname.lower().endswith(('.local', '.localhost', '.internal')):
        raise ValueError('Private source blocked.')
    path = u.path or '/'
    if len(path) > 1000 or re.search(r'(?:token|secret|password|session|signature)[=:]', path, re.I):
        raise ValueError('Unsupported source path.')
    authority = u.netloc.lower()
    canonical = f'https://{authority}{path}'
    if reel:
        match = re.fullmatch(r'/reels?/([a-zA-Z0-9_-]{1,64})/?', path)
        if not match: raise ValueError('A stable reel ID is required.')
        return canonical.rstrip('/')+'/', f'{authority}:{match[1]}'
    return canonical


def cleanup(workflow_id):
    if not workflow_id: return
    try: folder = browser_media.directory(workflow_id)
    except (ValueError, FileNotFoundError): return
    # Exact generated child, validated by browser_media; never follow a linked root.
    shutil.rmtree(folder)


@contextmanager
def database():
    root = Path(os.environ.get('LAW_REELS_DATA_DIR', str(settings.data_dir / 'reels')))
    if root.is_symlink() or getattr(root, 'is_junction', lambda: False)(): raise ValueError('Linked reel storage is unsupported.')
    root.mkdir(parents=True, exist_ok=True)
    file = root / 'results.sqlite3'
    if file.is_symlink(): raise ValueError('Linked reel storage is unsupported.')
    with _lock, sqlite3.connect(file, timeout=10) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, record TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS summaries (identity TEXT PRIMARY KEY, record TEXT NOT NULL)')
        key = str(file.resolve())
        if key not in _initialized:
            for row in db.execute('SELECT * FROM batches').fetchall():
                record = json.loads(row['record'])
                for item in record['items']:
                    cleanup(item.pop('workflowId', None))
                    if item['status'] in {'acquiring', 'analyzing'}: item['status'] = 'interrupted'
                if record['status'] in {'running', 'pausing'}: record['status'] = 'interrupted'
                db.execute('UPDATE batches SET record=? WHERE id=?', (json.dumps(record), record['id']))
            db.commit(); _initialized.add(key)
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback(); raise


def get(identifier):
    if not ID.fullmatch(identifier): raise ValueError('Invalid reel batch.')
    with database() as db:
        row = db.execute('SELECT record FROM batches WHERE id=?', (identifier,)).fetchone()
        if not row: raise ValueError('Reel batch unavailable.')
        return json.loads(row[0])


def save(db, record):
    record['updatedAt'] = time.time()
    db.execute('UPDATE batches SET record=? WHERE id=?', (json.dumps(record), record['id']))
    return record


def listing():
    with database() as db:
        return {'batches': [json.loads(r[0]) for r in db.execute('SELECT record FROM batches ORDER BY rowid DESC LIMIT 100')],
                'summaries': [json.loads(r[0]) for r in db.execute('SELECT record FROM summaries ORDER BY rowid DESC LIMIT 500')]}


def create(body):
    profile = body['profileId']
    if profile != 'default' and not ID.fullmatch(profile): raise ValueError('Select an account profile.')
    original = source(body['sourceUrl']); origin = urlsplit(original).netloc
    items = []; seen = set()
    for raw in body['reels']:
        url, identity = source(raw, reel=True)
        if urlsplit(url).netloc != origin: raise ValueError('Reels must belong to the selected source site.')
        if identity not in seen:
            seen.add(identity); items.append({'url': url, 'identity': identity, 'status': 'pending'})
    if not items: raise ValueError('Discover a reel in the selected conversation first.')
    with database() as db:
        for item in items:
            if db.execute('SELECT 1 FROM summaries WHERE identity=?', (item['identity'],)).fetchone(): item['status'] = 'duplicate'
        record = {'id': uuid4().hex, 'profileId': profile, 'sourceUrl': original, 'items': items,
                  'accountRef': body['accountRef'],
                  'visionModel': body['visionModel'], 'whisperModel': body['whisperModel'],
                  'summaryModel': body.get('summaryModel') or body['visionModel'],
                  'status': 'ready', 'updatedAt': time.time()}
        db.execute('INSERT INTO batches VALUES (?,?)', (record['id'], json.dumps(record)))
        return record


def update(identifier, status=None, index=None, item_status=None, workflow_id=None):
    with database() as db:
        record = get(identifier)
        if status: record['status'] = status
        if index is not None:
            item = record['items'][index]
            if item['status'] not in {'complete', 'duplicate'}:
                if item_status: item['status'] = item_status
                if workflow_id: item['workflowId'] = workflow_id
        return save(db, record)


def claim(identifier, index, workflow_id):
    with database() as db:
        record = get(identifier); item = record['items'][index]
        if db.execute('SELECT 1 FROM summaries WHERE identity=?', (item['identity'],)).fetchone():
            item['status'] = 'duplicate'; save(db, record); return False
        if item['status'] == 'analyzing': raise ValueError('This reel is already being analyzed.')
        item.update(status='analyzing', workflowId=workflow_id); save(db, record); return True


def complete(identifier, index, result):
    with database() as db:
        record = get(identifier); item = record['items'][index]
        summary = {'identity': item['identity'], 'reelUrl': item['url'], 'summary': result['summary'],
                   'repository': result['repository'], 'savedAt': time.time()}
        # Result and checkpoint commit together; a crash can never duplicate a saved summary.
        db.execute('INSERT OR IGNORE INTO summaries VALUES (?,?)', (item['identity'], json.dumps(summary)))
        item['status'] = 'complete'
        save(db, record)
        return summary


def released(identifier, index):
    with database() as db:
        record = get(identifier); record['items'][index].pop('workflowId', None); return save(db, record)


def clear_cache():
    with database() as db:
        for row in db.execute('SELECT record FROM batches').fetchall():
            record = json.loads(row[0])
            for item in record['items']: cleanup(item.pop('workflowId', None))
            save(db, record)
