"""Opt-in latest content, physically separate from crawl state and Knowledge."""
from dataclasses import asdict
from contextlib import contextmanager
import json
import sqlite3

from services import web_state
from services.web_retrieval import Document

MAX_BYTES=100*1024**2


@contextmanager
def connection():
    directory=web_state.root()/'content';directory.mkdir(parents=True,exist_ok=True)
    file=directory/'latest.sqlite3'
    if file.is_symlink():raise ValueError('Linked content storage is unsupported.')
    db=sqlite3.connect(file,timeout=20)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS latest (source_id TEXT,url TEXT,document TEXT,bytes INTEGER,PRIMARY KEY(source_id,url))')
    try:
        yield db;db.commit()
    except BaseException:db.rollback();raise
    finally:db.close()


def keep(document):
    payload=json.dumps(asdict(document),ensure_ascii=False);size=len(payload.encode())
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        total=db.execute('SELECT COALESCE(SUM(bytes),0) FROM latest WHERE NOT(source_id=? AND url=?)',(document.source_id,document.requested_url)).fetchone()[0]
        if total+size>MAX_BYTES:raise ValueError('Latest-content cache is full. Clear retained content or reduce monitored pages.')
        db.execute('INSERT OR REPLACE INTO latest VALUES (?,?,?,?)',(document.source_id,document.requested_url,payload,size))


def get(sid,url):
    with connection() as db:row=db.execute('SELECT document FROM latest WHERE source_id=? AND url=?',(sid,url)).fetchone()
    if not row:raise ValueError('No latest content retained for this page. Choose Keep latest content and check again.')
    return Document(**json.loads(row[0]))


def clear(sid=None):
    with connection() as db:
        if sid:db.execute('DELETE FROM latest WHERE source_id=?',(web_state.identifier(sid),))
        else:db.execute('DELETE FROM latest')
    # Compact cleared page bodies; never touch crawl-state or Knowledge DBs.
    with connection() as db:db.execute('VACUUM')


def apply(document,changed,source):
    """Retention/action boundary. Add version/archive/Knowledge adapters here.

    Monitor-only is deliberately a no-op. No policy automatically embeds.
    Idempotent latest writes happen before the operational checkpoint commits.
    """
    if source['policy']=='keep_latest' and document.status==200:
        try:existing=get(source['id'],document.requested_url)
        except ValueError:existing=None
        if changed or not existing:keep(document)
    if source['policy']=='notify_changes' and changed:
        return {'url':document.url,'title':document.title,'content_hash':document.content_hash,'type':'changed'}
    return None
