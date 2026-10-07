import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from routes.tool_registry import router
from services import tool_registry, tool_execution, tool_coordinator
from services.tool_catalog import Tool
from services.request_queue import RequestQueue
from services.session_guard import SessionGuard


@pytest.fixture
def app(monkeypatch):
    app = FastAPI()
    app.add_middleware(SessionGuard)
    app.include_router(router)
    calls = []

    class Value(BaseModel):
        value: int

    @app.get('/test/read/{ident}')
    def read(ident: str, n: int = 2):
        calls.append(('read', ident, n))
        return {'id': ident, 'n': n}

    @app.post('/test/write')
    def write(body: Value):
        calls.append(('write', body.value))
        return {'value': body.value}

    monkeypatch.setattr(tool_registry, 'TOOLS', (
        Tool('read', 'Read', 'Test', 'test', 'Read data.', 'JSON.', 'GET', '/test/read/{ident}'),
        Tool('write', 'Write', 'Test', 'test', 'Save value.', 'JSON.', 'POST', '/test/write', effects=('writes_app_data',)),
    ))
    tool_execution._plans.clear()
    app.state.calls = calls
    yield app
    tool_execution._plans.clear()


@pytest.fixture
def client(app):
    return TestClient(app, base_url='http://127.0.0.1:8000', headers={'X-LAW-Session':'test-session-token'})


def test_read_dispatch_is_authenticated_and_does_not_accept_arbitrary_endpoints(client, app):
    assert client.post('/tools/execute', json={'tool_id':'read','arguments':{'path':{'ident':'abc'},'query':{'n':3}}}).json() == {
        'status':'completed','http_status':200,'result':{'id':'abc','n':3}}
    assert app.state.calls == [('read','abc',3)]
    for arguments in ({}, {'path':{'ident':'../secret'}}, {'path':{'ident':'abc'}, 'header':{'X-LAW-Session':'secret'}},
                      {'path':{'ident':'abc'},'query':{'law_token':'secret'}}, {'path':{'ident':'abc'},'url':'https://example.com'}):
        assert client.post('/tools/execute',json={'tool_id':'read','arguments':arguments}).status_code == 422
    assert client.post('/tools/execute',json={'tool_id':'unknown','arguments':{}}).status_code == 400
    assert client.post('/tools/execute',headers={'X-LAW-Session':'wrong'},json={'tool_id':'read','arguments':{}}).status_code == 403
    assert app.state.calls == [('read','abc',3)]


def test_action_requires_exact_single_use_review_and_denial_never_dispatches(client, app):
    pending = client.post('/tools/execute',json={'tool_id':'write','arguments':{'body':{'value':42}}}).json()
    assert pending['status'] == 'pending' and app.state.calls == []
    ident = pending['plan']['id']
    assert client.post(f'/tools/plans/{ident}/decision', json={'approved':True,'arguments':{'body':{'value':99}}}).status_code == 422
    result = client.post(f'/tools/plans/{ident}/decision',json={'approved':True})
    assert result.json()['result'] == {'value':42}
    assert client.post(f'/tools/plans/{ident}/decision',json={'approved':True}).status_code == 404
    pending = client.post('/tools/execute',json={'tool_id':'write','arguments':{'body':{'value':7}}}).json()
    assert client.post(f"/tools/plans/{pending['plan']['id']}/decision",json={'approved':False}).json()['status'] == 'denied'
    assert app.state.calls == [('write',42)]


def test_nested_schema_rejects_ignored_fields_and_expired_plan(client, app):
    assert client.post('/tools/execute',json={'tool_id':'write','arguments':{'body':{'value':1,'other':'private'}}}).status_code == 422
    ident = client.post('/tools/execute',json={'tool_id':'write','arguments':{'body':{'value':1}}}).json()['plan']['id']
    tool_execution._plans[ident]['expires'] = 0
    assert client.post(f'/tools/plans/{ident}/decision',json={'approved':True}).json()['status'] == 'expired'
    assert app.state.calls == []


def test_stopped_chat_cannot_approve_its_unclaimed_action(app):
    import threading
    async def exercise():
        registry = tool_registry.build_registry(app.openapi())
        tool = tool_execution.validate_call(registry, 'write', {'body':{'value':1}})
        stopped = threading.Event()
        plan = tool_execution.create_plan(tool, {'body':{'value':1}}, cancel_event=stopped)
        stopped.set()
        result = await tool_execution.decide_plan(app, registry, plan['id'], True)
        assert result['status'] == 'cancelled' and not app.state.calls
    asyncio.run(exercise())


class GPU:
    owner = None
    def reserve(self, owner):
        if self.owner is not None: return False
        self.owner = owner
        return True
    def release(self, owner):
        assert self.owner == owner
        self.owner = None


class ModelClient:
    def __init__(self, rounds): self.rounds, self.payloads = list(rounds), []
    def stream(self, method, url, json):
        self.payloads.append(json)
        chunks = self.rounds.pop(0)
        class Response:
            is_error = False
            async def __aenter__(self): return self
            async def __aexit__(self, *_): pass
            async def aiter_lines(self):
                for chunk in chunks: yield __import__('json').dumps(chunk)
        return Response()


class ClientRequest:
    def __init__(self, app): self.app = app
    async def is_disconnected(self): return False


def test_coordinator_runs_then_answers_and_yields_gpu_to_nested_tools(app, monkeypatch):
    async def exercise():
        queue = RequestQueue(GPU())
        job = queue.enqueue('chat','Neutral test','req')
        assert queue.try_start(job)
        monkeypatch.setattr(tool_coordinator,'queue',queue)
        async def prepare(_): pass
        monkeypatch.setattr(tool_coordinator,'prepare_runtime',prepare)
        original = tool_coordinator.dispatch
        async def check_dispatch(*args):
            assert queue.active is None and queue.coordinator.owner is None
            nested = queue.enqueue('embedding','Neutral nested tool')
            assert queue.try_start(nested)
            queue.finish(nested)
            return await original(*args)
        monkeypatch.setattr(tool_coordinator,'dispatch',check_dispatch)
        model = ModelClient([
            [{'message':{'tool_calls':[{'function':{'name':'read','arguments':{'path':{'ident':'neutral'}}}}]},'done':True}],
            [{'message':{'content':'Result is 2.'},'done':True}],
        ])
        request = SimpleNamespace(tool_ids=['read'], request_id='req')
        events = [json.loads(data[6:]) async for data in tool_coordinator.stream_tools(model,'http://ollama',{'messages':[]},request,ClientRequest(app)) if data.startswith('data: ')]
        assert events[-1]['done'] is True
        assert events[-2]['token'] == 'Result is 2.'
        assert model.payloads[-1]['messages'][-1]['role'] == 'tool'
        assert 'test-session-token' not in json.dumps(model.payloads)
        assert queue.active is job
        queue.finish(job)
    asyncio.run(exercise())


def test_coordinator_denial_and_cancelled_review_do_not_execute(app, monkeypatch):
    async def exercise():
        model = ModelClient([
            [{'message':{'tool_calls':[{'function':{'name':'write','arguments':{'body':{'value':4}}}}]},'done':True}],
            [{'message':{'content':'Action denied.'},'done':True}],
        ])
        request = SimpleNamespace(tool_ids=['write'],request_id='req')
        output = []
        async for data in tool_coordinator.stream_tools(model,'http://ollama',{'messages':[]},request,ClientRequest(app)):
            if data.startswith('data: '):
                value = json.loads(data[6:]); output.append(value)
                if value.get('tool_approval'):
                    await tool_execution.decide_plan(app,tool_registry.build_registry(app.openapi()),value['tool_approval']['id'],False)
        assert any(item.get('tool_activity',{}).get('status') == 'denied' for item in output)
        assert not app.state.calls
        model = ModelClient([[{'message':{'tool_calls':[{'function':{'name':'write','arguments':{'body':{'value':5}}}}]},'done':True}]])
        stream = tool_coordinator.stream_tools(model,'http://ollama',{'messages':[]},request,ClientRequest(app))
        async for data in stream:
            if 'tool_approval' in data: break
        await stream.aclose()
        assert tool_execution._plans == {} and not app.state.calls
    asyncio.run(exercise())


def test_ordinary_chat_endpoint_connects_selected_tools_and_preserves_opt_out(monkeypatch):
    import httpx
    import main
    from services import context_awareness, thinking_trace
    actual_client = httpx.AsyncClient
    seen, provider_requests = [], []
    monkeypatch.setattr(main.app.router, 'routes', list(main.app.router.routes))
    monkeypatch.setattr(main.app, 'openapi_schema', None)

    @main.app.get('/neutral-tool-fixture')
    def neutral():
        seen.append(731)
        return {'value':731}

    monkeypatch.setattr(tool_registry, 'TOOLS', (Tool('neutral', 'Neutral', 'Test', 'test', 'Read a fixed test value.', 'JSON.', 'GET', '/neutral-tool-fixture'),))
    async def prepare(*_args): pass
    async def limit(*_args): return 2048
    async def thinking(*_args): return None
    monkeypatch.setattr(main, 'prepare_runtime', prepare)
    monkeypatch.setattr(tool_coordinator, 'prepare_runtime', prepare)
    monkeypatch.setattr(context_awareness, 'model_limit', limit)
    monkeypatch.setattr(thinking_trace, 'resolve_thinking', thinking)

    def provider(request):
        payload = json.loads(request.content)
        provider_requests.append(payload)
        if payload.get('tools') and not any(message['role'] == 'tool' for message in payload['messages']):
            chunks = [{'message':{'tool_calls':[{'function':{'name':'neutral','arguments':{}}}]},'done':True}]
        else:
            chunks = [{'message':{'content':'The neutral value is 731.'},'done':True}]
        return httpx.Response(200, content='\n'.join(json.dumps(chunk) for chunk in chunks))

    def client_factory(**kwargs):
        if 'transport' not in kwargs: kwargs['transport'] = httpx.MockTransport(provider)
        return actual_client(**kwargs)
    monkeypatch.setattr(httpx, 'AsyncClient', client_factory)
    client = TestClient(main.app,base_url='http://127.0.0.1:8000',headers={'X-LAW-Session':'test-session-token'})
    payload = {'model':'neutral-test-model','messages':[{'role':'user','content':'Read the neutral value.'}],
               'use_memory':False,'use_durable_memory':False,'tool_ids':['neutral']}
    response = client.post('/chat',json=payload)
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert response.status_code == 200 and seen == [731]
    assert any(item.get('tool_activity',{}).get('status') == 'completed' for item in events)
    assert '731' in ''.join(item.get('token','') for item in events)
    assert events[-1].get('done') and events[-1].get('context_usage')
    assert 'test-session-token' not in json.dumps(provider_requests)
    before = len(provider_requests)
    payload['tool_ids'] = []
    response = client.post('/chat',json=payload)
    assert response.status_code == 200 and seen == [731]
    assert len(provider_requests) == before + 1 and 'tools' not in provider_requests[-1]
