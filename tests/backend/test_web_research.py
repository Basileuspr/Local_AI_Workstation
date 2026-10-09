import asyncio
import json
import time
from types import SimpleNamespace

import pytest
from services import web_state as state, web_research as research
from services.web_access import WebError
from services.web_retrieval import Document,digest
from test_web_system import document


@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):monkeypatch.setenv('LAW_WEB_SYSTEM_DIR',str(tmp_path/'web'))


class Fixture(research.Research):
    def __init__(self,retriever=None,clock=time.time,**kwargs):super().__init__(retriever=retriever,clock=clock,**kwargs);self.prompts=[];self.invalid=False
    async def model(self,job,prompt,format,tokens,cancel):
        self.prompts.append(prompt)
        if 'queries' in format['properties']:return json.dumps({'queries':['Fixture tool release']})
        if 'supported' in format['properties']:return json.dumps({'supported':not self.invalid})
        return json.dumps({'paragraphs':[{'text':'The captured release describes offline inference in version 3.2.',
            'citations':['S1'],'quotes':[{'source':'S1','quote':'Missing quote' if self.invalid else 'version 3.2 supports offline inference'}]}]})


class Pages:
    def __init__(self):self.calls=[]
    async def raw(self,*args,**kwargs):return '',200,{},json.dumps({'results':[{'url':'https://site.example.com/release','title':'Fixture tool release','content':'Current release'}]}).encode()
    async def retrieve(self,url,**kwargs):
        self.calls.append(url)
        doc=document(url,'Captured release says version 3.2 supports offline inference. This documented capability works locally on your workstation.')
        if url.endswith('/release'):doc.links=['https://site.example.com/release-details','http://127.0.0.1/secret']
        elif url.endswith('release-details'):doc.text+=' Detailed release information.';doc.content_hash=digest(doc.text)
        return doc


async def finished(manager,**kwargs):
    job=manager.start('What does the Fixture tool release describe?','fixture-model',**kwargs)
    await manager.tasks[job['id']];return manager.state(job['id'])


def test_search_retrieval_deduplication_follow_links_citations_and_discard(monkeypatch):
    async def scenario():
        research.search_config({'provider':'searxng','endpoint':'https://search.example.com/search'})
        pages=Pages();manager=Fixture(pages);job=await finished(manager,max_pages=3)
        assert job['status']=='COMPLETED' and len(job['sources'])==2 and len(pages.calls)==2
        assert job['answer'][0]['citations']==['S1'] and job['sources'][0]['retrieved_at']
        assert all('untrusted' in p.lower() or 'current question' in p.lower() or 'search queries' in p.lower() for p in manager.prompts)
        assert not (state.root()/'content').exists()
        await manager.discard(job['id']);assert not manager.jobs and not manager.documents
    asyncio.run(scenario())


def test_unsupported_quotes_fail_closed_and_no_answer():
    async def scenario():
        manager=Fixture(Pages());manager.invalid=True
        job=await finished(manager,urls=['https://site.example.com/release'],follow_links=False)
        assert job['status']=='FAILED' and not job['answer'] and not job['sources'] and not manager.documents[job['id']]
    asyncio.run(scenario())


def test_cancel_and_timeout_recover_then_expire():
    async def scenario():
        entered=asyncio.Event();now=[time.time()]
        class Slow(Pages):
            async def retrieve(self,*args,**kwargs):entered.set();await asyncio.sleep(300)
        manager=Fixture(Slow(),clock=lambda:now[0]);job=manager.start('Fixture question?','fixture',urls=['https://site.example.com/release'])
        await entered.wait();cancelled=await manager.cancel(job['id']);assert cancelled['status']=='CANCELLED' and not manager.documents[job['id']]
        manager.retriever=Pages();next_=await finished(manager,urls=['https://site.example.com/release']);assert next_['status']=='COMPLETED'
        now[0]+=research.TTL+1;manager.prune();assert not manager.jobs and not manager.documents
        await manager.close()
    asyncio.run(scenario())


def test_browser_fallback_is_explicit_temporary_and_cancellable():
    async def scenario():
        class Empty(Pages):
            async def retrieve(self,*args,**kwargs):return document(text='')
        manager=Fixture(Empty());job=await finished(manager,urls=['https://site.example.com/release'])
        assert job['status']=='FAILED' and job['failures'][0]['reason']=='browser_rendering_required'
        with pytest.raises(WebError):await manager.browser_page(job['id'],{'url':'https://site.example.com/?token=SECRET','title':'Rendered','text':'x'*100})
        current=await manager.browser_page(job['id'],{'url':'https://site.example.com/release','title':'Rendered','text':'Captured release says version 3.2 supports offline inference. This rendered page was explicitly selected by the user.'})
        await manager.tasks[job['id']];updated=manager.state(job['id'])
        assert updated['status']=='PARTIAL' and updated['sources'][0]['kind']=='rendered_browser' and manager.document(job['id'],'S1').text
        await manager.close()
    asyncio.run(scenario())


def test_search_provider_private_or_signed_endpoint_rejected():
    for endpoint in ['http://127.0.0.1:8080/search','https://user:pass@search.example.com/','https://search.example.com/?key=value','https://search.example.com/?token=SECRET']:
        with pytest.raises((ValueError,WebError)):research.search_config({'provider':'searxng','endpoint':endpoint})


def test_credentials_rejected_before_query_model_and_cleanup_after_timeout():
    async def scenario():
        class Timeout(Fixture):
            async def model(self,*_,**__):raise TimeoutError('Local model bounded deadline')
        manager=Timeout(Pages())
        with pytest.raises(ValueError):manager.start('password=PRIVATE','fixture')
        job=await finished(manager,urls=['https://site.example.com/release']);assert job['status']=='FAILED' and not manager.documents[job['id']]
        manager=Fixture(Pages());job=await finished(manager,urls=['https://site.example.com/release']);assert job['answer']
        await manager.close()
    asyncio.run(scenario())


def test_expiry_reaper_clears_bodies_without_a_poll(monkeypatch):
    original_sleep=asyncio.sleep
    async def shorter(seconds):await original_sleep(.01 if seconds==30 else seconds)
    monkeypatch.setattr(asyncio,'sleep',shorter)
    async def scenario():
        now=[time.time()];manager=Fixture(Pages(),clock=lambda:now[0]);job=await finished(manager,urls=['https://site.example.com/release'])
        await manager.startup();now[0]+=research.TTL+1;await original_sleep(.04)
        assert not manager.documents and not manager.jobs;await manager.close()
    asyncio.run(scenario())


def test_queue_cancel_interrupts_inflight_retrieval():
    from services.request_queue import queue
    async def scenario():
        entered=asyncio.Event();closed=asyncio.Event()
        class Slow(Pages):
            async def retrieve(self,*_,**__):
                entered.set()
                try:await asyncio.sleep(300)
                finally:closed.set()
        manager=Fixture(Slow());job=manager.start('What is described by this release?','fixture',urls=['https://site.example.com/release'])
        await entered.wait();await queue.cancel(queue.find(kind='web-research',request_id=job['id']))
        await asyncio.wait_for(manager.tasks[job['id']],2)
        assert closed.is_set() and manager.state(job['id'])['status']=='CANCELLED' and not manager.documents[job['id']]
        await manager.close()
    asyncio.run(scenario())


def test_http_research_route_runs_on_event_loop(monkeypatch):
    from routes import web_system
    from fastapi import FastAPI
    import httpx
    async def scenario():
        manager=Fixture(Pages());monkeypatch.setattr(web_system,'manager',manager)
        app=FastAPI();app.include_router(web_system.router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='http://127.0.0.1') as client:
            response=await client.post('/web-system/research',json={'question':'What is described by this release?','model':'fixture','urls':['https://site.example.com/release']})
            assert response.status_code==200;uid=response.json()['id'];await manager.tasks[uid]
            assert (await client.get('/web-system/research/'+uid)).json()['answer']
            assert (await client.post('/web-system/research/'+uid+'/discard')).json()['discarded']
        await manager.close()
    asyncio.run(scenario())


def test_search_html_snippets_and_private_result_filter():
    async def scenario():
        class Results:
            async def raw(self,*_,**__):return '',200,{},json.dumps({'results':[{'url':'http://10.0.0.1/','title':'Private'},
                {'url':'https://site.example.com/release','title':'Release','content':'<b>Offline</b> inference release'},
                {'url':'https://site.example.com/release#duplicate','title':'Duplicate'}]}).encode()
        rows=await research.search('offline release',Results(),{'provider':'searxng','endpoint':'https://search.example.com/search'})
        assert len(rows)==1 and rows[0]['snippet']=='Offline inference release'
    asyncio.run(scenario())
