"""Operational web state only: schedules, URL metadata, jobs and checkpoints.

Page bodies and Knowledge documents do not belong in this database.
"""
from contextlib import contextmanager
from fnmatch import fnmatchcase
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal
from config import settings
from services.web_access import normalize_url, WebError

TERMINAL={'COMPLETED','PARTIAL','FAILED','CANCELLED'}
ID=re.compile(r'^[a-f0-9]{32}$')


def root():
    return Path(os.environ.get('LAW_WEB_SYSTEM_DIR',str(settings.data_dir/'web-system')))


def public_url(raw):
    result=normalize_url(raw,allow_http=True);u=urlsplit(result)
    pairs=[]
    for key,value in parse_qsl(u.query,keep_blank_values=True):
        if re.search(r'token|secret|password|signature|session|authorization|api.?key|csrf|cookie',key,re.I) or key.lower() in {'sig','key','code','state','nonce','auth','jwt','ticket','sso'}:
            raise WebError('Signed or credential-bearing addresses are not research/crawl sources.')
        if key.lower().startswith('utm_') or key.lower() in {'fbclid','gclid'}:continue
        pairs.append((key,value))
    return urlunsplit((u.scheme,u.netloc,u.path or '/',urlencode(pairs),''))


class Source(BaseModel):
    model_config=ConfigDict(extra='forbid')
    name:str=Field(min_length=1,max_length=100)
    seed_url:str=Field(max_length=2000)
    enabled:bool=True
    interval_minutes:int=Field(default=1440,ge=5,le=525600)
    allowed_domains:list[str]=Field(default_factory=list,max_length=20)
    include_patterns:list[str]=Field(default_factory=lambda:['*'],max_length=40)
    exclude_patterns:list[str]=Field(default_factory=list,max_length=40)
    max_depth:int=Field(default=1,ge=0,le=8)
    max_pages:int=Field(default=20,ge=1,le=500)
    request_interval_seconds:int=Field(default=10,ge=10,le=3600)
    policy:Literal['monitor_only','keep_latest','notify_changes']='monitor_only'
    discover_feeds:bool=True
    discover_sitemaps:bool=True

    @model_validator(mode='after')
    def boundaries(self):
        self.name=self.name.strip()
        if not self.name or any(ord(c)<32 for c in self.name):raise ValueError('Use a source name on one line.')
        self.seed_url=public_url(self.seed_url)
        self.allowed_domains=self.allowed_domains or [urlsplit(self.seed_url).hostname]
        domains=[]
        for raw in self.allowed_domains:
            wildcard=raw.startswith('*.');host=raw[2:] if wildcard else raw
            if any(c in host for c in '/:@?#') or len(host)>253:raise ValueError('Allowed domains must be hostnames.')
            host=urlsplit(public_url('https://'+host+'/')).hostname
            domains.append(('*.' if wildcard else '')+host)
        self.allowed_domains=list(dict.fromkeys(domains))
        for pattern in self.include_patterns+self.exclude_patterns:
            if not isinstance(pattern,str) or not pattern or len(pattern)>256 or any(ord(c)<32 for c in pattern):
                raise ValueError('Use bounded URL/path glob patterns, not scripts or regular expressions.')
        if not permitted(self.seed_url,self.model_dump()):raise ValueError('The seed must match the configured crawl boundaries.')
        return self


def permitted(url,source,*,discovery=False):
    try:url=public_url(url)
    except (WebError,ValueError):return False
    host=urlsplit(url).hostname
    if not any(host==d or d.startswith('*.') and (host==d[2:] or host.endswith('.'+d[2:])) for d in source['allowed_domains']):return False
    if discovery:return True
    path=urlsplit(url).path
    match=lambda p:fnmatchcase(path,p) or fnmatchcase(url,p)
    return any(match(p) for p in source['include_patterns']) and not any(match(p) for p in source['exclude_patterns'])


@contextmanager
def database():
    directory=root();directory.mkdir(parents=True,exist_ok=True)
    file=directory/'crawl-state.sqlite3'
    if file.is_symlink():raise ValueError('Linked crawl-state databases are unsupported.')
    db=sqlite3.connect(file,timeout=20)
    try:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA foreign_keys=ON')
        db.executescript('''
          CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY,config TEXT NOT NULL,next_run REAL NOT NULL,last_success REAL,last_checked REAL);
          CREATE TABLE IF NOT EXISTS pages (source_id TEXT NOT NULL,url TEXT NOT NULL,record TEXT NOT NULL,PRIMARY KEY(source_id,url));
          CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,source_id TEXT NOT NULL,state TEXT NOT NULL,available REAL NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,record TEXT NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS one_source_job ON jobs(source_id) WHERE state IN ('PENDING','RUNNING','RETRY');
          CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,created REAL NOT NULL,record TEXT NOT NULL);
        ''')
        try:yield db;db.commit()
        except BaseException:db.rollback();raise
    finally:db.close()


def setting(key,default=None):
    with database() as db:
        row=db.execute('SELECT value FROM settings WHERE key=?',(key,)).fetchone()
        return json.loads(row[0]) if row else default


def set_setting(key,value):
    with database() as db:db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',(key,json.dumps(value)))


def identifier(value):
    if not ID.fullmatch(value):raise ValueError('Invalid web source/job identifier.')
    return value


def source(identifier_):
    with database() as db:
        row=db.execute('SELECT * FROM sources WHERE id=?',(identifier(identifier_),)).fetchone()
        if not row:raise ValueError('Web source unavailable.')
        return {'id':row['id'],**json.loads(row['config']),'next_run':row['next_run'],'last_success':row['last_success'],'last_checked':row['last_checked']}


def save_source(value,identifier_=None):
    ident=identifier(identifier_) if identifier_ else uuid4().hex;now=time.time()
    with database() as db:
        if not identifier_ and db.execute('SELECT COUNT(*) FROM sources').fetchone()[0]>=100:raise ValueError('Source limit reached (100).')
        if identifier_ and not db.execute('SELECT 1 FROM sources WHERE id=?',(ident,)).fetchone():raise ValueError('Web source unavailable.')
        db.execute('INSERT INTO sources(id,config,next_run) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config,next_run=excluded.next_run',
                   (ident,value.model_dump_json(),now if value.enabled else now+value.interval_minutes*60))
        if identifier_ or not value.enabled:
            for row in db.execute("SELECT * FROM jobs WHERE source_id=? AND state IN ('PENDING','RUNNING','RETRY')",(ident,)).fetchall():
                record=json.loads(row['record']);record['cancel_requested']=True
                db.execute('UPDATE jobs SET record=?,state=? WHERE id=?',(json.dumps(record),'CANCELLED' if row['state'] in {'PENDING','RETRY'} else row['state'],row['id']))
    return source(ident)


def job(ident):
    with database() as db:
        row=db.execute('SELECT * FROM jobs WHERE id=?',(identifier(ident),)).fetchone()
        if not row:raise ValueError('Web job unavailable.')
        return dict(row)|{'record':json.loads(row['record'])}


def enqueue(ident,now=None):
    now=time.time() if now is None else now;src=source(ident)
    if not src['enabled']:raise ValueError('Enable the source before checking it.')
    with database() as db:
        existing=db.execute("SELECT id FROM jobs WHERE source_id=? AND state IN ('PENDING','RUNNING','RETRY')",(ident,)).fetchone()
        if existing:return existing[0]
        known=[json.loads(r[0])['url'] for r in db.execute('SELECT record FROM pages WHERE source_id=? LIMIT ?',(ident,src['max_pages']))]
        frontier=[{'url':src['seed_url'],'depth':0,'attempt':0}]+[{'url':u,'depth':1,'attempt':0} for u in known if u!=src['seed_url']]
        record={'frontier':frontier,'seen':[],'checked':0,'changed':0,'failures':0,'owner':None,'source':src,'cancel_requested':False,'discovered':False}
        uid=uuid4().hex
        try:db.execute('INSERT INTO jobs VALUES (?,?,?,?,?,?,?)',(uid,ident,'PENDING',now,now,now,json.dumps(record)))
        except sqlite3.IntegrityError:return db.execute("SELECT id FROM jobs WHERE source_id=? AND state IN ('PENDING','RUNNING','RETRY')",(ident,)).fetchone()[0]
        db.execute('UPDATE sources SET next_run=? WHERE id=?',(now+src['interval_minutes']*60,ident))
        return uid


def due(now):
    with database() as db:rows=db.execute('SELECT id,config FROM sources WHERE next_run<=?',(now,)).fetchall()
    for row in rows:
        if json.loads(row['config'])['enabled']:enqueue(row['id'],now)


def recover(owner,now):
    # Called only after obtaining the independent worker's OS singleton lock.
    with database() as db:
        for row in db.execute("SELECT * FROM jobs WHERE state='RUNNING'").fetchall():
            record=json.loads(row['record']);record['owner']=None
            db.execute("UPDATE jobs SET state='RETRY',available=?,updated=?,record=? WHERE id=?",(now,now,json.dumps(record),row['id']))
    heartbeat(owner,'idle',now)


def claim(owner,now):
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute("SELECT * FROM jobs WHERE state IN ('PENDING','RETRY') AND available<=? ORDER BY available,created LIMIT 1",(now,)).fetchone()
        if not row:return None
        record=json.loads(row['record']);record['owner']=owner
        db.execute("UPDATE jobs SET state='RUNNING',updated=?,record=? WHERE id=?",(now,json.dumps(record),row['id']))
        return dict(row)|{'state':'RUNNING','record':record}


def checkpoint(uid,owner,record,*,state='RUNNING',available=None,page=None,event=None):
    now=time.time()
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        old=db.execute('SELECT record FROM jobs WHERE id=?',(uid,)).fetchone()
        if not old or json.loads(old[0]).get('owner')!=owner:raise ValueError('Crawl job ownership changed.')
        # Never overwrite a cancel request committed by the desktop meanwhile.
        record['cancel_requested']=record.get('cancel_requested',False) or json.loads(old[0]).get('cancel_requested',False)
        db.execute('UPDATE jobs SET state=?,available=?,updated=?,record=? WHERE id=?',(state,available or now,now,json.dumps(record),uid))
        sid=record['source']['id']
        if page:
            db.execute('INSERT OR REPLACE INTO pages VALUES (?,?,?)',(sid,page['url'],json.dumps(page)))
            db.execute('DELETE FROM pages WHERE source_id=? AND rowid NOT IN (SELECT rowid FROM pages WHERE source_id=? ORDER BY json_extract(record,\'$.last_checked\') DESC LIMIT 2000)',(sid,sid))
            db.execute('UPDATE sources SET last_checked=? WHERE id=?',(now,sid))
        if event:db.execute('INSERT INTO events(source_id,created,record) VALUES (?,?,?)',(sid,now,json.dumps(event)))
        if state in {'COMPLETED','PARTIAL'}:db.execute('UPDATE sources SET last_success=?,last_checked=? WHERE id=?',(now,now,sid))
        db.execute('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 500)')
        db.execute("DELETE FROM jobs WHERE state IN ('COMPLETED','PARTIAL','FAILED','CANCELLED') AND id NOT IN (SELECT id FROM jobs ORDER BY created DESC LIMIT 500)")


def page(sid,url):
    with database() as db:
        row=db.execute('SELECT record FROM pages WHERE source_id=? AND url=?',(sid,url)).fetchone()
        return json.loads(row[0]) if row else None


def cancel(uid):
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT * FROM jobs WHERE id=?',(identifier(uid),)).fetchone()
        if not row:raise ValueError('Web job unavailable.')
        record=json.loads(row['record']);record['cancel_requested']=True
        db.execute('UPDATE jobs SET record=?,state=? WHERE id=?',(json.dumps(record),'CANCELLED' if row['state'] in {'PENDING','RETRY'} else row['state'],uid))


def heartbeat(owner,status,now,error=None):
    set_setting('worker',{'owner':owner,'status':status,'heartbeat':now,**({'error':error} if error else {})})


def listing():
    with database() as db:
        sources=[source(r[0]) for r in db.execute('SELECT id FROM sources ORDER BY rowid DESC')]
        jobs=[]
        for row in db.execute('SELECT * FROM jobs ORDER BY created DESC LIMIT 100'):
            record=json.loads(row['record'])
            jobs.append({k:row[k] for k in ('id','source_id','state','available','created','updated')}|
                        {k:record.get(k) for k in ('checked','changed','failures','cancel_requested')})
        events=[{'id':r['id'],'source_id':r['source_id'],'created':r['created'],**json.loads(r['record'])} for r in db.execute('SELECT * FROM events ORDER BY id DESC LIMIT 100')]
    return {'sources':sources,'jobs':jobs,'events':events,'worker':setting('worker',{}),'background_enabled':setting('background_enabled',False)}


def pages(sid):
    source(sid)
    with database() as db:return [json.loads(r[0]) for r in db.execute('SELECT record FROM pages WHERE source_id=? LIMIT 500',(sid,))]
