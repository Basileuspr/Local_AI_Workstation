import hashlib
import asyncio
import io
import json
from pathlib import Path
from dataclasses import replace

import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import review_workflow as workflow, image_library as library, image_manager, visual_review, image_vault, review_metadata
from routes.review_workflow import router


@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(library,'ROOT',tmp_path/'data'/'library')
    monkeypatch.setattr(visual_review,'ROOT',tmp_path/'data'/'review')
    monkeypatch.setattr(image_vault,'ROOT',tmp_path/'data'/'vault')
    manager=image_manager.ImageManager(tmp_path/'data'/'manager')
    monkeypatch.setattr(image_manager,'manager',manager)
    monkeypatch.setattr(workflow,'manager',manager)
    monkeypatch.setattr(workflow,'settings',replace(workflow.settings,data_dir=tmp_path/'data',models_dir=tmp_path/'models'))


def picture(color='red'):
    output=io.BytesIO(); Image.new('RGB',(16,12),color).save(output,'PNG'); return output.getvalue()


def owned(color='red'):
    value=library.import_image(picture(color),'test.png',{'kind':'review','seed':42})
    identifier='library:'+value['id']
    workflow.patch(identifier,{'review_status':'reviewed','category':'Portrait','project':'Fixture','tags':['Keep'],'caption':'Neutral notes','favorite':True})
    return identifier


def preset(tmp_path):
    return workflow.set_preset('0',str(tmp_path/'organized'))


def test_neutral_review_is_separate_from_rating_and_favorite():
    value=review_metadata.patch({'rating':'liked','favorite':True},{'review_status':'reviewed'})
    assert value['rating'] is None and value['favorite'] and value['review_status']=='reviewed'
    assert review_metadata.patch(value,{'caption':'changed'})['review_status']=='reviewed'
    assert review_metadata.patch(value,{'rating':None})['review_status']=='unreviewed'
    with pytest.raises(ValueError): review_metadata.patch(value,{'review_status':'reviewed','rating':'liked'})


def test_move_preserves_id_bytes_metadata_and_undo(tmp_path):
    identifier=owned(); before=workflow.media(identifier); preset(tmp_path)
    plan=workflow.prepare([identifier],'move','0')
    assert not (tmp_path/'organized').exists()
    workflow.patch(identifier,{'caption':'Edited after planning'})
    done=workflow.apply(plan['id'],True)
    assert done['status']=='complete',done
    after=workflow.media(identifier)
    assert after['media_id']==identifier and after['file_state']=='present'
    assert after['caption']=='Edited after planning' and after['project']=='Fixture'
    assert after['metadata']['origin']==before['metadata']['origin']
    assert not Path(before['path']).exists()
    raw,_=library.image_bytes(identifier.split(':')[1]); assert raw==picture()
    sidecar=json.loads(Path(after['path']+'.review.json').read_text())
    assert sidecar['media_id']==identifier and sidecar['caption']=='Edited after planning'
    undone=workflow.undo(plan['id'],True); assert undone['status']=='undone'
    assert workflow.media(identifier)['path']==before['path']
    assert Path(before['path']).read_bytes()==picture()


def test_copy_collision_rename_skip_and_original_retained(tmp_path):
    identifier=owned(); before=workflow.media(identifier); preset(tmp_path)
    destination=tmp_path/'organized'; destination.mkdir(); (destination/'test.png').write_bytes(b'existing')
    plan=workflow.prepare([identifier],'copy','0'); assert plan['entries'][0]['target'].endswith('test (1).png')
    done=workflow.apply(plan['id'],True); assert done['status']=='complete'
    copied=workflow.media(done['entries'][0]['copy_media_id'])
    assert copied['caption']==before['caption'] and copied['review_status']=='reviewed'
    assert copied['metadata']['origin']==before['metadata']['origin']
    assert copied['metadata']['source_media_id']==identifier
    workflow.patch(copied['media_id'],{'caption':'Independent copy notes'})
    assert workflow.media(identifier)['caption']==before['caption']
    assert workflow.media(identifier)['path']==before['path']
    assert (destination/'test.png').read_bytes()==b'existing'
    plan=workflow.prepare([identifier],'copy','0','skip'); assert plan['entries'][0]['status']=='skip'


def test_plan_is_single_use_and_coordinator_requires_exact_approval(tmp_path):
    identifier=owned(); preset(tmp_path); plan=workflow.prepare([identifier],'copy','0')
    with pytest.raises(ValueError): workflow.apply(plan['id'])
    with pytest.raises(ValueError): workflow.coordinator_transfer('copy',plan['id'],'0')
    workflow.approve(plan['id'])
    with pytest.raises(ValueError): workflow.coordinator_transfer('move',plan['id'],'0')
    with pytest.raises(ValueError): workflow.coordinator_transfer('copy',plan['id'],'1')
    assert workflow.coordinator_transfer('copy',plan['id'],'0')['status']=='complete'
    with pytest.raises(ValueError): workflow.coordinator_transfer('copy',plan['id'],'0')


@pytest.mark.parametrize('change',['source','target','preset'])
def test_revalidate_all_files_before_any_transfer(tmp_path,change):
    ids=[owned(),owned('blue')]; preset(tmp_path); plan=workflow.prepare(ids,'move','0')
    if change=='source': Path(plan['entries'][1]['source']).write_bytes(picture('green'))
    elif change=='target':
        target=Path(plan['entries'][1]['target']); target.parent.mkdir(); target.write_bytes(b'occupied')
    else: workflow.set_preset('0',str(tmp_path/'elsewhere'))
    with pytest.raises(ValueError): workflow.apply(plan['id'],True)
    assert Path(plan['entries'][0]['source']).exists()
    assert not Path(plan['entries'][0]['target']).exists()


def test_interrupted_move_retains_verified_copy_and_receipt(tmp_path,monkeypatch):
    identifier=owned(); preset(tmp_path); plan=workflow.prepare([identifier],'move','0')
    def failure(*args): raise ValueError('Catalog is unavailable')
    monkeypatch.setattr(workflow,'bind',failure)
    done=workflow.apply(plan['id'],True)
    assert done['status']=='interrupted' and done['entries'][0]['status']=='verified copy; source retained'
    assert Path(done['entries'][0]['source']).exists() and Path(done['entries'][0]['target']).read_bytes()==picture()
    with pytest.raises(ValueError): workflow.apply(plan['id'],True)


def test_recovery_requires_fingerprint_preserves_metadata_and_forget_keeps_files(tmp_path):
    identifier=owned(); before=workflow.media(identifier)
    external=tmp_path/'recovered.png'; Path(before['path']).rename(external)
    wrong=tmp_path/'wrong.png'; wrong.write_bytes(picture('blue'))
    with pytest.raises(ValueError): workflow.locate(identifier,str(wrong))
    result=workflow.locate(identifier,str(external))
    assert result['media_id']==identifier and result['tags']==['Keep'] and result['caption']=='Neutral notes'
    with pytest.raises(ValueError): workflow.forget(identifier)
    external.rename(tmp_path/'again.png')
    assert workflow.forget(identifier)['physical_file_deleted'] is False
    assert (tmp_path/'again.png').exists() and workflow.media(identifier)['caption']=='Neutral notes'
    assert workflow.listing()['total']==0


def test_undo_refuses_changed_output_or_occupied_original(tmp_path):
    identifier=owned(); preset(tmp_path); plan=workflow.prepare([identifier],'move','0'); done=workflow.apply(plan['id'],True)
    entry=done['entries'][0]; Path(entry['source']).write_bytes(b'occupied')
    with pytest.raises(ValueError): workflow.undo(plan['id'],True)
    assert Path(entry['target']).read_bytes()==picture()


def test_registered_videos_share_review_but_paths_are_isolated():
    visual_review.register('media-manager','video','clip.mp4',hashlib.sha256(picture()).hexdigest())
    identifier='media-manager:video'; workflow.patch(identifier,{'review_status':'reviewed','project':'Video','tags':['Trip']})
    item=workflow.listing('media-manager')['items'][0]
    assert item['media_type']=='video' and item['file_state']=='unchecked' and item['path'] is None
    assert item['review_status']=='reviewed' and item['project']=='Video'
    with pytest.raises(ValueError): workflow.prepare([identifier],'move','0')


def test_suggestions_are_separate_editable_and_merge_existing_tags():
    identifier=owned(); current=workflow.media(identifier)
    workflow.put('suggestion',identifier,{'id':identifier,'fingerprint':current['metadata']['sha256'],'fields':{'caption':'Suggestion','tags':['New'],'category':'Scene'},'status':'suggested'})
    assert workflow.media(identifier)['caption']=='Neutral notes'
    workflow.resolve_suggestions(identifier,'ignore'); assert workflow.media(identifier)['caption']=='Neutral notes'
    workflow.resolve_suggestions(identifier,'accept')
    assert workflow.media(identifier)['tags']==['Keep','New'] and workflow.media(identifier)['review_status']=='reviewed'


def test_coordinator_schemas_reject_paths_approval_and_unknown_arguments():
    app=FastAPI(); app.include_router(router); client=TestClient(app)
    for route,body in [('/coordinator/move',{'reviewed_plan_id':'x','destination_preset_id':'0','path':'C:/elsewhere'}),('/coordinator/copy',{'reviewed_plan_id':'x','destination_preset_id':'0','confirmed':True}),('/coordinator/add_tag',{'media_id':'library:x','tag':'Keep','command':'delete'}),('/apply',{'reviewed_plan_id':'x','confirmed':False})]:
        assert client.post('/visual-review/workflow'+route,json=body).status_code==422


def test_presets_reject_protected_paths_links_and_relative_paths(tmp_path):
    for path in [str(workflow.settings.data_dir/'output'),str(workflow.settings.models_dir/'output'),'relative/output']:
        with pytest.raises(ValueError): workflow.set_preset('0',path)


def test_image_manager_move_and_external_recovery_preserve_id(tmp_path):
    root=tmp_path/'photos'; root.mkdir(); original=root/'one.png'; original.write_bytes(picture())
    folder=workflow.manager.add_folder(str(root)); workflow.manager.start('scan',{'folder_ids':[folder['id']],'recursive':True}); workflow.manager.worker.join(10)
    identifier='image-manager:'+workflow.manager.query()['images'][0]['id']
    workflow.patch(identifier,{'review_status':'reviewed','tags':['Keep'],'caption':'Manager notes'})
    preset(tmp_path); plan=workflow.prepare([identifier],'move','0'); done=workflow.apply(plan['id'],True)
    assert done['status']=='complete',done
    assert workflow.media(identifier)['caption']=='Manager notes'
    location=Path(workflow.media(identifier)['path']); external=tmp_path/'other.png'; location.rename(external)
    recovered=workflow.locate(identifier,str(external)); assert recovered['media_id']==identifier and recovered['tags']==['Keep']


def test_located_external_original_is_not_deleted_as_a_library_copy(tmp_path):
    identifier=owned(); original=Path(workflow.media(identifier)['path']); external=tmp_path/'external-original.png'
    original.rename(external); workflow.locate(identifier,str(external))
    library.delete_image(identifier.split(':')[1])
    assert external.read_bytes()==picture()


def test_restart_marks_running_plan_interrupted_without_resuming(tmp_path):
    identifier=owned(); preset(tmp_path); plan=workflow.prepare([identifier],'move','0')
    plan.update(status='running',run_id='previous-process'); workflow.put('plan',plan['id'],plan)
    assert workflow.get('plan',plan['id'])['status']=='interrupted'
    assert Path(plan['entries'][0]['source']).exists() and not Path(plan['entries'][0]['target']).exists()


def test_metadata_reads_do_not_save_decisions_or_read_source_bytes(tmp_path,monkeypatch):
    root=tmp_path/'photos'; root.mkdir(); (root/'one.png').write_bytes(picture())
    folder=workflow.manager.add_folder(str(root)); workflow.manager.start('scan',{'folder_ids':[folder['id']],'recursive':True}); workflow.manager.worker.join(10)
    item=workflow.manager.query()['images'][0]; identifier='image-manager:'+item['id']
    visual_review.register('image-manager',item['id'],'one.png',hashlib.sha256(picture()).hexdigest())
    def failure(*args): raise AssertionError('A read must not load source bytes')
    monkeypatch.setattr(visual_review,'read_source',failure)
    assert workflow.media(identifier)['review_status']=='unreviewed'
    assert workflow.listing()['total']==1
    with visual_review.database() as db: assert db.execute('SELECT count(*) FROM source_reviews').fetchone()[0]==0


def test_video_analyzer_registration_persists_after_close_and_supports_copy_move_recovery(tmp_path,monkeypatch):
    from services import local_files
    av=pytest.importorskip('av'); import numpy as np
    monkeypatch.setattr(local_files,'_sessions',{})
    path=tmp_path/'clip.mp4'
    with av.open(str(path),'w') as output:
        stream=output.add_stream('libx264',rate=10); stream.width=64;stream.height=48;stream.pix_fmt='yuv420p'
        for index in range(5):
            frame=av.VideoFrame.from_ndarray(np.full((48,64,3),80,dtype=np.uint8),format='rgb24');frame.pts=index
            for packet in stream.encode(frame): output.mux(packet)
        for packet in stream.encode(None): output.mux(packet)
    session=local_files.open_file(path)
    try:
        value=workflow.register_video(session['id']); identifier=value['media_id']
        assert value['media_type']=='video' and value['file_state']=='present'
        assert workflow.register_video(session['id'])['media_id']==identifier
        assert workflow.video_preview(identifier.split(':')[1])[0].startswith(b'\xff\xd8')
        workflow.patch(identifier,{'review_status':'reviewed','project':'Video project','tags':['Keep']})
        preset(tmp_path); copy=workflow.apply(workflow.prepare([identifier],'copy','0')['id'],True)
        assert copy['status']=='complete',copy
        copied=workflow.media(copy['entries'][0]['copy_media_id']); assert copied['project']=='Video project'
        plan=workflow.prepare([identifier],'move','0'); moved=workflow.apply(plan['id'],True)
        assert moved['status']=='complete',moved
        assert str(local_files.get(session['id']).path)==workflow.media(identifier)['path']
        assert workflow.undo(plan['id'],True)['status']=='undone'
    finally: local_files.close(session['id'])
    assert workflow.listing('video-analyzer')['total']==2
    relocated=tmp_path/'relocated.mp4'; path.rename(relocated)
    assert workflow.locate(identifier,str(relocated))['tags']==['Keep']


def test_vision_suggestions_validate_schema_and_do_not_write_manual_metadata(monkeypatch):
    import httpx
    from services import visual_classification
    value={'caption':'Suggested caption','category':'Scene','subjects':'Graphic','scene':'Test','style':'Drawing','composition':'Centered','quality':'Clear','dataset_suitability':'Uncertain','tags':['New'],'confidence':'Possible'}
    def response(request): return httpx.Response(200,json={'capabilities':['vision']} if request.url.path=='/api/show' else {'message':{'content':json.dumps(value)}})
    original=httpx.AsyncClient
    monkeypatch.setattr(visual_classification,'httpx',type('HTTP',(),{'Timeout':httpx.Timeout,'AsyncClient':staticmethod(lambda **kwargs:original(transport=httpx.MockTransport(response)))}))
    identifier=owned(); result=asyncio.run(visual_classification._review_suggestions(picture(),'fixture'))
    assert result['fields']['tags']==['New'] and result['analysis']['confidence']=='Possible'
    assert workflow.media(identifier)['caption']=='Neutral notes'
    value['confidence']='99%'
    with pytest.raises(ValueError): asyncio.run(visual_classification._review_suggestions(picture(),'fixture'))
