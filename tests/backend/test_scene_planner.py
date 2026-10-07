import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.gpu_coordination import GpuCoordinator
from services.request_queue import RequestQueue, QueueCancelled
from services.image_workflows import scene_planner as planner, store
from services.image_workflows.contracts import UpdateRequest
from services.image_workflows.scene_state import SceneState


def result():
    return {'summary': 'Turn the wrist and advance the screw slightly', 'actions': [
        {'description': 'Turn the wrist', 'changes': {'body': {'wrist_rotation': 'slightly clockwise'}}},
        {'description': 'Advance the screw', 'changes': {'objects': [{'id': 'screw', 'progression': '70% inserted'}]}},
    ], 'uncertainties': ['Exact rotation angle was not specified']}


@pytest.fixture
def scene(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'ROOT', tmp_path / 'workflows')
    monkeypatch.setattr(planner, 'queue', RequestQueue(GpuCoordinator()))
    workflow = store.create('Neutral test scene', 'scene')
    workflow.scene.model_id = 'local-image-model'
    workflow.scene.state = SceneState(character={'name': 'Test character', 'profile_id': 'a'*32, 'clothing': 'blue shirt'},
        environment={'location':'workbench'}, body={'right_hand':'gripping screwdriver'},
        objects=[{'id':'screw','name':'screw','progression':'50% inserted'}, {'id':'driver','name':'screwdriver'}])
    return store.update(workflow.id, UpdateRequest.model_validate({key:value for key,value in workflow.model_dump().items() if key in UpdateRequest.model_fields}))


def save_plan(scene, proposal=None, plan_id='b'*32):
    plan = planner.SavedPlan(id=plan_id, workflow_id=scene.id, revision=scene.revision, created_at=store._now(),
        intention='Turn the wrist slightly', model='local-text', base_state=scene.scene.state,
        proposal=planner.parse(json.dumps(proposal or result()), scene.scene.state))
    store._write(planner.plan_path(scene.id, plan_id), plan.model_dump())
    return plan


def test_partial_actions_preserve_identity_settings_and_unselected_objects(scene):
    plan = save_plan(scene)
    before = scene.model_dump()
    changed = planner.apply(scene.id, plan.id, planner.ApplyRequest(revision=scene.revision, selected_actions=[0]))
    assert changed.scene.state.body.wrist_rotation == 'slightly clockwise'
    assert changed.scene.state.body.right_hand == 'gripping screwdriver'
    assert changed.scene.state.character == scene.scene.state.character
    assert changed.scene.state.objects == scene.scene.state.objects
    assert changed.scene.model_id == scene.scene.model_id
    assert changed.prompt_settings.seed == scene.prompt_settings.seed
    assert scene.model_dump() == before
    assert changed.revision == scene.revision + 1
    assert 'slightly clockwise' in changed.prompt_settings.prompt


def test_selection_is_applied_in_proposal_order(scene):
    proposal=result(); proposal['actions'][1]['changes']={'body':{'wrist_rotation':'further clockwise'}}
    plan=save_plan(scene,proposal)
    changed=planner.apply(scene.id,plan.id,planner.ApplyRequest(revision=scene.revision,selected_actions=[1,0]))
    assert changed.scene.state.body.wrist_rotation == 'further clockwise'


@pytest.mark.parametrize('selection', [[0,0], [7]])
def test_invalid_selection_is_atomic(scene, selection):
    plan=save_plan(scene)
    with pytest.raises(ValueError): planner.apply(scene.id,plan.id,planner.ApplyRequest(revision=scene.revision,selected_actions=selection))
    assert store.get(scene.id) == scene


def test_applied_or_edited_plans_cannot_overwrite_newer_state(scene):
    plan=save_plan(scene)
    changed=planner.apply(scene.id,plan.id,planner.ApplyRequest(revision=scene.revision,selected_actions=[0]))
    with pytest.raises(store.Conflict): planner.apply(scene.id,plan.id,planner.ApplyRequest(revision=changed.revision,selected_actions=[1]))
    assert store.get(scene.id) == changed


@pytest.mark.parametrize('changes', [
    {'character':{'profile_id':'c'*32}}, {'character':{'name':'invented name'}},
    {'source_asset_id':'a'*64}, {'model_id':'unapproved'}, {'body':{'unknown':'value'}},
    {'body':{'stance':'x'*401}}, {'objects':[{'id':'../escape','name':'bad'}]}, {},
])
def test_model_cannot_escalate_beyond_visible_changes(scene,changes):
    proposal=result();proposal['actions']=[{'description':'bad action','changes':changes}]
    with pytest.raises(ValueError): planner.parse(json.dumps(proposal),scene.scene.state)
    assert store.get(scene.id)==scene


def test_object_updates_additions_and_explicit_removals(scene):
    proposal=result();proposal['actions']=[{'description':'Replace driver with a small brush',
        'changes':{'objects':[{'id':'brush','name':'brush','position':'on bench'}]},'remove_objects':['driver']}]
    plan=save_plan(scene,proposal)
    changed=planner.apply(scene.id,plan.id,planner.ApplyRequest(revision=scene.revision,selected_actions=[0]))
    assert [obj.id for obj in changed.scene.state.objects]==['screw','brush']
    assert changed.scene.state.objects[0] == scene.scene.state.objects[0]


def test_dependent_selection_failure_preserves_scene(scene):
    proposal=result();proposal['actions']=[
        {'description':'Add brush','changes':{'objects':[{'id':'brush','name':'brush'}]}},
        {'description':'Remove brush','remove_objects':['brush']}]
    plan=save_plan(scene,proposal)
    with pytest.raises(ValueError): planner.apply(scene.id,plan.id,planner.ApplyRequest(revision=scene.revision,selected_actions=[1]))
    assert store.get(scene.id)==scene


def test_saved_proposals_reopen_without_inference(scene):
    plan=save_plan(scene)
    assert planner.get(scene.id,plan.id)==plan
    assert planner.list_plans(scene.id)['plans']==[plan]
    assert store.get(scene.id)==scene


def test_cross_scene_and_corrupt_proposals_fail_closed(scene):
    plan=save_plan(scene)
    other=store.create('Other scene','scene')
    with pytest.raises(store.NotFound): planner.get(other.id,plan.id)
    path=planner.plan_path(scene.id,plan.id); path.write_text('{damaged')
    with pytest.raises(store.Conflict): planner.get(scene.id,plan.id)
    assert path.read_text()=='{damaged'
    with pytest.raises(store.NotFound): planner.plan_path(scene.id,'../escape')


def request(scene, request_id='d'*32):
    return planner.PlanRequest(revision=scene.revision,request_id=request_id,intention='Turn the wrist slightly',model='local-text')


def fake_runtime(monkeypatch, infer):
    async def park(kind): assert kind=='analysis'
    monkeypatch.setattr(planner,'prepare_runtime',park)
    monkeypatch.setattr(planner,'infer',infer)


def test_queued_planning_persists_only_proposal_and_releases_gpu(scene,monkeypatch):
    async def infer(job,body,state):
        assert planner.queue.active is job
        return planner.parse(json.dumps(result()),state)
    fake_runtime(monkeypatch,infer)
    plan=asyncio.run(planner.propose(scene.id,request(scene)))
    assert planner.get(scene.id,plan.id)==plan
    assert store.get(scene.id)==scene
    assert planner.queue.jobs[-1].status=='completed'
    assert planner.queue.coordinator.current_owner() is None


def test_concurrent_scene_edit_rejects_proposal_without_overwrite(scene,monkeypatch):
    async def infer(job,body,state):
        store.update(scene.id,UpdateRequest.model_validate({key:value for key,value in scene.model_dump().items() if key in UpdateRequest.model_fields}))
        return planner.parse(json.dumps(result()),state)
    fake_runtime(monkeypatch,infer)
    with pytest.raises(store.Conflict): asyncio.run(planner.propose(scene.id,request(scene)))
    assert not planner.plan_path(scene.id,'d'*32).exists()
    assert store.get(scene.id).revision==scene.revision+1
    assert planner.queue.coordinator.current_owner() is None


def test_cancel_running_planner_releases_lease_and_never_saves(scene,monkeypatch):
    entered=asyncio.Event()
    async def infer(job,body,state):
        entered.set();await asyncio.sleep(30)
    fake_runtime(monkeypatch,infer)
    async def run():
        task=asyncio.create_task(planner.propose(scene.id,request(scene)))
        await asyncio.wait_for(entered.wait(),1)
        assert (await planner.stop(scene.id,'d'*32))['stopped']
        with pytest.raises(QueueCancelled): await task
    asyncio.run(run())
    assert store.get(scene.id)==scene
    assert not planner.plan_path(scene.id,'d'*32).exists()
    assert planner.queue.jobs[-1].status=='cancelled'
    assert planner.queue.coordinator.current_owner() is None


def test_cancel_queued_plan_does_not_run_provider(scene,monkeypatch):
    planner.queue.paused=True
    async def infer(*args): pytest.fail('Cancelled queued plan must not run inference')
    fake_runtime(monkeypatch,infer)
    async def run():
        task=asyncio.create_task(planner.propose(scene.id,request(scene)))
        for _ in range(100):
            if planner.queue.jobs: break
            await asyncio.sleep(.01)
        await planner.stop(scene.id,'d'*32)
        with pytest.raises(QueueCancelled): await task
    asyncio.run(run())
    assert store.get(scene.id)==scene
    assert planner.queue.coordinator.current_owner() is None


def test_cancel_during_cpu_parking_retains_lease_until_parking_finishes(scene,monkeypatch):
    entered=asyncio.Event();finish=asyncio.Event()
    async def park(kind):entered.set();await finish.wait()
    async def infer(*args):pytest.fail('Cancelled plan must not run inference')
    fake_runtime(monkeypatch,infer);monkeypatch.setattr(planner,'prepare_runtime',park)
    async def run():
        task=asyncio.create_task(planner.propose(scene.id,request(scene)))
        await asyncio.wait_for(entered.wait(),1)
        await planner.stop(scene.id,'d'*32)
        assert planner.queue.coordinator.current_owner() is not None
        finish.set()
        with pytest.raises(QueueCancelled):await task
        assert planner.queue.coordinator.current_owner() is None
    asyncio.run(run())
    assert store.get(scene.id)==scene


def test_failed_proposal_storage_does_not_change_scene(scene,monkeypatch):
    async def infer(job,body,state):return planner.parse(json.dumps(result()),state)
    fake_runtime(monkeypatch,infer)
    monkeypatch.setattr(store,'_write',lambda *args: (_ for _ in ()).throw(OSError('disk full')))
    with pytest.raises(OSError):asyncio.run(planner.propose(scene.id,request(scene)))
    assert store.get(scene.id)==scene
    assert planner.queue.jobs[-1].status=='failed'
    assert planner.queue.coordinator.current_owner() is None


def test_failed_apply_storage_preserves_saved_scene(scene,monkeypatch):
    plan=save_plan(scene)
    monkeypatch.setattr(store,'_write',lambda *args: (_ for _ in ()).throw(OSError('disk full')))
    with pytest.raises(OSError):planner.apply(scene.id,plan.id,planner.ApplyRequest(revision=scene.revision,selected_actions=[0]))
    assert store.get(scene.id)==scene


def test_streaming_request_is_structured_and_omits_identity_and_image_data(scene,monkeypatch):
    original_client=httpx.AsyncClient
    async def ready(*args,**kwargs):yield {}
    monkeypatch.setattr(planner,'prepare_chat_model',ready)
    monkeypatch.setattr(planner,'settings',SimpleNamespace(num_ctx=16384,ollama_base_url='http://127.0.0.1:11434',ollama_keep_alive_seconds=300))
    def respond(req):
        payload=json.loads(req.content)
        assert payload['format']['properties']['actions']
        assert payload['keep_alive']==300 and payload['think'] is False
        assert 'tools' not in payload
        visible=json.loads(payload['messages'][1]['content'])['current_scene']
        assert 'name' not in visible['character'] and 'profile_id' not in visible['character']
        assert all('images' not in message for message in payload['messages'])
        return httpx.Response(200,content=json.dumps({'message':{'content':json.dumps(result())},'done':True}))
    monkeypatch.setattr(planner.httpx,'AsyncClient',lambda **kwargs: original_client(transport=httpx.MockTransport(respond),**kwargs))
    job=planner.queue.enqueue('analysis','test')
    proposal=asyncio.run(planner.infer(job,request(scene),scene.scene.state))
    assert len(proposal.actions)==2


def test_router_review_and_stale_response(scene):
    from routes.image_workflows import router
    plan=save_plan(scene)
    app=FastAPI();app.include_router(router)
    with TestClient(app) as client:
        assert client.get(f'/image-workflows/{scene.id}/scene/plans').json()['plans'][0]['id']==plan.id
        url=f'/image-workflows/{scene.id}/scene/plans/{plan.id}/apply'
        response=client.post(url,json={'revision':scene.revision,'selected_actions':[0]})
        assert response.status_code==200
        assert client.post(url,json={'revision':response.json()['revision'],'selected_actions':[1]}).status_code==409


@pytest.mark.parametrize('events', [
    [{'message':{'content':'{'},'done':False}],
    [{'message':{'content':'{}'},'done':True,'done_reason':'length'}],
    [{'error':'provider failure'}], [None],
])
def test_bad_or_truncated_model_stream_is_rejected(scene,monkeypatch,events):
    original_client=httpx.AsyncClient
    async def ready(*args,**kwargs): yield {}
    monkeypatch.setattr(planner,'prepare_chat_model',ready)
    monkeypatch.setattr(planner,'settings',SimpleNamespace(num_ctx=16384,ollama_base_url='http://127.0.0.1:11434',ollama_keep_alive_seconds=300))
    def respond(req):return httpx.Response(200,content='\n'.join(json.dumps(event) for event in events))
    monkeypatch.setattr(planner.httpx,'AsyncClient',lambda **kwargs: original_client(transport=httpx.MockTransport(respond),**kwargs))
    job=planner.queue.enqueue('analysis','test')
    with pytest.raises(ValueError): asyncio.run(planner.infer(job,request(scene),scene.scene.state))
