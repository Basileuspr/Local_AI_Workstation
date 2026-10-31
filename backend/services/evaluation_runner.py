"""Sequential local evaluation, explicit manual baselines and durable schedules."""
from __future__ import annotations

import asyncio
from contextlib import suppress
from datetime import datetime, timedelta, timezone
import json
import platform
import time
from uuid import uuid4

import httpx

from config import settings
from services.chat_model_runtime import canonical_model, prepare_chat_model
from services.evaluation_contracts import RunRequest
from services.evaluation_store import EvaluationStore, fingerprint, now
from services.request_queue import queue, prepare_runtime, QueueCancelled
from services.thinking_trace import thinking_setting

SYSTEM = 'Answer the user request accurately. Use the supplied evidence. State uncertainty when information is unavailable. Do not claim actions you did not perform.'


def json_equal(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(json_equal(left[k], right[k]) for k in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(json_equal(a, b) for a, b in zip(left, right))
    return left == right


def evaluation_thinking(info):
    values = (info.get('thinking') or {}).get('values', [])
    if any(value is False for value in values):
        return False
    selected = thinking_setting(info)
    if isinstance(selected, str) and 'low' in values:
        return 'low'
    return selected


def evaluate(case, answer, at=None):
    at = at or now()
    expired = bool(case.get('valid_until') and datetime.fromisoformat(case['valid_until']) <= datetime.fromisoformat(at))
    checks = []
    for check in case['checks']:
        value, kind = check['value'], check['kind']
        if kind == 'json_equals':
            try:
                # Booleans are distinct from numbers; JSON object key order is immaterial.
                actual, expected = json.loads(answer), json.loads(value)
                json.dumps(actual, allow_nan=False)
                passed = json_equal(actual, expected)
            except (ValueError, TypeError):
                passed = False
        else:
            passed = {'exact': lambda: answer.strip() == value.strip(),
                      'contains': lambda: value.casefold() in answer.casefold(),
                      'not_contains': lambda: value.casefold() not in answer.casefold()}[kind]()
        checks.append({**check, 'passed': passed})
    return {'checks': checks, 'score': round(100 * sum(c['passed'] for c in checks) / len(checks), 2) if checks and not expired else None,
            'reference_expired': expired, 'evaluated_at': at}


def validate_reference(suite):
    current = datetime.now(timezone.utc)
    for case in suite['cases']:
        if case.get('valid_until') and datetime.fromisoformat(case['valid_until']) <= current:
            raise ValueError('Reference expired for ' + case['name'] + '. Save a new suite revision with verified evidence.')
        if case.get('checked_at') and datetime.fromisoformat(case['checked_at']) > current:
            raise ValueError('Reference checked_at cannot be in the future.')


class OllamaEvaluator:
    async def complete(self, request, target, case):
        model = target['model']
        job = queue.enqueue('evaluation', 'Testing Lab: ' + case['name'], model=model)
        error = None
        queued = time.perf_counter()
        try:
            while not queue.try_start(job):
                await asyncio.sleep(.15)
            queue_seconds = time.perf_counter() - queued
            current = asyncio.current_task()
            job.cancel_callback = current.cancel
            async with asyncio.timeout(request['timeout_seconds']):
                preparing = time.perf_counter()
                await prepare_runtime('chat')
                async with httpx.AsyncClient(timeout=httpx.Timeout(1800, connect=10), trust_env=False) as client:
                    response = await client.post(settings.ollama_base_url + '/api/show', json={'model': model})
                    response.raise_for_status()
                    info = response.json()
                    lengths = [v for k, v in info.get('model_info', {}).items() if k.endswith('.context_length') and isinstance(v, int)]
                    if lengths and request['context_tokens'] > min(lengths):
                        raise ValueError('Requested context exceeds the model context. Reduce context tokens.')
                    messages = [{'role': 'system', 'content': SYSTEM}, *case['messages']]
                    if len(json.dumps(messages)) > (request['context_tokens'] - request['output_tokens'] - 256) * 2:
                        raise ValueError('Prompt exceeds the conservative context allowance. Increase context or shorten the case.')
                    options = {'num_ctx': request['context_tokens'], 'num_predict': request['output_tokens'],
                               'temperature': request['temperature'], 'seed': request['seed']}
                    async for _ in prepare_chat_model(job, model, settings.ollama_base_url, options=options):
                        pass
                    tags = await client.get(settings.ollama_base_url + '/api/tags')
                    tags.raise_for_status()
                    installed = next((m for m in tags.json().get('models', []) if canonical_model(m.get('name', '')) == canonical_model(model)), {})
                    version = await client.get(settings.ollama_base_url + '/api/version')
                    version.raise_for_status()
                    payload = {'model': model, 'messages': messages, 'stream': True, 'options': options, 'keep_alive': '5m'}
                    think = evaluation_thinking(info)
                    if think is not None:
                        payload['think'] = think
                    prepare_seconds = time.perf_counter() - preparing
                    started, first = time.perf_counter(), None
                    answer, usage, done = '', {}, False
                    async with client.stream('POST', settings.ollama_base_url + '/api/chat', json=payload) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if job.cancel_event.is_set():
                                raise QueueCancelled('Evaluation cancelled from Prompt Queue.')
                            if not line:
                                continue
                            chunk = json.loads(line)
                            if chunk.get('error'):
                                raise ValueError('Ollama could not complete the evaluation request.')
                            content = chunk.get('message', {}).get('content', '')
                            if content and first is None:
                                first = time.perf_counter() - started
                            answer += content
                            if len(answer) > 128000:
                                raise ValueError('Response exceeded 128,000 characters.')
                            if chunk.get('done'):
                                usage, done = chunk, True
                    if not done or not answer.strip():
                        raise ValueError('Model stream ended without a complete visible answer.')
                    elapsed = time.perf_counter() - started
                    duration = usage.get('eval_duration', 0) / 1e9
                    return {'response': answer, 'metrics': {'queue_seconds': queue_seconds, 'prepare_seconds': prepare_seconds,
                            'inference_seconds': elapsed, 'first_token_seconds': first,
                            'output_tokens': usage.get('eval_count'), 'input_tokens': usage.get('prompt_eval_count'),
                            'cached_input_tokens': usage.get('prompt_eval_cached_count'),
                            'provider_total_seconds': usage.get('total_duration', 0) / 1e9,
                            'provider_load_seconds': usage.get('load_duration', 0) / 1e9,
                            'provider_prompt_seconds': usage.get('prompt_eval_duration', 0) / 1e9,
                            'tokens_per_second': usage.get('eval_count', 0) / duration if duration else None,
                            'done_reason': usage.get('done_reason')},
                            'runtime': {'model_digest': installed.get('digest'), 'details': info.get('details'),
                                        'ollama_version': version.json().get('version'), 'thinking': payload.get('think')}}
        except BaseException as exc:
            error = exc
            if isinstance(exc, (asyncio.CancelledError, QueueCancelled)):
                job.cancel_event.set()
            raise
        finally:
            queue.finish(job, error=error)


class EvaluationManager:
    def __init__(self, path, provider=None):
        self.store = EvaluationStore(path)
        self.provider = provider or OllamaEvaluator()
        self.tasks = {}
        self.scheduler = None
        self.closing = False
        self.store.recover()

    def make_run(self, request):
        suite = self.store.suite(request['suite_id'])
        validate_reference(suite)
        if len(suite['cases']) * len(request['targets']) * request['repeats'] > 200:
            raise ValueError('Limit each run to 200 responses. Reduce cases, targets or repetitions.')
        from services.build_info import read_build_info
        build = read_build_info()
        cohort_settings = {k: request[k] for k in ('context_tokens', 'output_tokens', 'temperature', 'seed', 'timeout_seconds')}
        return {'id': uuid4().hex, 'suite_id': suite['id'], 'suite_name': suite['name'], 'suite_hash': suite['hash'],
                'cohort': fingerprint({'suite': suite['hash'], 'settings': cohort_settings}),
                'created_at': now(), 'status': 'queued', 'request': request, 'suite': suite, 'system': SYSTEM,
                'environment': {'os': platform.system(), 'os_release': platform.release(), 'python': platform.python_version(),
                                'build': {key: build.get(key) for key in ('build_id', 'source_commit', 'source_dirty', 'source_fingerprint')}},
                'results': [{'id': uuid4().hex, 'case_id': case['id'], 'target_index': index, 'repeat': repeat + 1,
                             'status': 'queued' if target['kind'] == 'ollama' else 'awaiting_response'}
                            for repeat in range(request['repeats']) for case in suite['cases'] for index, target in enumerate(request['targets'])]}

    def busy(self):
        return any(not task.done() for task in self.tasks.values())

    def start(self, request):
        if self.busy():
            raise ValueError('An evaluation is already running. Stop it or wait for completion.')
        run = self.store.add_run(self.make_run(request))
        self.launch(run)
        return run

    def launch(self, run):
        task = asyncio.create_task(self.execute(run['id']))
        self.tasks[run['id']] = task
        task.add_done_callback(lambda finished: self.tasks.pop(run['id'], None))

    @staticmethod
    def result(run, id):
        row = next((r for r in run['results'] if r['id'] == id), None)
        if row is None:
            raise KeyError('Response not found.')
        return row

    def finish_state(self, run):
        if run['status'] in ('cancelled', 'interrupted'):
            return
        statuses = {r['status'] for r in run['results']}
        if statuses & {'queued', 'running'}:
            run['status'] = 'running'
        else:
            run['status'] = 'awaiting_response' if 'awaiting_response' in statuses else 'completed_with_errors' if 'failed' in statuses else 'completed'
            run['finished_at'] = now()

    async def execute(self, id):
        try:
            run = self.store.mutate(id, lambda r: r.update(status='running'))
            if isinstance(self.provider, OllamaEvaluator) and any(t['kind'] == 'ollama' for t in run['request']['targets']):
                from services.capabilities import host_resources
                from services.system_stats import read_gpus
                gpus, warning = await asyncio.to_thread(read_gpus)
                self.store.mutate(id, lambda r: r['environment'].update(host=host_resources(), gpus=gpus, gpu_warning=warning))
            cases = {c['id']: c for c in run['suite']['cases']}
            for row in run['results']:
                if row['status'] != 'queued':
                    continue
                self.store.mutate(id, lambda r: self.result(r, row['id']).update(status='running', started_at=now()))
                try:
                    value = await self.provider.complete(run['request'], run['request']['targets'][row['target_index']], cases[row['case_id']])
                    value.update(status='completed', completed_at=now())
                    value['evaluation'] = evaluate(cases[row['case_id']], value['response'], value['completed_at'])
                except QueueCancelled:
                    raise asyncio.CancelledError()
                except Exception as exc:
                    value = {'status': 'failed', 'error': str(exc)[:500] or type(exc).__name__, 'completed_at': now()}
                self.store.mutate(id, lambda r: self.result(r, row['id']).update(value))
            self.store.mutate(id, self.finish_state)
        except asyncio.CancelledError:
            def stopped(run):
                run.update(status='interrupted' if self.closing else 'cancelled', finished_at=now())
                for row in run['results']:
                    if row['status'] in ('queued', 'running'):
                        row['status'] = run['status']
            self.store.mutate(id, stopped)
        except Exception:
            def failed(run):
                run.update(status='interrupted', finished_at=now(), error='Evaluation stopped unexpectedly. Completed responses were retained.')
                for row in run['results']:
                    if row['status'] in ('queued', 'running'):
                        row['status'] = 'interrupted'
            self.store.mutate(id, failed)

    async def stop(self, id):
        self.store.run(id)
        task = self.tasks.get(id)
        if task and not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            # A task cancelled before its first instruction cannot run its own cleanup.
            def stopped(run):
                if run['status'] in ('queued', 'running'):
                    run.update(status='interrupted' if self.closing else 'cancelled', finished_at=now())
                    for row in run['results']:
                        if row['status'] in ('queued', 'running'):
                            row['status'] = run['status']
            self.store.mutate(id, stopped)
        return self.store.run(id)

    def external(self, id, result_id, value):
        def patch(run):
            row = self.result(run, result_id)
            if run['request']['targets'][row['target_index']]['kind'] != 'manual':
                raise ValueError('Only manual baseline responses can be pasted.')
            if row['status'] != 'awaiting_response':
                raise ValueError('This response is already recorded. Create a new run to replace it.')
            case = next(c for c in run['suite']['cases'] if c['id'] == row['case_id'])
            row.update(**value, status='completed', completed_at=now(), provenance='manual_paste', metrics={})
            row['evaluation'] = evaluate(case, row['response'], row['completed_at'])
            self.finish_state(run)
        return self.store.mutate(id, patch)

    def review(self, id, result_id, review):
        def patch(run):
            row = self.result(run, result_id)
            if row['status'] != 'completed':
                raise ValueError('Review a completed response.')
            row['review'] = {**review, 'reviewed_at': now()}
        return self.store.mutate(id, patch)

    def schedule(self, value):
        if len([s for s in self.store.schedules() if s['enabled']]) >= 10:
            raise ValueError('Limit active schedules to ten.')
        run = self.make_run(value['request'])  # Validate before saving; no inference here.
        return self.store.put_schedule({'id': uuid4().hex, **value, 'suite_name': run['suite_name'], 'enabled': True,
                                       'created_at': now(), 'next_due': now(), 'runs_started': 0, 'last_error': None})

    def disable_schedule(self, id):
        schedule = next((s for s in self.store.schedules() if s['id'] == id), None)
        if not schedule:
            raise KeyError('Schedule not found.')
        schedule['enabled'] = False
        return self.store.put_schedule(schedule)

    def tick(self):
        from services.maintenance_gate import gate
        if self.busy() or self.closing or gate.blocked():
            return
        for schedule in reversed(self.store.schedules()):
            if not schedule['enabled'] or datetime.fromisoformat(schedule['next_due']) > datetime.now(timezone.utc):
                continue
            try:
                request = RunRequest.model_validate(schedule['request']).model_dump(mode='json')
                run = self.make_run(request)
            except (ValueError, KeyError) as exc:
                schedule.update(enabled=False, last_error=str(exc))
                self.store.put_schedule(schedule)
                continue
            schedule['runs_started'] += 1
            schedule['enabled'] = schedule['runs_started'] < schedule['max_runs']
            schedule['next_due'] = (datetime.now(timezone.utc) + timedelta(hours=schedule['interval_hours'])).isoformat()
            schedule['last_run_id'] = run['id']
            if self.store.claim_schedule(schedule, run):
                self.launch(run)
            break

    async def startup(self):
        if self.scheduler and not self.scheduler.done():
            return
        self.closing = False
        async def loop():
            while True:
                try:
                    self.tick()
                except Exception:
                    from services.app_logging import get_logger
                    get_logger('evaluations').exception('Evaluation scheduler could not check due runs')
                await asyncio.sleep(30)
        self.scheduler = asyncio.create_task(loop())

    async def close(self):
        self.closing = True
        if self.scheduler:
            self.scheduler.cancel()
            with suppress(asyncio.CancelledError):
                await self.scheduler
            self.scheduler = None
        for id in list(self.tasks):
            await self.stop(id)


_manager = None


def manager():
    global _manager
    if _manager is None:
        _manager = EvaluationManager(settings.data_dir / 'evaluations' / 'history.sqlite3')
    return _manager


def is_busy():
    return bool(_manager and _manager.busy())
