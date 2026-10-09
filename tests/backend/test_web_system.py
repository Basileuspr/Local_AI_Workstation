"""Owned HTTP/model fixtures; never contact a provider, account or user data."""
import asyncio
import json
import time
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from services import web_state as state, web_content
from services.web_access import WebAccess, WebError
from services.web_retrieval import Retriever, Document, digest
from services.web_crawler import Crawler
from test_web_access import Clock, public_dns


@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):monkeypatch.setenv('LAW_WEB_SYSTEM_DIR',str(tmp_path/'web'))


def transport(tmp_path,handler):
    clock=Clock();requests=[]
    def handle(req):requests.append((clock.now(),req));return handler(req)
    return Retriever(WebAccess(tmp_path/'transport',httpx.MockTransport(handle),public_dns,clock.now,clock.sleep)),clock,requests


def source(**extra):
    return state.save_source(state.Source(name='Owned source',seed_url='https://site.example.com/',discover_sitemaps=False,discover_feeds=False,**extra))


def html(text='Captured release says version 3.2 supports offline inference.',**headers):
    return httpx.Response(200,text='<html><head><title>Release</title></head><body><main>'+text+'</main></body></html>',headers={'content-type':'text/html',**headers})


def document(url='https://site.example.com/',text='Captured release says version 3.2 supports offline inference.',**extra):
    return Document(url,'Release',text,time.time(),digest(text),url,canonical_url=url,**extra)


def work(crawler,sid,now=10000):
    uid=state.enqueue(sid,now);row=state.claim('fixture',now);assert row['id']==uid
    asyncio.run(crawler.process(row,'fixture'));return state.job(uid)


def test_sources_boundaries_and_operational_only():
    for url in ['http://localhost/','http://127.0.0.1/','https://user:pass@site.example.com/','https://site.example.com/?token=SECRET']:
        with pytest.raises(ValueError):state.Source(name='Blocked',seed_url=url)
    s=source(include_patterns=['/','/news/*'],exclude_patterns=['*/private*'])
    assert state.permitted('http://site.example.com/news/release',s)
    assert not state.permitted('https://site.example.com/news/private',s)
    assert not state.permitted('https://different.example.com/news/yes',s)
    assert state.permitted('https://site.example.com/feed.xml',s,discovery=True)
    assert state.public_url('https://site.example.com/?utm_source=a&v=2#part')=='https://site.example.com/?v=2'
    assert not web_content.connection is None
    with state.database() as db:
        assert 'text' not in {r[1] for r in db.execute('PRAGMA table_info(pages)')}


def test_http_tls_pinned_destinations_redirect_and_robots(tmp_path):
    def response(req):
        assert req.url.host=='93.184.216.34' and req.headers['host']=='site.example.com'
        if req.url.path=='/robots.txt':return httpx.Response(200,text='User-agent: *\nCrawl-delay: 20\nDisallow: /denied\nSitemap: https://site.example.com/map.xml')
        if req.url.path=='/redirect':return httpx.Response(302,headers={'location':'http://127.0.0.1/secret'})
        return html('Safe text <a href="/next">Next</a><a href="http://10.0.0.1/">Private</a><link rel="alternate" type="application/rss+xml" href="/feed.xml">')
    retriever,clock,requests=transport(tmp_path,response)
    doc=asyncio.run(retriever.retrieve('http://site.example.com/'))
    assert doc.links==['http://site.example.com/next'] and doc.feeds==['http://site.example.com/feed.xml']
    assert requests[1][0]-requests[0][0]>=20
    with pytest.raises(WebError,match='disallowed'):asyncio.run(retriever.retrieve('http://site.example.com/denied'))
    with pytest.raises(WebError):asyncio.run(retriever.retrieve('http://site.example.com/redirect'))
    assert all(r.url.host=='93.184.216.34' for _,r in requests)


def test_metadata_discovery_redirect_boundary_and_entities(tmp_path):
    def response(req):
        if req.url.path=='/robots.txt':return httpx.Response(404)
        if req.url.path=='/':return html('<link rel="alternate" type="application/atom+xml" href="/feed.xml">Content')
        if req.url.path=='/feed.xml':return httpx.Response(200,text='<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title><entry><title>New release</title><link href="/news/release"/><summary>Release notes.</summary></entry></feed>',headers={'content-type':'application/atom+xml'})
        if req.url.path=='/redirect':return httpx.Response(302,headers={'location':'https://other.example.com/news/release'})
        return httpx.Response(200,text='<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>',headers={'content-type':'application/xml'})
    retriever,_,requests=transport(tmp_path,response);s=source(include_patterns=['/','/news/*'])
    doc=asyncio.run(retriever.retrieve(s['seed_url'],boundary=lambda u:state.permitted(u,s),policy_boundary=lambda u:state.permitted(u,s,discovery=True)))
    assert doc.feeds==['https://site.example.com/feed.xml']
    feed=asyncio.run(retriever.retrieve(doc.feeds[0],boundary=lambda u:state.permitted(u,s,discovery=True)))
    assert feed.kind=='feed' and feed.links==['https://site.example.com/news/release']
    with pytest.raises(WebError,match='outside'):asyncio.run(retriever.retrieve('https://site.example.com/redirect',boundary=lambda u:state.permitted(u,s,discovery=True)))
    with pytest.raises(WebError,match='entities'):asyncio.run(retriever.retrieve('https://site.example.com/entity'))
    assert not any(r.headers['host']=='other.example.com' for _,r in requests)


def test_conditional_304_hash_and_separate_retention(tmp_path):
    def response(req):
        if req.url.path=='/robots.txt':return httpx.Response(404)
        if req.headers.get('if-none-match')=='"one"':return httpx.Response(304,headers={'etag':'"one"'})
        return html(etag='"one"',**{'last-modified':'Wed, 07 Oct 2026 10:00:00 GMT'})
    retriever,clock,requests=transport(tmp_path,response);s=source(policy='keep_latest');crawler=Crawler(retriever,clock.now)
    first=work(crawler,s['id']);old=state.page(s['id'],s['seed_url']);assert first['record']['changed']==1
    second=work(crawler,s['id']);page=state.page(s['id'],s['seed_url'])
    assert page['http_status']==304 and page['title']=='Release' and page['content_hash']==old['content_hash'] and page['last_changed']==old['last_changed']
    assert second['record']['changed']==0 and web_content.get(s['id'],s['seed_url']).text
    assert not list((state.root()/'transport'/'cache').glob('*.json'))
    web_content.clear(s['id']);assert state.page(s['id'],s['seed_url'])['content_hash']==old['content_hash']
    work(crawler,s['id']);assert not requests[-1][1].headers.get('if-none-match')
    assert web_content.get(s['id'],s['seed_url']).text


def test_normalized_unchanged_hash_never_stores_default_bodies():
    class Fixture:
        counter=0
        async def retrieve(self,url,**kwargs):
            self.counter+=1
            return document(url,'Release version 3.2\n offline inference' if self.counter==1 else 'Release version 3.2   offline inference')
    f=Fixture();s=source();first=work(Crawler(f),s['id']);second=work(Crawler(f),s['id'])
    assert first['record']['changed']==1 and second['record']['changed']==0
    assert not (state.root()/'content').exists()
    assert 'offline inference' not in (state.root()/'crawl-state.sqlite3').read_bytes().decode(errors='ignore')


def test_crash_recovery_does_not_replay_completed_frontier():
    s=source();uid=state.enqueue(s['id'],0);row=state.claim('old',0);record=row['record']
    record['frontier']=[{'url':'https://site.example.com/second','depth':1,'attempt':0}];record['seen']=[s['seed_url']];record['checked']=1
    state.checkpoint(uid,'old',record,page={**document().metadata(),'url':s['seed_url']})
    state.recover('new',1);resumed=state.claim('new',1);assert resumed['record']['checked']==1
    calls=[]
    class Fixture:
        async def retrieve(self,url,**kwargs):calls.append(url);return document(url)
    asyncio.run(Crawler(Fixture()).process(resumed,'new'))
    assert calls==['https://site.example.com/second'] and state.job(uid)['state']=='COMPLETED'
    assert state.enqueue(s['id'],2)!=uid


def test_backoff_other_pages_continue_and_failure_is_bounded():
    now=[10000];calls=[]
    class Fixture:
        async def retrieve(self,url,**kwargs):
            calls.append(url)
            if url.endswith('/bad'):raise WebError('Temporary failure containing SECRET body')
            doc=document(url);doc.links=['https://site.example.com/bad','https://site.example.com/good'] if url.endswith('/') else [];return doc
    s=source();crawler=Crawler(Fixture(),lambda:now[0]);row=work(crawler,s['id']);uid=row['id']
    assert row['state']=='RETRY' and calls[-1].endswith('/good') and row['record']['checked']==2
    assert state.claim('fixture',now[0]) is None
    for i in range(3):
        now[0]=state.job(uid)['available'];next_=state.claim('fixture',now[0]);asyncio.run(crawler.process(next_,'fixture'))
    assert state.job(uid)['state']=='PARTIAL' and state.job(uid)['record']['failures']==1
    assert 'SECRET' not in json.dumps(state.pages(s['id']))


def test_cancel_fetch_and_source_edit_recover():
    async def scenario():
        entered=asyncio.Event();finished=asyncio.Event()
        class Fixture:
            async def retrieve(self,*_,**__):
                entered.set()
                try:await asyncio.sleep(300)
                finally:finished.set()
        s=source();uid=state.enqueue(s['id'],0);row=state.claim('fixture',0)
        task=asyncio.create_task(Crawler(Fixture()).process(row,'fixture'));await entered.wait();state.cancel(uid);await asyncio.wait_for(task,2)
        assert finished.is_set() and state.job(uid)['state']=='CANCELLED'
        uid=state.enqueue(s['id'],0)
        state.save_source(state.Source(**{k:s[k] for k in state.Source.model_fields}|{'include_patterns':['/']}),s['id'])
        assert state.job(uid)['record']['cancel_requested']
        assert state.job(uid)['state']=='CANCELLED'
    asyncio.run(scenario())


def test_retention_actions_do_not_embed_and_cache_clear_preserves_state(tmp_path):
    s=source(policy='notify_changes');d=document(source_id=s['id']);event=web_content.apply(d,True,s)
    assert event['type']=='changed' and not (state.root()/'content').exists()
    assert web_content.apply(d,False,s) is None
    s['policy']='keep_latest';web_content.apply(d,True,s)
    unrelated=tmp_path/'knowledge.sqlite3';unrelated.write_text('saved Knowledge');session=tmp_path/'Cookies';session.write_text('logged in')
    web_content.clear();assert unrelated.read_text()=='saved Knowledge' and session.read_text()=='logged in' and state.source(s['id'])['name']=='Owned source'


def test_route_session_and_native_controls(monkeypatch):
    from services.session_guard import SessionGuard
    from routes.web_system import router
    from fastapi.testclient import TestClient
    monkeypatch.setenv('LAW_LOCAL_FILES_TOKEN','native-fixture')
    app=FastAPI();app.include_router(router);app.add_middleware(SessionGuard)
    with TestClient(app,base_url='http://127.0.0.1:8000') as client:
        assert client.get('/web-system/state').status_code==403
        headers={'x-law-session':'test-session-token'}
        assert client.get('/web-system/state',headers=headers).status_code==200
        assert client.post('/web-system/background',headers=headers,json={'enabled':True}).status_code==403
        assert client.post('/web-system/research/'+('a'*32)+'/browser-page',headers=headers,json={'url':'https://site.example.com/','title':'test','text':'x'*100}).status_code==403


def test_task_fixed_paths_has_no_desktop_credentials(monkeypatch):
    from services import web_background
    code=web_background.script(True)
    assert 'Interactive' in code and 'Limited' in code and 'IgnoreNew' in code and 'web_worker.py' in code
    assert 'LAW_SESSION_TOKEN' not in code and 'x-law-session' not in code and 'Cookie' not in code
    assert web_background.task_name() in web_background.script(False)


def test_maintenance_cannot_race_independent_worker(monkeypatch):
    from services import maintenance_gate as gate,web_background
    from routes import bridge
    from fastapi.testclient import TestClient
    monkeypatch.setenv('LAW_DESKTOP_MAINTENANCE_TOKEN','maintenance-fixture')
    monkeypatch.setattr(gate,'workers_busy',lambda:False);monkeypatch.setattr(bridge,'_instance',None)
    app=FastAPI();app.include_router(gate.router);gate.gate.locked=False
    with TestClient(app,base_url='http://127.0.0.1') as client:
        headers={'x-desktop-maintenance':'maintenance-fixture'}
        state.set_setting('background_enabled',True)
        result=client.post('/maintenance/lock',headers=headers)
        assert result.status_code==409 and 'Disable background' in result.json()['detail'] and not gate.gate.locked
        state.set_setting('background_enabled',False);state.heartbeat('fixture','running',time.time())
        assert client.post('/maintenance/lock',headers=headers).status_code==409
        state.heartbeat('fixture','stopped',time.time());assert client.post('/maintenance/lock',headers=headers).status_code==200
        assert client.post('/maintenance/unlock',headers=headers).status_code==200


def test_shared_request_lock_serializes_and_releases_after_cancellation(tmp_path):
    from services.web_retrieval import FileGate
    async def scenario():
        first=FileGate(tmp_path/'shared');second=FileGate(tmp_path/'shared');entered=asyncio.Event()
        async def holding():
            async with first:entered.set();await asyncio.sleep(300)
        owner=asyncio.create_task(holding());await entered.wait()
        blocked=asyncio.create_task(second.__aenter__());await asyncio.sleep(.05);assert not blocked.done()
        blocked.cancel();await asyncio.gather(blocked,return_exceptions=True);assert not second.local.locked()
        owner.cancel();await asyncio.gather(owner,return_exceptions=True)
        async with second:assert second.handle and not second.handle.closed
        assert second.handle is None and not second.local.locked()
    asyncio.run(scenario())


def test_explicit_knowledge_adapter_provenance_and_duplicate(monkeypatch):
    from services import web_knowledge,knowledge_base as kb
    calls=[];present=[]
    monkeypatch.setattr(kb,'_get_collection',lambda:SimpleNamespace(get=lambda **_: {'ids':present}))
    def add(text,filename,**_):calls.append((text,filename));present.append('chunk');return {'doc_id':'fixture'}
    monkeypatch.setattr(kb,'add_document',add)
    d=document();result=web_knowledge.ingest(d);assert result['doc_id']=='fixture'
    assert web_knowledge.ingest(d)['duplicate'] and len(calls)==1
    assert 'retrieved_at' in calls[0][0] and d.url in calls[0][0] and d.content_hash in calls[0][0]
    d.truncated=True
    with pytest.raises(ValueError):web_knowledge.ingest(d)
