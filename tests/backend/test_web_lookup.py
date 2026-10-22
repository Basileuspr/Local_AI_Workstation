"""Safe provider/search/page boundaries with owned HTTP responses only."""
import asyncio
import json
import time

import httpx
import pytest
from fastapi import FastAPI

from services import image_store, image_vault, web_search, web_state
from services.web_access import WebError
from services.web_lookup import Lookup, TTL
from services.request_queue import queue
from services.session_guard import SessionGuard
from test_web_system import transport, document, html
from test_web_images import raster


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setenv('LAW_WEB_SYSTEM_DIR', str(tmp_path / 'web'))
    monkeypatch.delenv('LAW_BRAVE_SEARCH_API_KEY', raising=False)
    monkeypatch.setattr(web_search, '_session_key', '')
    monkeypatch.setattr(image_store, 'BLOBS_DIR', tmp_path / 'blobs')
    monkeypatch.setattr(image_vault, 'ROOT', tmp_path / 'vault')


def test_key_stays_out_of_settings_and_responses_and_can_be_removed(tmp_path, monkeypatch):
    result = web_search.search_config({'provider':'brave', 'api_key':'fixture-credential'})
    assert result['key_configured'] and result['key_source'] == 'session'
    assert 'fixture-credential' not in json.dumps(result)
    assert web_state.setting('search') == {'provider':'brave', 'endpoint':''}
    assert all(b'fixture-credential' not in p.read_bytes() for p in tmp_path.rglob('*') if p.is_file())
    web_search.search_config({'provider':'wikipedia'})
    assert web_search.api_key() == 'fixture-credential'
    result = web_search.search_config({'provider':'brave', 'clear_api_key':True})
    assert not result['key_configured']
    monkeypatch.setenv('LAW_BRAVE_SEARCH_API_KEY', 'environment-fixture')
    assert web_search.search_config()['key_source'] == 'environment'


@pytest.mark.parametrize('endpoint', ['http://search.example.com/search', 'https://localhost/search',
    'https://search.example.com/search?q=hi', 'https://search.example.com/search#part',
    'https://search.example.com/?utm_source=hidden', 'https://u:p@search.example.com/', 'https://127.0.0.1/'])
def test_unsafe_provider_endpoint_rejected(endpoint):
    with pytest.raises(ValueError):
        web_search.search_config({'provider':'searxng', 'endpoint':endpoint, 'api_key':'unused-key'})
    assert not web_search.api_key()


def test_brave_uses_pinned_tls_fixed_header_and_provider_ranking(tmp_path):
    def respond(req):
        assert req.url.host == '93.184.216.34'
        assert req.headers['host'] == 'api.search.brave.com'
        assert req.extensions['sni_hostname'] == 'api.search.brave.com'
        assert req.headers['x-subscription-token'] == 'fixture-credential'
        assert 'fixture-credential' not in str(req.url)
        assert req.url.params['q'] == 'solar panels'
        return httpx.Response(200, json={'web':{'results':[
            {'url':'https://first.example.com/a?utm_source=ads#x', 'title':'<b>First</b>', 'description':'Short <b>description</b><script>BAD</script>'},
            {'url':'https://second.example.com/', 'title':'Solar panels solar panels'},
            {'url':'https://first.example.com/a', 'title':'Duplicate'},
            {'url':'https://127.0.0.1/', 'title':'Private'},
            {'url':'javascript:alert(1)', 'title':'Script'},
            {'url':'https://site.example.com/?token=SECRET', 'title':'Signed'}, None]}})
    retriever, _, requests = transport(tmp_path, respond)
    config = web_search.search_config({'provider':'brave', 'api_key':'fixture-credential'})
    rows = asyncio.run(web_search.search('solar panels', retriever, config))
    assert [r['title'] for r in rows] == ['First', 'Solar panels solar panels']
    assert rows[0]['snippet'] == 'Short description' and rows[0]['url'] == 'https://first.example.com/a'
    assert len(requests) == 1 and rows[0]['provenance'] == 'search_snippet'


@pytest.mark.parametrize('target', ['https://api.search.brave.com/res/v1/web/search?other=1', 'https://other.example.com/', 'https://127.0.0.1/'])
def test_brave_never_forwards_credentials_through_redirects(tmp_path, target):
    retriever, _, requests = transport(tmp_path, lambda _:httpx.Response(302, headers={'location':target}))
    config = web_search.search_config({'provider':'brave', 'api_key':'fixture-credential'})
    with pytest.raises(WebError, match='not forwarded'):
        asyncio.run(web_search.search('public search', retriever, config))
    assert len(requests) == 1


def test_credentials_cannot_be_attached_to_arbitrary_destinations(tmp_path):
    retriever, _, requests = transport(tmp_path, lambda _:pytest.fail('No connection allowed'))
    for url in ['https://other.example.com/', 'http://api.search.brave.com/res/v1/web/search',
                'https://api.search.brave.com/other', 'https://api.search.brave.com:444/res/v1/web/search']:
        with pytest.raises(WebError):
            asyncio.run(retriever.raw(url, brave_key='fixture-credential'))
    assert not requests


@pytest.mark.parametrize('answers', [['127.0.0.1'], ['93.184.216.34', '::1']])
def test_provider_mixed_or_private_dns_is_never_contacted(tmp_path, answers):
    retriever, _, requests = transport(tmp_path, lambda _:pytest.fail('No connection allowed'))
    async def dns(_):return answers
    retriever.access.resolver = dns
    config = web_search.search_config({'provider':'brave', 'api_key':'fixture-credential'})
    with pytest.raises(WebError):asyncio.run(web_search.search('public search', retriever, config))
    assert not requests


@pytest.mark.parametrize('body', [b'<html>Challenge</html>', b'[]', b'{"results":null}', b'{"error":"upstream"}'])
def test_provider_schema_failures_are_actionable(tmp_path, body):
    retriever, _, _ = transport(tmp_path, lambda _:httpx.Response(200, content=body))
    config = web_search.search_config({'provider':'searxng', 'endpoint':'https://search.example.com/search'})
    with pytest.raises(WebError, match='JSON'):
        asyncio.run(web_search.search('public search', retriever, config))


def test_missing_key_bad_key_and_rate_limit_have_clear_errors(tmp_path):
    retriever, clock, requests = transport(tmp_path, lambda _:httpx.Response(401))
    config = web_search.search_config({'provider':'brave'})
    with pytest.raises(WebError, match='API key'):asyncio.run(web_search.search('public search', retriever, config))
    assert not requests
    web_search.search_config({'provider':'brave', 'api_key':'fixture-credential'})
    with pytest.raises(WebError, match='rejected'):asyncio.run(web_search.search('public search', retriever, config))
    assert retriever.access._limits()['blocked_until'] == 0
    retriever.access.transport = httpx.MockTransport(lambda _:httpx.Response(429, headers={'retry-after':'120'}))
    with pytest.raises(WebError, match='pause'):asyncio.run(web_search.search('public search', retriever, config))
    assert retriever.access._limits()['blocked_until'] > clock.now()


async def complete(manager, kind='preview', value='https://site.example.com/article', include_image=True):
    job = manager.start(kind, value, include_image)
    await manager.tasks[job['id']]
    return manager.state(job['id'])


def test_preview_metadata_image_fallback_local_blob_and_excerpt(tmp_path):
    def respond(req):
        if req.url.path == '/robots.txt':return httpx.Response(200, text='User-agent: *\nAllow: /')
        if req.url.path == '/article':return httpx.Response(200, headers={'content-type':'text/html'}, text='''<html><head><title>Article</title>
            <meta name="description" content="A concise publisher description."><meta property="og:image" content="/missing.png"></head>
            <body><nav>Navigation</nav><article>Readable article text.<img src="/photo.png" alt="Page photo"></article></body></html>''')
        if req.url.path == '/missing.png':return httpx.Response(404)
        return httpx.Response(200, content=raster(), headers={'content-type':'image/png'})
    retriever, _, requests = transport(tmp_path, respond)
    async def scenario():
        manager = Lookup(retriever)
        job = await complete(manager)
        source = job['source']
        assert job['status'] == 'COMPLETED' and source['description_kind'] == 'page_metadata'
        assert source['description'] == 'A concise publisher description.'
        assert source['text'] == 'Readable article text.'
        assert len(source['images']) == 1 and source['image_warnings']
        assert image_store.get_bytes(source['images'][0]['src'])[0] == raster()
        assert source['images'][0]['source_url'] == 'https://site.example.com/photo.png'
        assert all(b[0] - a[0] >= 10 for a,b in zip(requests, requests[1:]))
        assert not (web_state.root()/'content').exists()
        snapshot = manager.state(job['id']);snapshot['source']['text'] = 'tampered'
        assert manager.state(job['id'])['source']['text'] == source['text']
        await manager.close()
    asyncio.run(scenario())


@pytest.mark.parametrize('image_problem', ['private_redirect', 'private_dns', 'robots', 'invalid', 'signed_redirect'])
def test_failed_image_keeps_page_text_and_search_results(tmp_path, image_problem):
    def respond(req):
        if req.url.path == '/robots.txt':return httpx.Response(200, text='User-agent: *\n' + ('Disallow: /picture.png' if image_problem == 'robots' else 'Allow: /'))
        if req.url.path == '/article':return html('An article with useful text.<img src="https://cdn.example.com/picture.png">')
        if image_problem.endswith('redirect'):
            return httpx.Response(302, headers={'location':'https://127.0.0.1/private' if image_problem == 'private_redirect' else 'https://site.example.com/?token=SECRET'})
        return httpx.Response(200, content=b'not an image', headers={'content-type':'image/png'})
    retriever, _, requests = transport(tmp_path, respond)
    async def dns(host):return ['10.0.0.1'] if image_problem == 'private_dns' and host == 'cdn.example.com' else ['93.184.216.34']
    retriever.access.resolver = dns
    async def scenario():
        manager = Lookup(retriever)
        job = await complete(manager)
        assert job['status'] == 'PARTIAL' and job['source']['text'] == 'An article with useful text.'
        assert not job['source']['images'] and job['warnings']
        assert all(r.url.host == '93.184.216.34' and 'token=' not in str(r.url) for _,r in requests)
        await manager.close()
    asyncio.run(scenario())


def test_text_only_no_asset_requests_and_stopped_image_retains_text(tmp_path):
    class Pages:
        async def retrieve(self, url):return document(url, 'Useful text.', image_candidates=[{'url':'https://site.example.com/p.png','alt':'Photo'}])
        async def image(self, url):entered.set();await asyncio.sleep(60)
    async def scenario():
        nonlocal entered
        entered = asyncio.Event()
        manager = Lookup(Pages())
        first = await complete(manager, include_image=False)
        assert first['status'] == 'COMPLETED' and not entered.is_set()
        pending = manager.start('preview','https://site.example.com/article',True)
        await entered.wait()
        await queue.cancel(queue.find(kind='web-lookup', request_id=pending['id']))
        await asyncio.wait_for(manager.tasks[pending['id']], 2)
        stopped = manager.state(pending['id'])
        assert stopped['status'] == 'CANCELLED' and stopped['source']['text'] == 'Useful text.'
        assert manager.state(first['id'])['source']['text'] == 'Useful text.'
        await manager.close()
    entered = None
    asyncio.run(scenario())


def test_jobs_cancel_before_start_expire_and_do_not_require_a_model(tmp_path):
    retriever, _, _ = transport(tmp_path, lambda _:httpx.Response(200,json={'query':{'search':[{'title':'Page', 'snippet':'Description'}]}}))
    async def scenario():
        now = [time.time()]
        manager = Lookup(retriever, clock=lambda:now[0])
        pending = manager.start('search','public topic')
        with pytest.raises(WebError, match='active'):manager.start('search','another topic')
        assert (await manager.cancel(pending['id']))['status'] == 'CANCELLED'
        job = await complete(manager, 'search', 'public topic')
        assert job['results'][0]['snippet'] == 'Description' and job['status'] == 'COMPLETED'
        now[0] += TTL + 1; manager.prune()
        assert not manager.jobs and not manager.tasks
        await complete(manager, 'search', 'another public topic')
        now[0] += TTL + 1  # Closing before the reaper runs must also be safe.
        await manager.close()
        assert not manager.jobs and not manager.tasks
    asyncio.run(scenario())


def test_http_routes_require_session_and_never_return_key(tmp_path, monkeypatch):
    from routes import web_system
    retriever, _, _ = transport(tmp_path, lambda _:html('A captured source.'))
    manager = Lookup(retriever);monkeypatch.setattr(web_system, 'lookup_manager', manager)
    app = FastAPI();app.include_router(web_system.router);app.add_middleware(SessionGuard)
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://127.0.0.1:8000') as client:
            assert (await client.post('/web-system/lookup', json={'query':'public topic'})).status_code == 403
            client.headers['X-LAW-Session'] = 'test-session-token'
            result = await client.put('/web-system/search', json={'provider':'brave','api_key':'fixture-credential'})
            assert result.status_code == 200 and 'fixture-credential' not in result.text
            assert 'fixture-credential' not in (await client.get('/web-system/search')).text
            assert (await client.post('/web-system/preview', json={'url':'https://127.0.0.1/'})).status_code == 400
            result = await client.post('/web-system/preview', json={'url':'https://site.example.com/article','include_image':False})
            uid = result.json()['id'];await manager.tasks[uid]
            assert (await client.get('/web-system/lookup/'+uid)).json()['source']['text'] == 'A captured source.'
            assert (await client.post('/web-system/lookup/'+uid+'/discard')).json()['discarded']
            assert (await client.get('/web-system/lookup/'+uid)).status_code == 400
        await manager.close()
    asyncio.run(scenario())
