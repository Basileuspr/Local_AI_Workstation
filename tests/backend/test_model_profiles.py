import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from services import context_awareness as context, thinking_trace as thinking
from services.chat_context import fit_payload
from services.model_profiles import default_profile


def test_profiles_follow_model_metadata_and_keep_conservative_starting_windows():
    big = default_profile({'model_info': {'x.context_length': 131072}, 'thinking': {'values': ['low','medium','high'], 'default': 'medium'}})
    small = default_profile({'model_info': {'x.context_length': 4096}})
    vision = default_profile({'model_info': {'x.context_length': 262144}, 'thinking': {'values': [False, True], 'default': True}})
    assert big['thinking'] == 'medium' and big['responseLength'] == min(2048, big['contextWindow'] // 2)
    assert big['maxContext'] == 131072
    assert small['contextWindow'] <= 4096 and small['responseLength'] == 1024
    assert vision['thinking'] is False and vision['responseLength'] == 1024


def test_profile_window_can_exceed_host_default_but_never_known_model_or_provider_limits(monkeypatch):
    monkeypatch.setattr(context, '_limits', {})
    monkeypatch.setattr(context, '_runtime_limits', {})
    context.remember_limit('big', {'x.context_length': 131072})
    context.remember_limit('small', {'x.context_length': 4096})
    assert asyncio.run(context.model_limit('big', 32768)) == 32768
    assert asyncio.run(context.model_limit('small', 32768)) == 4096
    context.remember_runtime_limit('big', 8192)
    assert asyncio.run(context.model_limit('big', 32768)) == 8192
    assert context.effective_limit('unknown', requested=262144) == context.settings.num_ctx


def test_optional_context_stays_intact_when_the_actual_assembled_prompt_fits():
    messages = [{'role':'system','content':'The following are durable memories\n' + 'useful fact. ' * 450}, {'role':'user','content':'Explain the facts.'}]
    payload = {'model':'example','messages':messages,'options':{'num_ctx':8192,'num_predict':1024}}
    fitted = fit_payload(payload)
    assert fitted['messages'] == messages
    assert fitted['_context_notices'] == []
    assert fitted['_context_budget']['input_target'] == 6656


def test_actual_tools_and_retrieval_consume_one_budget_and_keep_latest_question():
    messages = [{'role':'system','content':'The following are durable memories\n' + 'useful fact. ' * 800}, {'role':'user','content':'My latest question'}]
    fitted = fit_payload({'model':'small','messages':messages,'tools':[{'name':'tool','description':'Contract ' * 150}], 'options':{'num_ctx':4096,'num_predict':1024}})
    usage = context.payload_usage(fitted)
    assert usage['prompt_tokens'] + usage['output_reserve'] + usage['safety_reserve'] <= 4096
    assert usage['tool_tokens_estimate'] > 0
    assert fitted['messages'][-1] == messages[-1]
    assert len(fitted['messages'][0]['content']) < len(messages[0]['content'])


def test_thinking_validation_handles_aliases_and_summary_policy():
    info = {'model_info':{'general.architecture':'gpt-oss'}}
    assert thinking.selected_thinking(info, 'high') == 'high'
    assert thinking.selected_thinking(info, prefer_brief=True) == 'low'
    with pytest.raises(ValueError, match='does not support'):
        thinking.selected_thinking(info, False)
    assert thinking.selected_thinking({'thinking': {'values':[False,True]}}, False) is False


def test_chat_carries_profile_to_provider_and_reports_actual_counts(tmp_path, monkeypatch):
    import main
    from conftest import API_BASE_URL, AUTH_HEADERS
    from services.request_queue import RequestQueue
    from services.gpu_coordination import GpuCoordinator
    monkeypatch.setattr(main, 'THINKING_LOG_PATH', tmp_path / 'trace.log')
    monkeypatch.setattr(main, 'queue', RequestQueue(GpuCoordinator()))
    monkeypatch.setattr(context, '_limits', {})
    monkeypatch.setattr(context, '_runtime_limits', {})
    monkeypatch.setattr(thinking, '_models', {})
    async def prepare(_): pass
    monkeypatch.setattr(main, 'prepare_runtime', prepare)
    captured = []
    async def provider(request):
        if request.url.path == '/api/show':
            return httpx.Response(200, json={'model_info': {'fixture.context_length': 131072}, 'thinking': {'values':['low','medium','high'], 'default':'medium'}})
        assert request.url.path == '/api/chat'
        captured.append(json.loads(request.content))
        return httpx.Response(200, text=json.dumps({'message': {'content':'Complete'}, 'done':True,'prompt_eval_count':300,'eval_count':20,'eval_duration':1000000000})+'\n')
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda *a, **kw: real_client(*a, **kw, transport=httpx.MockTransport(provider)))
    client = TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS)
    request = {'model':'renamed-model','messages':[{'role':'user','content':'hello'}], 'use_memory':False,
               'options':{'num_ctx':16384,'num_predict':3072},'think':'high'}
    response = client.post('/chat', json=request)
    assert response.status_code == 200
    assert captured[-1]['options']['num_ctx'] == 16384 and captured[-1]['options']['num_predict'] == 3072
    assert captured[-1]['think'] == 'high'
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    usage = next(event['context_usage'] for event in events if 'context_usage' in event)
    assert usage['configured_context_limit'] == 16384 and usage['prompt_tokens'] == 300
    assert usage['generation_tokens_per_second'] == 20
    context.remember_runtime_limit('renamed-model', 8192)
    response = client.post('/chat', json=request)
    assert captured[-1]['options']['num_ctx'] == 8192
    assert not any(key.startswith('_context_') for key in captured[-1])
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    usage = next(event['context_usage'] for event in events if 'context_usage' in event)
    assert any('limited to 8192' in notice for notice in usage['adjustments'])
    size = len(captured)
    response = client.post('/chat', json={**request, 'think':False})
    assert 'does not support' in response.text and len(captured) == size
