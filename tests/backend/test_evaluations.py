import asyncio
from datetime import datetime, timedelta, timezone
import json

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from services.evaluation_contracts import Case, RunRequest, ScheduleRequest, Suite
from services.evaluation_runner import EvaluationManager, evaluate
from services.evaluation_store import summarize
from services.evaluation_starters import starter_suite


class FixtureProvider:
    def __init__(self):
        self.calls = []

    async def complete(self, request, target, case):
        self.calls.append((target['model'], case['id']))
        await asyncio.sleep(0)
        return {'response': case['checks'][0]['value'] if case['checks'] else 'Human review needed.',
                'metrics': {'inference_seconds': .1, 'tokens_per_second': 20},
                'runtime': {'model_digest': 'fixture-digest'}}


@pytest.fixture
def service(tmp_path):
    return EvaluationManager(tmp_path / 'eval.sqlite3', FixtureProvider())


def request(service, manual=True, **kwargs):
    return RunRequest(suite_id=service.store.suites()[0]['id'], targets=[{'kind': 'ollama', 'model': 'fixture:1'},
                      *([{'kind': 'manual', 'model': 'online-version-1'}] if manual else [])], **kwargs).model_dump(mode='json')


async def finish(service):
    await asyncio.gather(*list(service.tasks.values()))
    await asyncio.sleep(0)


def test_starter_truth_and_scoring():
    suite = Suite.model_validate(starter_suite()).model_dump(mode='json')
    assert len(suite['cases']) == 10
    assert {c['category'] for c in suite['cases']} == {'coding', 'data', 'instructions', 'facts', 'updates'}
    for case in suite['cases']:
        if case['checks']:
            assert evaluate(case, case['checks'][0]['value'])['score'] == 100
            assert evaluate(case, 'I did not follow the request.')['score'] == 0
        else:
            assert evaluate(case, 'Anything')['score'] is None
    case = suite['cases'][1]
    assert evaluate(case, '{"units":9,"revenue":62.5}')['score'] == 100
    assert evaluate(case, '```json\n{"units":9,"revenue":62.5}\n```')['score'] == 0
    assert evaluate(case, '{"units":9,"revenue":true}')['score'] == 0
    assert evaluate(case, '{"units":9.0,"revenue":62.50}')['score'] == 100
    custom = {**case, 'checks': [{'kind': 'exact', 'value': 'yes'}, {'kind': 'contains', 'value': 'YES'}, {'kind': 'not_contains', 'value': 'no'}]}
    assert evaluate(custom, 'yes')['score'] == 100
    assert evaluate(custom, 'yes no')['score'] == 33.33


def test_thinking_uses_advertised_values_only():
    from services.evaluation_runner import evaluation_thinking
    assert evaluation_thinking({'thinking': {'values': [False, True]}}) is False
    assert evaluation_thinking({'thinking': {'values': [True], 'default': True}}) is True
    assert evaluation_thinking({'thinking': {'values': ['medium', 'high'], 'default': 'medium'}}) == 'medium'
    assert evaluation_thinking({'thinking': {'values': ['low', 'medium'], 'default': 'medium'}}) == 'low'


def test_validation_and_dated_evidence(service):
    case = starter_suite()['cases'][0]
    with pytest.raises(ValueError):
        Case.model_validate({**case, 'category': 'live_freshness'})
    with pytest.raises(ValueError):
        Suite.model_validate({'name': 'duplicates', 'cases': [case, case]})
    with pytest.raises(ValueError):
        RunRequest.model_validate({**request(service), 'temperature': float('nan')})
    with pytest.raises(ValueError):
        RunRequest.model_validate({**request(service), 'targets': [{'kind': 'manual', 'model': '  '}]})
    with pytest.raises(ValueError):
        ScheduleRequest.model_validate({'request': request(service)})
    old = datetime.now(timezone.utc) - timedelta(days=2)
    dated = {**case, 'category': 'live_freshness', 'checked_at': old.isoformat(), 'valid_until': (old + timedelta(days=1)).isoformat()}
    suite = service.store.save_suite(Suite(name='expired', cases=[dated]).model_dump(mode='json'))
    with pytest.raises(ValueError, match='expired'):
        service.make_run({**request(service), 'suite_id': suite['id']})
    assert evaluate(dated, dated['checks'][0]['value'])['score'] is None
    assert evaluate(dated, dated['checks'][0]['value'])['reference_expired']


def test_durable_runs_manual_review_and_immutable_revisions(service):
    async def scenario():
        run = service.start(request(service, repeats=2))
        original = json.dumps(run['suite'], sort_keys=True)
        with pytest.raises(ValueError, match='already running'):
            service.start(request(service))
        await finish(service)
        saved = service.store.run(run['id'])
        assert saved['status'] == 'awaiting_response'
        assert len(service.provider.calls) == 20
        assert len(saved['results']) == 40
        baseline = next(r for r in saved['results'] if r['status'] == 'awaiting_response')
        updated = service.external(run['id'], baseline['id'], {'response': saved['suite']['cases'][0]['checks'][0]['value'], 'conditions': 'Exact model; tools off; today'})
        row = next(r for r in updated['results'] if r['id'] == baseline['id'])
        assert row['evaluation']['score'] == 100
        assert row['metrics'] == {}
        assert row['provenance'] == 'manual_paste'
        with pytest.raises(ValueError, match='already recorded'):
            service.external(run['id'], baseline['id'], {'response': 'replacement', 'conditions': 'new'})
        with pytest.raises(ValueError, match='Only manual'):
            service.external(run['id'], updated['results'][0]['id'], {'response': 'override', 'conditions': 'no'})
        reviewed = service.review(run['id'], baseline['id'], {'request_accuracy': 4, 'factual_accuracy': 2, 'freshness': None, 'notes': 'Evidence checked'})
        group = summarize(reviewed)['groups'][1]
        assert group['request_accuracy'] == 100 and group['factual_accuracy'] == 50
        assert group['review_count'] == 1 and group['inference_seconds'] is None
        assert group['completed'] == 1 and group['total'] == 20
        revised = starter_suite()
        revised['cases'][0]['messages'][0]['content'] = 'Changed request'
        service.store.save_suite(Suite.model_validate(revised).model_dump(mode='json'))
        restored = EvaluationManager(service.store.path, FixtureProvider())
        assert json.dumps(restored.store.run(run['id'])['suite'], sort_keys=True) == original
        assert restored.store.listing()[0]['groups'][1]['review_count'] == 1
    asyncio.run(scenario())


def test_failed_responses_and_queue_cancellation_are_not_success(service):
    class Failing:
        async def complete(self, *_):
            raise TimeoutError('fixture timed out')
    async def scenario():
        service.provider = Failing()
        run = service.start(request(service, manual=False))
        await finish(service)
        saved = service.store.run(run['id'])
        assert saved['status'] == 'completed_with_errors'
        group = summarize(saved)['groups'][0]
        assert group['failed'] == 10 and group['automated_score'] is None
        assert group['completed'] == 0 and group['review_count'] == 0
    asyncio.run(scenario())


def test_cancel_immediately_and_during_inference(service):
    started = asyncio.Event()
    class Slow:
        async def complete(self, *_):
            started.set()
            await asyncio.Event().wait()
    async def scenario():
        service.provider = Slow()
        run = service.start(request(service))
        saved = await service.stop(run['id'])
        assert saved['status'] == 'cancelled'
        await asyncio.sleep(0)
        run = service.start(request(service))
        await started.wait()
        saved = await service.stop(run['id'])
        assert saved['status'] == 'cancelled'
        assert all(r['status'] == 'cancelled' for r in saved['results'] if r['target_index'] == 0)
        assert all(r['status'] == 'awaiting_response' for r in saved['results'] if r['target_index'] == 1)
    asyncio.run(scenario())


def test_restart_retains_completed_responses_without_replay(service):
    run = service.make_run(request(service))
    run['status'] = 'running'
    run['results'][0].update(status='completed', response='retained')
    service.store.add_run(run)
    restored = EvaluationManager(service.store.path, FixtureProvider())
    saved = restored.store.run(run['id'])
    assert saved['status'] == 'interrupted'
    assert saved['results'][0]['response'] == 'retained'
    assert saved['results'][2]['status'] == 'interrupted'
    assert not restored.provider.calls
    assert not restored.busy()


def test_evaluation_data_has_an_explicit_reset_owner():
    from services.reset_scope import section_for
    assert section_for('evaluations') == 'utilities'


def test_unavailable_history_is_reported_without_replacing_the_database(tmp_path, monkeypatch):
    from routes import evaluations
    path = tmp_path / 'history.sqlite3'
    path.write_bytes(b'damaged-private-history')
    monkeypatch.setattr(evaluations, 'manager', lambda: EvaluationManager(path, FixtureProvider()))
    app = FastAPI()
    app.include_router(evaluations.router)
    with TestClient(app) as client:
        response = client.get('/evaluations')
        assert response.status_code == 503
        assert 'Preserve the evaluations folder' in response.json()['detail']
    assert path.read_bytes() == b'damaged-private-history'


def test_schedules_persist_skip_backlogs_and_stop_at_limit(service, monkeypatch):
    from services.maintenance_gate import gate
    async def scenario():
        schedule = service.schedule(ScheduleRequest(request=request(service, manual=False), interval_hours=24, max_runs=2).model_dump(mode='json'))
        monkeypatch.setattr(gate, 'locked', True)
        monkeypatch.setattr(gate, 'expires', float('inf'))
        service.tick()
        assert not service.store.listing()
        monkeypatch.setattr(gate, 'locked', False)
        service.tick()
        service.tick()
        await finish(service)
        assert len(service.store.listing()) == 1
        updated = service.store.schedules()[0]
        assert updated['runs_started'] == 1 and updated['enabled']
        updated['next_due'] = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        service.store.put_schedule(updated)
        service.tick()
        await finish(service)
        assert len(service.store.listing()) == 2
        updated = service.store.schedules()[0]
        assert updated['runs_started'] == 2 and not updated['enabled']
        restored = EvaluationManager(service.store.path, FixtureProvider())
        restored.tick()
        assert not restored.provider.calls
        assert restored.store.schedules()[0]['id'] == schedule['id']
    asyncio.run(scenario())


def test_expired_schedule_disables_with_visible_reason(service):
    async def scenario():
        current = datetime.now(timezone.utc)
        case = starter_suite()['cases'][0] | {'category': 'live_freshness', 'checked_at': (current - timedelta(hours=1)).isoformat(), 'valid_until': (current + timedelta(hours=1)).isoformat()}
        suite = service.store.save_suite(Suite(name='dated', cases=[case]).model_dump(mode='json'))
        schedule = service.schedule(ScheduleRequest(request={**request(service, manual=False), 'suite_id': suite['id']}).model_dump(mode='json'))
        # Simulate reference expiry without changing the immutable suite or wall clock.
        import services.evaluation_runner as runner
        original = runner.validate_reference
        def expired(_):
            raise ValueError('Reference expired for dated case.')
        runner.validate_reference = expired
        try:
            service.tick()
        finally:
            runner.validate_reference = original
        saved = service.store.schedules()[0]
        assert saved['id'] == schedule['id'] and not saved['enabled']
        assert 'expired' in saved['last_error'] and not service.store.listing()
    asyncio.run(scenario())


def test_api_uses_bounded_validation_and_private_session_guard(service, monkeypatch):
    from routes import evaluations
    from services.session_guard import SessionGuard
    monkeypatch.setattr(evaluations, 'manager', lambda: service)
    app = FastAPI()
    app.include_router(evaluations.router)
    app.add_middleware(SessionGuard)
    with TestClient(app, base_url='http://127.0.0.1:8000') as client:
        assert client.get('/evaluations').status_code == 403
        headers = {'X-LAW-Session': 'test-session-token'}
        assert client.get('/evaluations', headers=headers).status_code == 200
        assert client.get('/evaluations/runs/missing', headers=headers).status_code == 404
        assert client.post('/evaluations/runs', headers=headers, json={**request(service), 'repeats': 99}).status_code == 422
        response = client.post('/evaluations/runs', headers=headers, json={**request(service), 'targets': [{'kind': 'manual', 'model': 'exact-version'}]})
        assert response.status_code == 200
        run = response.json()
        # Manual-only runs settle asynchronously without contacting the local provider.
        assert len(run['results']) == 10
        result = run['results'][0]
        assert client.post(f"/evaluations/runs/{run['id']}/responses/{result['id']}", headers=headers,
                           json={'response': 'answer', 'conditions': ''}).status_code == 422
        assert client.put(f"/evaluations/runs/{run['id']}/reviews/{result['id']}", headers=headers,
                          json={'request_accuracy': 5, 'factual_accuracy': 4}).status_code == 422
        assert not service.provider.calls


def test_ollama_protocol_records_metrics_and_releases_shared_queue(tmp_path, monkeypatch):
    import httpx
    from services import evaluation_runner as runner
    from services.request_queue import RequestQueue
    from services.gpu_coordination import GpuCoordinator
    isolated_queue = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(runner, 'queue', isolated_queue)
    calls = []
    async def prepare(_):
        pass
    async def prepared(job, model, base, options):
        assert isolated_queue.active is job
        yield {'stage': 'ready'}
    monkeypatch.setattr(runner, 'prepare_runtime', prepare)
    monkeypatch.setattr(runner, 'prepare_chat_model', prepared)
    def transport(request):
        calls.append(request.url.path)
        if request.url.path == '/api/show':
            return httpx.Response(200, json={'model_info': {'fixture.context_length': 4096}, 'details': {'quantization_level': 'Q4'}})
        if request.url.path == '/api/tags':
            return httpx.Response(200, json={'models': [{'name': 'fixture:latest', 'digest': 'pinned-fixture'}]})
        if request.url.path == '/api/version':
            return httpx.Response(200, json={'version': 'fixture-runtime'})
        if request.url.path == '/api/chat':
            body = json.loads(request.content)
            assert body['options']['temperature'] == 0 and body['options']['seed'] == 42
            assert body['messages'][0]['role'] == 'system' and body['messages'][-1]['role'] == 'user'
            return httpx.Response(200, text='\n'.join(json.dumps(v) for v in [
                {'message': {'content': '{"total":45}'}},
                {'done': True, 'eval_count': 10, 'eval_duration': 500000000, 'prompt_eval_count': 25, 'done_reason': 'stop'}]))
        raise AssertionError(request.url.path)
    client = httpx.AsyncClient
    monkeypatch.setattr(runner.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(transport), **kwargs))
    async def scenario():
        service = EvaluationManager(tmp_path / 'protocol.sqlite3', FixtureProvider())
        value = await runner.OllamaEvaluator().complete(request(service, manual=False), {'model': 'fixture'}, starter_suite()['cases'][0])
        assert value['response'] == '{"total":45}'
        assert value['metrics']['tokens_per_second'] == 20
        assert value['metrics']['input_tokens'] == 25
        assert value['metrics']['first_token_seconds'] is not None
        assert value['runtime']['model_digest'] == 'pinned-fixture'
        assert isolated_queue.active is None
        assert isolated_queue.jobs[-1].status == 'completed'
        assert '/api/chat' in calls
    asyncio.run(scenario())


def test_provider_stream_failure_does_not_report_success(service, monkeypatch):
    import httpx
    from services import evaluation_runner as runner
    from services.request_queue import RequestQueue
    from services.gpu_coordination import GpuCoordinator
    isolated_queue = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(runner, 'queue', isolated_queue)
    async def prepare(_):
        pass
    async def prepared(*args, **kwargs):
        yield {}
    monkeypatch.setattr(runner, 'prepare_runtime', prepare)
    monkeypatch.setattr(runner, 'prepare_chat_model', prepared)
    def transport(request):
        if request.url.path == '/api/chat':
            return httpx.Response(200, text='{"message":{"content":"partial answer"}}\n')
        return httpx.Response(200, json={'models': [], 'model_info': {}})
    client = httpx.AsyncClient
    monkeypatch.setattr(runner.httpx, 'AsyncClient', lambda **kwargs: client(transport=httpx.MockTransport(transport), **kwargs))
    async def scenario():
        with pytest.raises(ValueError, match='complete visible answer'):
            await runner.OllamaEvaluator().complete(request(service, manual=False), {'model': 'fixture'}, starter_suite()['cases'][0])
        assert isolated_queue.active is None
        assert isolated_queue.jobs[-1].status == 'failed'
    asyncio.run(scenario())
