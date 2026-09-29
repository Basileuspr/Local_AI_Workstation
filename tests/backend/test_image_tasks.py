import asyncio

import pytest
from types import SimpleNamespace

from services.image_tasks import ImageTasks
from services import session_store


def test_task_snapshot_tracks_live_steps_saving_and_persisted_completion(monkeypatch):
    from routes import image_generation as routes
    from services.request_queue import RequestQueue
    from services.image_tasks import ImageTask
    queue = RequestQueue()
    tasks = ImageTasks()
    task = ImageTask('window', {'request_id':'first','session_id':'chat','prompt':'Forest'}, 'batch', 0, 2, status='running')
    tasks.tasks['first'] = task
    job = queue.enqueue('image','Image 1 of 2','first')
    job.status = 'running'
    measured = {'phase':'Generating image','step':1,'total_steps':4,'elapsed_seconds':20,'estimated_remaining_seconds':30}
    monkeypatch.setattr(routes,'queue',queue)
    monkeypatch.setattr(routes,'image_tasks',tasks)
    monkeypatch.setattr(routes,'manager',SimpleNamespace(generation_progress=lambda _: measured))
    snapshot = lambda: asyncio.run(routes.image_task_snapshot('window'))['tasks'][0]
    assert snapshot()['progress'] == measured
    job.stage = 'saving'
    assert snapshot()['status'] == 'saving'
    job.status = 'completed'
    assert snapshot()['status'] == 'saving'  # Chat persistence still owns completion.
    task.result = {'url':'/saved.png'}
    task.status = 'completed'
    assert snapshot()['status'] == 'completed'
    assert snapshot()['result']['url'] == '/saved.png'


def test_detached_batch_survives_observer_disconnect_and_saves_once(monkeypatch):
    async def scenario():
        appended = []
        monkeypatch.setattr(session_store, 'append_messages', lambda session, messages, model: appended.extend(messages) or {'id':session})
        tasks = ImageTasks()
        gates = {name:asyncio.Event() for name in ('first','second')}
        started = []
        async def execute(request):
            started.append(request['request_id'])
            await gates[request['request_id']].wait()
            return {'filename':request['request_id']+'.png','image_ref':'blob:test','data_url':'large','seed':0}
        requests = [{'request_id':name,'session_id':'source-chat','prompt':'Forest'} for name in gates]
        await tasks.submit('window',requests,'batch','chat-model',execute)
        await asyncio.sleep(0)
        # Losing/cancelling an observer has no ownership of the generation task.
        async def observer():
            await asyncio.sleep(10)
        watcher = asyncio.create_task(observer()); watcher.cancel()
        with pytest.raises(asyncio.CancelledError): await watcher
        await tasks.submit('window',requests,'batch','chat-model',execute)
        assert started == ['first','second']
        assert tasks.snapshot('other-window') == []
        gates['second'].set()
        await tasks.tasks['second'].worker
        snapshot = tasks.snapshot('window')
        assert [task['status'] for task in snapshot] == ['running','completed']
        assert snapshot[1]['batch_index'] == 1
        result = snapshot[1]['result']
        assert result['url'].startswith('/sessions/source-chat/images/by-id/')
        assert result['seed'] == 0
        assert 'data_url' not in result and 'image_ref' not in result
        gates['first'].set()
        await tasks.tasks['first'].worker
        assert len([message for message in appended if message['role'] == 'assistant']) == 2
        assert len([message for message in appended if message['role'] == 'user']) == 2
    asyncio.run(scenario())


def test_explicit_stop_and_failed_generation_are_retained(monkeypatch):
    async def scenario():
        monkeypatch.setattr(session_store, 'append_messages', lambda *args: {'id':'chat'})
        tasks = ImageTasks()
        async def execute(request):
            raise RuntimeError('Inference failed')
        requests = [{'request_id':name,'session_id':'chat','prompt':'Forest'} for name in ('stop','failure')]
        await tasks.submit('window',requests,'batch',None,execute)
        assert tasks.cancel('stop')
        await asyncio.gather(*(task.worker for task in tasks.tasks.values()))
        assert [task['status'] for task in tasks.snapshot('window')] == ['cancelled','failed']
        assert tasks.snapshot('window')[1]['error'] == 'Inference failed'
    asyncio.run(scenario())


def test_concurrent_retry_does_not_duplicate_or_overwrite_submission(monkeypatch):
    async def scenario():
        messages = []
        monkeypatch.setattr(session_store, 'append_messages', lambda session, items, model: messages.extend(items) or {'id':session})
        tasks = ImageTasks(); gate = asyncio.Event()
        async def execute(request):
            await gate.wait()
            return {'filename':'image.png','image_ref':'blob:test'}
        requests = [{'request_id':'one','session_id':'chat','prompt':'Original'}]
        await asyncio.gather(*(tasks.submit('window',requests,None,None,execute) for _ in range(2)))
        with pytest.raises(ValueError, match='another submission'):
            await tasks.submit('window',[{**requests[0],'prompt':'Changed'}],None,None,execute)
        assert len(messages) == 1 and messages[0]['content'].endswith('Original')
        gate.set(); await tasks.tasks['one'].worker
        assert len(messages) == 2
    asyncio.run(scenario())


def test_http_submission_returns_before_completion_and_new_client_recovers(monkeypatch):
    import httpx
    from fastapi import FastAPI
    from routes import image_generation as routes

    async def scenario():
        tasks = ImageTasks(); release = asyncio.Event()
        monkeypatch.setattr(routes, 'image_tasks', tasks)
        monkeypatch.setattr(session_store, 'append_messages', lambda *args: {'id':'chat'})
        async def execute(request):
            await release.wait()
            return {'filename':'image.png','image_ref':'blob:fixture','seed':123}
        monkeypatch.setattr(routes, 'execute_saved_image', execute)
        app = FastAPI(); app.include_router(routes.router)
        body = {'client_id':'window','batch_id':'batch','requests':[
            {'request_id':name,'session_id':'chat','model_id':'fixture','prompt':'Forest'} for name in ('first','second')]}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='http://test') as client:
            response = await client.post('/image-generation/tasks',json=body)
            assert response.status_code == 200
            assert len(response.json()['tasks']) == 2
        # Discarding the submitting HTTP client does not own/cancel the workers.
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='http://test') as refreshed:
            response = await refreshed.get('/image-generation/tasks',params={'client_id':'window'})
            assert [task['request_id'] for task in response.json()['tasks']] == ['first','second']
            assert all(task['status'] in {'queued','running'} for task in response.json()['tasks'])
            workers = [task.worker for task in tasks.tasks.values()]
            release.set(); await asyncio.gather(*workers)
            response = await refreshed.get('/image-generation/tasks',params={'client_id':'window'})
            assert all(task['status'] == 'completed' for task in response.json()['tasks'])
            assert all(task['result']['url'].startswith('/sessions/chat/images/by-id/') for task in response.json()['tasks'])
    asyncio.run(scenario())
