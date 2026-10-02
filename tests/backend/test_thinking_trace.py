import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from services import thinking_trace as traces


@pytest.mark.parametrize('info, expected', [
    ({'thinking': {'values': [False, True], 'default': False}}, True),
    ({'thinking': {'values': ['low', 'medium', 'high'], 'default': 'medium'}}, 'medium'),
    ({'thinking': {'values': ['minimal', 'deep'], 'default': 'deep'}}, 'deep'),
    ({'thinking': {'values': [False]}}, False),
    ({'model_info': {'general.architecture': 'gpt-oss'}, 'capabilities': ['thinking']}, 'medium'),
    ({'details': {'family': 'gptoss'}}, 'medium'),
    ({'capabilities': ['thinking']}, True),
    ({'capabilities': ['completion']}, None),
])
def test_model_controls_use_metadata_not_model_names(info, expected):
    assert traces.thinking_setting(info) == expected


def test_discovery_caches_models_and_failure_uses_provider_default(monkeypatch):
    monkeypatch.setattr(traces, '_models', {})
    calls = []
    async def handler(request):
        calls.append(request.url.path)
        if len(calls) > 1: return httpx.Response(503)
        return httpx.Response(200, json={'thinking': {'values': [False, True]}})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert await traces.resolve_thinking(client, 'http://ollama', 'custom-name') is True
            assert await traces.resolve_thinking(client, 'http://ollama', 'custom-name') is True
            assert await traces.resolve_thinking(client, 'http://ollama', 'offline') is None
    asyncio.run(run())
    assert calls == ['/api/show', '/api/show']


@pytest.mark.parametrize('tag', ['think', 'thinking', 'analysis', 'THINK'])
def test_every_tag_chunk_boundary_preserves_full_trace_and_answer(tag):
    text = f'Before <{tag}>First 🧠\nSecond</{tag}>Answer<'
    for split in range(len(text) + 1):
        recorded, visible = [], []
        trace = traces.TraceCapture(recorded.append)
        for piece in (text[:split], text[split:]):
            content, _ = trace.chunk({'message': {'content': piece}})
            visible.append(content)
        visible.append(trace.chunk({'done': True})[0])
        assert ''.join(visible) == 'Before Answer<'
        assert ''.join(recorded) == 'First 🧠\nSecond'


@pytest.mark.parametrize('field', ['thinking', 'reasoning_content', 'reasoning', 'thought'])
@pytest.mark.parametrize('top_level', [False, True])
def test_native_trace_aliases_and_inline_content(field, top_level):
    capture = []
    trace = traces.TraceCapture(capture.append)
    message = {'content': '<think>more</think>Answer'}
    chunk = {'message': message, 'done': True}
    (chunk if top_level else message)[field] = 'Native '
    assert trace.chunk(chunk) == ('Answer', 'Native more')
    assert ''.join(capture) == 'Native more'


def test_no_trace_status_and_cancelled_partial_trace_are_explicit():
    recorded = []
    trace = traces.TraceCapture(recorded.append)
    trace.chunk({'message': {'content': 'Normal answer'}, 'done': True})
    trace.finish('Response complete')
    trace.finish('Duplicate')
    assert 'No thinking trace was emitted' in ''.join(recorded)
    assert 'Normal answer' not in ''.join(recorded)
    assert 'Duplicate' not in ''.join(recorded)
    recorded.clear()
    trace = traces.TraceCapture(recorded.append)
    trace.chunk({'message': {'content': '<think>Working</thi'}})
    trace.finish('Stopped')
    assert ''.join(recorded) == 'Working</thi\n[Stopped]\n'


def test_budget_reserves_answer_room_without_changing_unlimited_or_direct_models():
    assert traces.reserve_thinking_budget({'num_predict': 256}, True)['num_predict'] == 8448
    assert traces.reserve_thinking_budget({'num_predict': -1}, 'medium')['num_predict'] == -1
    assert traces.reserve_thinking_budget({'num_predict': 256}, None)['num_predict'] == 256


def test_trace_pages_preserve_unicode_and_reset(tmp_path):
    path = tmp_path / 'trace.log'
    text = 'Start 🧠漢字\n' * 80
    path.write_text(text, encoding='utf-8')
    offset, output = 0, ''
    while True:
        page = traces.read_trace(path, offset, 'one', 'one', size=13)
        output += page['content']; offset = page['next_offset']
        if not page['more']: break
    assert output.replace('\r\n', '\n') == text
    path.write_text('New', encoding='utf-8')
    assert traces.read_trace(path, offset, 'two', 'one')['content'] == 'New'


@pytest.fixture
def client(tmp_path, monkeypatch):
    import main
    from conftest import API_BASE_URL, AUTH_HEADERS
    from services.request_queue import RequestQueue
    from services.gpu_coordination import GpuCoordinator
    monkeypatch.setattr(main, 'THINKING_LOG_PATH', tmp_path / 'thinking.log')
    monkeypatch.setattr(main, 'queue', RequestQueue(GpuCoordinator()))
    monkeypatch.setattr(traces, '_models', {})
    async def prepare(_): pass
    monkeypatch.setattr(main, 'prepare_runtime', prepare)
    main._ensure_thinking_log()
    return TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS)


def test_export_is_full_repeatable_non_destructive_and_read_is_authenticated(client):
    import main
    text = 'First model\n' + 'Long trace 🧠\n' * 25000 + 'Last model\n'
    main._append_thinking(text)
    original = main.THINKING_LOG_PATH.read_bytes()
    first = client.get('/thinking/export')
    assert first.status_code == 200
    assert first.text == text
    assert client.get('/thinking/export').text == text
    assert main.THINKING_LOG_PATH.read_bytes() == original
    main._ensure_thinking_log()
    assert main.THINKING_LOG_PATH.read_bytes() == original
    assert first.headers['cache-control'] == 'no-store'
    page = client.get('/thinking/trace').json()
    assert page['more']
    page2 = client.get('/thinking/trace', params={'offset': page['next_offset'], 'revision': page['revision']}).json()
    assert page2['offset'] == page['next_offset']
    assert (page['content'] + page2['content']).replace('\r\n', '\n') == text
    client.post('/thinking/reset')
    reset = client.get('/thinking/trace', params={'offset': page2['next_offset'], 'revision': page['revision']}).json()
    assert reset['offset'] == 0 and reset['content'] == '' and reset['revision'] != page['revision']
    assert client.get('/thinking/trace?offset=-1').status_code == 422
    from conftest import API_BASE_URL
    assert TestClient(main.app, base_url=API_BASE_URL).get('/thinking/trace').status_code == 403


@pytest.mark.parametrize('model, info, chunks, expected_trace, expected_answer', [
    ('renamed-model', {'thinking': {'values': ['low', 'medium', 'high'], 'default': 'medium'}},
     [{'message': {'thinking': 'Full native 🧠'}}, {'message': {'content': 'Answer<'}, 'done': True}], 'Full native 🧠', 'Answer<'),
    ('legacy', {}, [{'message': {'content': '<thi'}}, {'message': {'content': 'nk>Full inline</think>Answer<'}, 'done': True}], 'Full inline', 'Answer<'),
    ('direct', {'thinking': {'values': [False]}}, [{'message': {'content': 'Answer'}, 'done': True}], 'No thinking trace was emitted', 'Answer'),
    ('limited', {'capabilities': ['thinking']}, [{'message': {'thinking': 'Partial'}}, {'done': True, 'done_reason': 'length'}], 'Partial', 'output limit'),
])
def test_chat_records_all_channels_and_keeps_answers_visible(client, monkeypatch, model, info, chunks, expected_trace, expected_answer):
    import main
    captured = []
    async def handler(request):
        if request.url.path == '/api/show': return httpx.Response(200, json=info)
        captured.append(json.loads(request.content))
        return httpx.Response(200, text='\n'.join(json.dumps(chunk) for chunk in chunks))
    client_type = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, 'AsyncClient', lambda **kwargs: client_type(transport=httpx.MockTransport(handler), **kwargs))
    response = client.post('/chat', json={'model': model, 'use_memory': False,
                           'messages': [{'role': 'user', 'content': 'Hi'}], 'options': {'num_predict': 256}})
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert expected_answer in ''.join(event.get('token', '') for event in events)
    assert expected_trace in main.THINKING_LOG_PATH.read_text(encoding='utf-8')
    assert captured[0].get('think') == traces.thinking_setting(info)
    if model == 'renamed-model': assert captured[0]['options']['num_predict'] == 8448


def test_canvas_capture_uses_same_full_trace_adapter():
    from services.chat_canvas import CanvasContext, stream_canvas
    captured = []
    async def provider(request):
        return httpx.Response(200, text=json.dumps({'message': {'reasoning_content': 'Canvas trace', 'content': json.dumps({'summary': 'Done', 'operations': [{'op': 'remove', 'id': 'item'}]})}, 'done': True}))
    async def connected(): return False
    async def run():
        request = SimpleNamespace(canvas_context=CanvasContext(revision='1', objects=[{'id': 'item', 'type': 'rect', 'x': 0, 'y': 0, 'width': 20, 'height': 20}]))
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            return [event async for event in stream_canvas(client, {'model': 'custom', 'messages': []}, request, SimpleNamespace(is_disconnected=connected), trace=traces.TraceCapture(captured.append))]
    events = asyncio.run(run())
    assert any('Canvas trace' in event for event in events)
    assert ''.join(captured) == 'Canvas trace\n[Canvas response complete]\n'
