import asyncio
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from routes import image_generation as routes
from services.image_generation import ImageGenerationManager
from services.image_tasks import ImageTasks
from services.request_queue import RequestQueue
from services.gpu_coordination import GpuCoordinator
from services import session_store


@pytest.mark.parametrize('changes', [{'request_id':''},{'request_id':'../other'},{'session_id':'chat/other'},{'prompt':'  '},{'model_id':''}])
def test_generation_rejects_invalid_identity_and_empty_selection(changes):
    with pytest.raises(ValidationError):
        routes.ImageGenerationRequest(**{'model_id':'fixture','prompt':'Neutral fixture',**changes})


def test_duplicate_live_generate_returns_conflict_without_damaging_original(monkeypatch):
    queue=RequestQueue(GpuCoordinator())
    original=queue.enqueue('image','original','same')
    monkeypatch.setattr(routes,'queue',queue)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.generate_image(routes.ImageGenerationRequest(model_id='fixture',prompt='Neutral',request_id='same'),object()))
    assert error.value.status_code == 409
    assert original.status == 'queued' and not original.cancel_event.is_set()
    assert len(queue.jobs) == 1


def test_snapshot_ordering_preserves_conditional_idle_reads_and_restart_identity(monkeypatch):
    async def scenario():
        tasks=ImageTasks()
        monkeypatch.setattr(routes,'image_tasks',tasks)
        app=FastAPI();app.include_router(routes.router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='http://test') as client:
            first=await client.get('/image-generation/tasks?client_id=window')
            assert first.headers['etag'].startswith('W/')
            second=await client.get('/image-generation/tasks?client_id=window')
            assert second.json()['snapshot_sequence'] > first.json()['snapshot_sequence']
            assert second.json()['backend_id'] == first.json()['backend_id']
            cached=await client.get('/image-generation/tasks?client_id=window',headers={'If-None-Match':first.headers['etag']})
            assert cached.status_code == 304 and cached.headers['cache-control'] == 'no-store'
            monkeypatch.setattr(routes,'image_tasks',ImageTasks())
            restarted=await client.get('/image-generation/tasks?client_id=window',headers={'If-None-Match':first.headers['etag']})
            assert restarted.status_code == 200
            assert restarted.json()['backend_id'] != first.json()['backend_id']
    asyncio.run(scenario())


@pytest.mark.parametrize('filename',['../image.png','folder\\image.png','C:image.png'])
def test_output_route_rejects_aliases_and_windows_path_syntax(filename):
    with pytest.raises(HTTPException) as error:
        routes.get_generated_image(filename)
    assert error.value.status_code == 404


def test_broken_hooks_cannot_leave_a_reusable_pipeline(monkeypatch):
    manager=ImageGenerationManager()
    def broken(): raise RuntimeError('Hook cleanup failed')
    manager._pipeline=manager._active_pipeline=SimpleNamespace(remove_all_hooks=broken)
    manager._model_id='old';manager._lora_id='old-adapter';manager._compel=object()
    manager._workflow_pipelines['img2img']=object()
    manager._unload()
    assert manager._pipeline is None and manager._active_pipeline is None
    assert manager._model_id is None and manager._lora_id is None and manager._compel is None
    assert not manager._workflow_pipelines


@pytest.mark.parametrize('phase',['prepare','infer','cleanup'])
def test_workflow_failure_discards_shared_runtime(monkeypatch,phase):
    manager=ImageGenerationManager();calls=[]
    def cleanup():
        if phase == 'cleanup': raise RuntimeError('cleanup failed')
    pipeline=SimpleNamespace(remove_all_hooks=lambda:calls.append('detach'),maybe_free_model_hooks=cleanup)
    manager._pipeline=manager._active_pipeline=pipeline;manager._model_id='fixture'
    def load(_):
        if phase == 'prepare': raise RuntimeError('prepare failed')
    monkeypatch.setattr(manager,'_load',load)
    monkeypatch.setattr(manager,'_configure_wait_mode',lambda _:None)
    context=SimpleNamespace(check_cancelled=lambda:None)
    with pytest.raises(RuntimeError):
        with manager.workflow_pipeline({'id':'fixture'},'txt2img',context):
            if phase == 'infer': raise RuntimeError('inference failed')
    assert manager._pipeline is None and manager._model_id is None
    assert calls == ['detach']


def test_stop_during_prequeue_preparation_is_carried_to_the_backend_client(monkeypatch):
    async def scenario():
        monkeypatch.setattr(session_store,'append_messages',lambda *args:{'id':'chat'})
        tasks=ImageTasks();started=asyncio.Event();resume=asyncio.Event()
        async def execute(values):
            client=routes.BackendImageClient(values['_cancellation_event'])
            started.set();await resume.wait()
            assert await client.is_disconnected()
            raise HTTPException(499,'Stopped before queue admission')
        request={'request_id':'early','session_id':'chat','prompt':'Neutral fixture'}
        await tasks.submit('window',[request],None,None,execute)
        await started.wait()
        worker=tasks.tasks['early'].worker
        assert tasks.cancel('early')
        resume.set();await worker
        assert tasks.tasks['early'].status == 'cancelled'
        assert tasks.tasks['early'].request == request
        assert not await routes.BackendImageClient().is_disconnected()
    asyncio.run(scenario())
