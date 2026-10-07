import asyncio
import base64
import hashlib
import io
import json
from types import SimpleNamespace
import zipfile
import threading

import httpx
import numpy as np
import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import visual_review as store, visual_classification as pipeline, image_vault, image_library, image_manager
from services.faces.providers import DetectedFace
from services.session_guard import SessionGuard
from routes.visual_review import router


@pytest.fixture(autouse=True)
def isolated(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'ROOT',tmp_path/'review')
    monkeypatch.setattr(image_vault,'ROOT',tmp_path/'vault')
    monkeypatch.setattr(image_library,'ROOT',tmp_path/'library')


def picture(color='red'):
    output=io.BytesIO();Image.new('RGB',(100,100),color).save(output,'PNG');return output.getvalue()


def vector(index):
    value=np.zeros(32);value[index]=1;return tuple(value)


def face(embedding,box=(0,0,40,40)):
    return DetectedFace(box,.99,embedding=embedding)


def register(raw,identifier='one',source='media-manager'):
    digest=hashlib.sha256(raw).hexdigest();store.register(source,identifier,identifier,digest);return digest


def test_native_video_tags_reconcile_shared_edits_clears_and_later_native_changes():
    register(picture())
    assert store.sync_media_tags('one',['Native'])['tags']==['Native']
    store.review('media-manager','one',{'tags':['Shared'],'review_status':'reviewed'})
    assert store.sync_media_tags('one',['Native'])['tags']==['Shared']
    assert store.sync_media_tags('one',['Shared'])['review_status']=='reviewed'
    store.review('media-manager','one',{'tags':[]})
    assert store.sync_media_tags('one',['Shared'])['tags']==[]
    assert store.sync_media_tags('one',[])['tags']==[]
    assert store.sync_media_tags('one',['Later native'])['tags']==['Later native']
    with pytest.raises(ValueError): store.review('media-manager','one',{'tags':['x'*61]})


def test_groups_all_faces_by_similarity_and_names_once_across_images():
    a=register(picture(),'a');b=register(picture('blue'),'b')
    store.add_faces(a,picture(),[face(vector(0)),face(vector(1),(45,0,90,45))])
    first=store.result(a)['faces'];assert len(first)==2
    person=next(f for f in first if f['box'][0]==0)['person_id'];store.rename_person(person,'Family member')
    store.add_faces(b,picture('blue'),[face(vector(0)),face(vector(1),(45,0,90,45))])
    assert {f['person_id'] for f in store.result(b)['faces']}=={f['person_id'] for f in first}
    assert any(f['name']=='Family member' for f in store.result(b)['faces'])
    assert len(store.catalog('media-manager',person=person)['items'])==2
    assert all(group['count']==2 for group in store.catalog('media-manager')['people'])
    assert store.crop(first[0]['id']).startswith(b'\xff\xd8')


def test_ambiguous_faces_are_separate_and_manual_corrections_survive_cached_run():
    a=register(picture(),'a');b=register(picture('blue'),'b')
    store.add_faces(a,picture(),[face(vector(0)),face(vector(1),(45,0,90,45))])
    ambiguous=tuple(np.asarray(vector(0))+np.asarray(vector(1)))
    store.add_faces(b,picture('blue'),[face(ambiguous)])
    current=store.result(b)['faces'][0];assert current['uncertain']
    target=store.result(a)['faces'][0]['person_id'];assert current['person_id']!=target
    store.correct_face(current['id'],target)
    store.add_faces(b,picture('blue'),[face(vector(5))])
    assert store.result(b)['faces'][0]['person_id']==target
    assert not store.result(b)['faces'][0]['uncertain']
    store.correct_face(current['id'],target,True);assert store.result(b)['faces']==[]


def test_distinct_faces_in_one_image_are_not_merged_even_with_similar_embeddings():
    digest=register(picture());store.add_faces(digest,picture(),[face(vector(0)),face(vector(0),(45,0,90,45))])
    faces=store.result(digest)['faces'];assert len({f['person_id'] for f in faces})==2
    store.merge_people(faces[0]['person_id'],faces[1]['person_id'])
    assert len(store.catalog('media-manager')['people'])==1
    store.correct_face(faces[0]['id'])
    assert len(store.catalog('media-manager')['people'])==2


def test_people_remain_available_for_correction_under_all_photo_filters():
    a=register(picture(),'a');b=register(picture('blue'),'b')
    store.add_faces(a,picture(),[face(vector(0))])
    store.add_faces(b,picture('blue'),[face(vector(1))])
    first=store.result(a)['faces'][0];second=store.result(b)['faces'][0]
    store.rename_person(first['person_id'],'Alex');store.rename_person(second['person_id'],'Jordan')
    store.set_scenes(a,['park']);store.set_scenes(b,['indoors'])
    store.review('media-manager','a',{'rating':'liked','caption':'Trip','tags':[]})
    all_people=store.catalog('media-manager')['people']
    filtered=store.catalog('media-manager',person=first['person_id'],scene='park',rating='liked',query='Alex')
    assert [item['id'] for item in filtered['items']]==['a']
    assert filtered['people']==all_people
    assert filtered['scenes']=={'park':1,'indoors':1}
    assert store.catalog('media-manager',query='no matches')['people']==all_people
    # Facets still respect privacy and workspace boundaries, despite ignoring photo filters.
    private=register(picture('green'),'private');store.add_faces(private,picture('green'),[face(vector(2))])
    from unittest.mock import patch
    with patch.object(image_vault,'locked_hashes',return_value={private}):
        assert store.catalog('media-manager')['people']==all_people
    assert store.catalog('library')['people']==[]


def test_named_face_separation_and_undo_are_atomic_and_preserve_other_faces():
    a=register(picture(),'a');b=register(picture('blue'),'b')
    for digest,raw in [(a,picture()),(b,picture('blue'))]:
        store.add_faces(digest,raw,[face(vector(0)),face(vector(1),(45,0,90,45))])
    before=store.result(a)['faces'];moving=before[0];other=before[1]
    original=moving['person_id']
    app=FastAPI();app.include_router(router);client=TestClient(app)
    response=client.post('/visual-review/face',json={'id':moving['id'],'name':'  Alex  '})
    assert response.status_code==200,response.text
    new_id=response.json()['person_id'];assert new_id!=original
    after={item['id']:item for item in store.result(a)['faces']}
    assert after[moving['id']]['name']=='Alex' and after[other['id']]==other
    assert any(item['person_id']==original for item in store.result(b)['faces'])
    # Cached scans cannot undo a deliberate correction or its user-supplied name.
    store.add_faces(a,picture(),[face(vector(5))])
    assert store.result(a)['faces']==list(after.values())
    response=client.post('/visual-review/face',json={'id':moving['id'],'person_id':original})
    assert response.status_code==200
    assert {item['person_id'] for item in store.result(a)['faces']}=={item['person_id'] for item in before}
    store.correct_face(moving['id'],exclude=True)
    assert [item['id'] for item in store.result(a)['faces']]==[other['id']]
    store.correct_face(moving['id'],original,exclude=False)
    assert len(store.result(a)['faces'])==2
    with store.database() as db: count=db.execute('SELECT COUNT(*) FROM people').fetchone()[0]
    for invalid in [{'name':'   '},{'name':'New name','person_id':original},{'name':'New name','exclude':True}]:
        assert client.post('/visual-review/face',json={'id':moving['id'],**invalid}).status_code==422
    with store.database() as db: assert db.execute('SELECT COUNT(*) FROM people').fetchone()[0]==count


def test_automatic_person_labels_do_not_collide_after_merging_groups():
    digest=register(picture());store.add_faces(digest,picture(),[face(vector(0)),face(vector(1),(45,0,90,45))])
    people=store.catalog('media-manager')['people']
    store.merge_people(people[0]['id'],people[1]['id'])
    store.correct_face(store.result(digest)['faces'][0]['id'])
    labels=[group['name'] for group in store.catalog('media-manager')['people']]
    assert len(labels)==len(set(labels))==2


def test_scene_labels_are_bounded_and_manual_notes_preserved():
    digest=register(picture());store.set_scenes(digest,['beach','outdoors','beach'])
    assert store.result(digest)['scenes']==['beach','outdoors']
    with pytest.raises(ValueError):store.set_scenes(digest,['invented personal attribute'])
    store.review('media-manager','one',{'rating':'liked','caption':'Our trip','tags':['Trip']})
    assert store.catalog('media-manager',rating='liked',scene='beach',query='trip')['total']==1
    assert store.catalog('media-manager',rating='disliked')['total']==0


def test_locked_images_do_not_expose_faces_or_group_counts(monkeypatch):
    digest=register(picture());store.add_faces(digest,picture(),[face(vector(0))]);identifier=store.result(digest)['faces'][0]['id']
    monkeypatch.setattr(image_vault,'locked_hashes',lambda: {digest})
    assert store.catalog('media-manager')['total']==0
    with pytest.raises(image_vault.LockedImageError):store.crop(identifier)


def test_review_updates_existing_library_metadata_and_exports_exact_bytes():
    raw=picture();item=image_library.import_image(raw,'photo.png')
    app=FastAPI();app.include_router(router);client=TestClient(app)
    opened=client.post('/visual-review/open',json={'source':'library','ids':[item['id']]});assert opened.status_code==200,opened.text
    response=client.post('/visual-review/review',json={'source':'library','id':item['id'],'rating':'liked','caption':'A caption','tags':['Holiday']})
    assert response.status_code==200,response.text
    saved=image_library.public_index()['images'][0]
    assert saved['rating']=='liked' and saved['annotations']['caption']=='A caption' and len(saved['tag_ids'])==1
    assert store.catalog('library',query='Holiday')['total']==1
    archive=client.post('/visual-review/export',json={'source':'library','ids':[item['id']]})
    with zipfile.ZipFile(io.BytesIO(archive.content)) as output:
        assert output.read('0001-photo.png')==raw
        assert json.loads(output.read('review.json'))[0]['caption']=='A caption'


def test_image_manager_reviews_preserve_originals_and_follow_existing_tags(tmp_path,monkeypatch):
    root=tmp_path/'photos';root.mkdir();raw=picture();(root/'photo.png').write_bytes(raw)
    manager=image_manager.ImageManager(tmp_path/'manager');monkeypatch.setattr(image_manager,'manager',manager)
    folder=manager.add_folder(str(root))['id'];manager.start('scan',{'folder_ids':[folder],'recursive':True});manager.worker.join(10)
    identifier=manager.query()['images'][0]['id'];_,digest,_=store.read_source('image-manager',identifier)
    store.review('image-manager',identifier,{'rating':'liked','caption':'Vacation','tags':['Beach']})
    assert manager.query(favorite=True,tag='Beach')['total']==1
    assert store.catalog('image-manager',rating='liked')['items'][0]['review']['caption']=='Vacation'
    assert (root/'photo.png').read_bytes()==raw
    assert store.pending_ids('image-manager')[0]==[identifier]
    store.add_faces(digest,raw,[face(vector(0))]);assert store.pending_ids('image-manager')[0]==[]
    (root/'photo.png').write_bytes(picture('green'))
    with pytest.raises(ValueError):store.read_source('image-manager',identifier)
    manager.start('scan',{'folder_ids':[folder],'recursive':True});manager.worker.join(10)
    assert store.catalog('image-manager')['total']==0
    assert store.pending_ids('image-manager')[0]==[identifier]


def test_review_tag_choices_include_unclassified_images_and_new_names(tmp_path,monkeypatch):
    root=tmp_path/'photos';root.mkdir()
    for name,color in [('first.png','red'),('second.png','blue')]: (root/name).write_bytes(picture(color))
    manager=image_manager.ImageManager(tmp_path/'manager');monkeypatch.setattr(image_manager,'manager',manager)
    folder=manager.add_folder(str(root))['id'];manager.start('scan',{'folder_ids':[folder],'recursive':True});manager.worker.join(10)
    first,second=[item['id'] for item in manager.query()['images']]
    manager.metadata([first],tags=['Existing name'])
    app=FastAPI();app.include_router(router);client=TestClient(app)
    opened=client.post('/visual-review/open',json={'source':'image-manager','ids':[second]}).json()
    assert opened['available_tags']==['Existing name']
    assert opened['classification']['faces']==[]
    body={'source':'image-manager','id':second,'caption':'Keep my notes','tags':['Keep','Existing name','New name']}
    saved=client.post('/visual-review/review',json=body)
    assert saved.status_code==200 and saved.json()['tags']==body['tags']
    assert manager.image(second)['tags']==body['tags']
    reopened=client.post('/visual-review/open',json={'source':'image-manager','ids':[first]}).json()
    assert reopened['available_tags']==['Existing name','Keep','New name']
    assert reopened['review']['tags']==['Existing name']
    assert store.review('image-manager',second)['caption']=='Keep my notes'


def test_foundation_library_metadata_persists_and_patches_do_not_clear_notes():
    raw=picture();item=image_library.import_image(raw,'foundation.png')
    app=FastAPI();app.include_router(router)
    from routes.image_library import router as library_router
    app.include_router(library_router);client=TestClient(app)
    body={'source':'library','id':item['id']}
    saved=client.post('/visual-review/review',json={**body,'tags':[' Trip ','trip'],
        'caption':'Keep this caption','category':' Travel ','project':' Album ',
        'favorite':True,'review_status':'rejected'})
    assert saved.status_code==200,saved.text
    value=saved.json()
    assert value['schema_version']==1 and value['review_status']=='rejected' and value['rating']=='disliked'
    assert value['favorite'] is True and value['category']=='Travel' and value['project']=='Album'
    assert value['tags']==['Trip']
    # Repeated existing tags resolve their IDs rather than creating duplicates.
    assert client.post('/visual-review/review',json={**body,'tags':['Trip']}).status_code==200
    patched=client.post('/visual-review/review',json={**body,'project':'New album'}).json()
    assert patched['caption']=='Keep this caption' and patched['tags']==['Trip']
    assert patched['review_status']=='rejected' and patched['favorite'] is True
    stored=image_library.read_index()['images'][0]
    assert stored['project']=='New album' and stored['category']=='Travel' and stored['favorite'] is True
    assert image_library.import_image(raw,'again.png')['id']==item['id']
    assert image_library.public_index()['images'][0]['project']=='New album'
    # Existing image-library edits participate in the same status contract.
    response=client.patch(f"/image-library/images/{item['id']}",json={'review_status':'accepted','favorite':False})
    assert response.status_code==200,response.text
    assert response.json()['rating']=='liked' and response.json()['favorite'] is False
    assert response.json()['annotations']['caption']=='Keep this caption'
    assert response.json()['project']=='New album'
    assert image_library.image_bytes(item['id'])[0]==raw
    client.post('/visual-review/open',json={'source':'library','ids':[item['id']]})
    filtered=client.get('/visual-review/catalog',params={'source':'library','category':'travel','project':'New album','favorite':'false','review_status':'accepted'})
    assert filtered.status_code==200 and filtered.json()['total']==1
    assert client.get('/visual-review/catalog',params={'source':'library','review_status':'unreviewed'}).json()['total']==0
    assert client.post('/visual-review/review',json={**body,'rating':None}).json()['review_status']=='unreviewed'
    assert client.post('/visual-review/review',json={**body,'category':'','tags':[]}).json()['tags']==[]


def test_foundation_legacy_library_defaults_do_not_rewrite_the_index():
    item=image_library.import_image(picture(),'legacy.png')
    index=image_library.read_index();record=index['images'][0]
    for key in ('schema_version','category','project','favorite','review_status','media_id','media_type','path','file_state'):record.pop(key)
    record['rating']='liked';image_library.save_index(index)
    before=(image_library.ROOT/'index.json').read_bytes()
    value=store.review('library',item['id'])
    assert value['favorite'] is True and value['review_status']=='accepted'
    assert value['category']==value['project']==''
    assert (image_library.ROOT/'index.json').read_bytes()==before
    store.review('library',item['id'],{'favorite':False})
    persisted=store.review('library',item['id'])
    assert persisted['favorite'] is False and persisted['rating']=='liked'


def test_foundation_legacy_sqlite_migration_keeps_copies_independent():
    import sqlite3
    store.ROOT.mkdir()
    db=sqlite3.connect(store.ROOT/'catalog.sqlite3')
    digest=hashlib.sha256(picture()).hexdigest()
    db.execute("CREATE TABLE reviews(digest TEXT PRIMARY KEY,rating TEXT,caption TEXT,tags TEXT)")
    db.execute('INSERT INTO reviews VALUES (?,?,?,?)',(digest,'liked','Legacy caption',json.dumps(['Old tag'])))
    db.commit();db.close()
    register(picture(),'a');register(picture(),'b')
    assert store.review('media-manager','a')['caption']=='Legacy caption'
    a=store.review('media-manager','a',{'project':'Project A','review_status':'rejected','favorite':False})
    b=store.review('media-manager','b')
    assert a['rating']=='disliked' and a['tags']==['Old tag']
    assert b['project']=='' and b['rating']=='liked' and b['favorite'] is True
    assert store.review('media-manager','a')['project']=='Project A'
    assert store.catalog('media-manager',project='project a',favorite=False,review_status='rejected')['total']==1
    with store.database() as connection:
        assert connection.execute('SELECT caption FROM reviews WHERE digest=?',(digest,)).fetchone()[0]=='Legacy caption'
    # A replacement file gets fresh metadata; returning to old content recovers its notes.
    register(picture('green'),'a')
    assert store.review('media-manager','a')['review_status']=='unreviewed'
    register(picture(),'a')
    assert store.review('media-manager','a')['project']=='Project A'


def test_foundation_native_manager_favorite_is_independent(tmp_path,monkeypatch):
    root=tmp_path/'photos';root.mkdir();raw=picture();(root/'photo.png').write_bytes(raw)
    manager=image_manager.ImageManager(tmp_path/'manager');monkeypatch.setattr(image_manager,'manager',manager)
    folder=manager.add_folder(str(root))['id'];manager.start('scan',{'folder_ids':[folder],'recursive':True});manager.worker.join(10)
    identifier=manager.query()['images'][0]['id']
    assert store.review('image-manager',identifier)['review_status']=='unreviewed'
    manager.metadata([identifier],favorite=True)
    assert store.review('image-manager',identifier)['review_status']=='unreviewed'
    saved=store.review('image-manager',identifier,{'review_status':'accepted','favorite':False,'category':'Reference','project':'Test','caption':'Keep','tags':['Saved']})
    assert saved['rating']=='liked' and saved['favorite'] is False
    assert manager.query(favorite=True)['total']==0
    store.review('image-manager',identifier,{'category':'Portrait'})
    manager.metadata([identifier],favorite=True)
    value=store.review('image-manager',identifier)
    assert value['favorite'] is True and value['review_status']=='accepted' and value['tags']==['Saved']
    value=store.review('image-manager',identifier,{'review_status':'rejected'})
    assert value['favorite'] is True and value['rating']=='disliked'
    value=store.catalog('image-manager',favorite=True,review_status='rejected')['items'][0]['review']
    assert value['category']=='Portrait' and value['project']=='Test' and value['caption']=='Keep'
    assert (root/'photo.png').read_bytes()==raw
    (root/'photo.png').write_bytes(picture('green'))
    manager.start('scan',{'folder_ids':[folder],'recursive':True});manager.worker.join(10)
    assert store.review('image-manager',identifier)['review_status']=='unreviewed'


@pytest.mark.parametrize('changes',[
    {'category':'x'*121},{'project':None},{'favorite':'false'},
    {'review_status':'done'},{'review_status':'accepted','rating':'disliked'},
    {'tags':[' ']},{'tags':['x'*81]},{'unexpected':'field'},
])
def test_foundation_invalid_patches_preserve_saved_data(changes):
    item=image_library.import_image(picture(),'validation.png')
    store.review('library',item['id'],{'caption':'Keep','tags':['Existing'],'project':'Original'})
    before=(image_library.ROOT/'index.json').read_bytes()
    app=FastAPI();app.include_router(router);client=TestClient(app)
    response=client.post('/visual-review/review',json={'source':'library','id':item['id'],**changes})
    assert response.status_code==422,response.text
    assert (image_library.ROOT/'index.json').read_bytes()==before


def test_media_record_missing_library_file_retains_identity_and_metadata():
    raw=picture();item=image_library.import_image(raw,'missing.png')
    store.review('library',item['id'],{'review_status':'accepted','category':'Reference','project':'Album','tags':['Keep'],'favorite':True})
    opened=store.open_item('library',item['id'])
    path=image_library.ROOT/'images'/(item['id']+'.image')
    assert opened['media']['media_id']=='library:'+item['id']
    assert opened['media']['path']==str(path) and opened['media']['file_state']=='present'
    assert image_library.read_index()['images'][0]['path']==str(path)
    path.unlink()
    app=FastAPI();app.include_router(router);client=TestClient(app)
    response=client.post('/visual-review/open',json={'source':'library','ids':[item['id']]})
    assert response.status_code==200,response.text
    missing=response.json()
    assert missing['media']['file_state']=='missing' and missing['media']['path']==str(path)
    assert missing['review']==opened['review']
    assert store.catalog('library')['items'][0]['media']['file_state']=='missing'
    updated=store.review('library',item['id'],{'category':'Saved while missing'})
    assert updated['tags']==['Keep'] and updated['favorite'] is True
    with pytest.raises(ValueError,match='missing'):image_library.image_bytes(item['id'])
    assert client.post('/visual-review/export',json={'source':'library','ids':[item['id']]}).status_code==422
    path.write_bytes(raw)
    restored=store.open_item('library',item['id'])
    assert restored['media']['file_state']=='present' and restored['media']['media_id']==opened['media']['media_id']
    assert restored['review']['category']=='Saved while missing' and image_library.image_bytes(item['id'])[0]==raw


def test_media_record_disconnected_storage_is_not_reported_as_deleted(monkeypatch):
    item=image_library.import_image(picture(),'offline.png')
    from services import storage_libraries as storage
    monkeypatch.setattr(storage,'resolve',lambda *args,**kwargs: (_ for _ in ()).throw(storage.StorageUnavailable('Fixture disconnected drive')))
    before=(image_library.ROOT/'index.json').read_bytes()
    record=image_library.public_index()['images'][0]
    assert record['file_state']=='unavailable' and record['path']==item['path']
    assert (image_library.ROOT/'index.json').read_bytes()==before
    assert store.open_item('library',item['id'])['media']['file_state']=='unavailable'


def test_media_record_missing_manager_source_survives_rescan(tmp_path,monkeypatch):
    root=tmp_path/'photos';root.mkdir();path=root/'photo.png';raw=picture();path.write_bytes(raw)
    manager=image_manager.ImageManager(tmp_path/'manager');monkeypatch.setattr(image_manager,'manager',manager)
    folder=manager.add_folder(str(root))['id'];manager.start('scan',{'folder_ids':[folder],'recursive':True});manager.worker.join(10)
    identifier=manager.query()['images'][0]['id']
    opened=store.open_item('image-manager',identifier)
    store.review('image-manager',identifier,{'review_status':'rejected','category':'Reference','tags':['Keep']})
    assert opened['media']['path']==str(path)
    with store.database() as db:
        snapshot=json.loads(db.execute('SELECT record FROM sources WHERE source=? AND id=?',('image-manager',identifier)).fetchone()[0])
    assert snapshot['path']==str(path)
    path.unlink();manager.start('scan',{'folder_ids':[folder],'recursive':True});manager.worker.join(10)
    missing=store.open_item('image-manager',identifier)
    assert missing['media']['file_state']=='missing'
    assert missing['review']['review_status']=='rejected' and missing['review']['tags']==['Keep']
    assert store.catalog('image-manager')['items'][0]['media']['file_state']=='missing'
    store.review('image-manager',identifier,{'project':'Retained'})
    path.write_bytes(raw);manager.start('scan',{'folder_ids':[folder],'recursive':True});manager.worker.join(10)
    restored=store.open_item('image-manager',identifier)
    assert restored['media']['media_id']==opened['media']['media_id']
    assert restored['media']['file_state']=='present' and restored['review']['project']=='Retained'


def test_media_record_phase_one_survives_fresh_backend_processes(tmp_path):
    import os
    from pathlib import Path
    import subprocess
    import sys
    data=tmp_path/'fresh-process-data'
    env={**os.environ,'LAW_DATA_DIR':str(data),'LAW_LOG_DIR':str(tmp_path/'logs'),'LAW_MODELS_DIR':str(tmp_path/'models')}
    backend=Path(__file__).resolve().parents[2]/'backend'
    writer="""
import io,json
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from services import image_library as library,visual_review as review
buffer=io.BytesIO(); png=PngInfo(); png.add_text('local_ai_seed','12345')
Image.new('RGB',(12,12),'red').save(buffer,'PNG',pnginfo=png)
item=library.import_image(buffer.getvalue(),'fixture-generated.png',{'kind':'session','session_id':'fixture-session','message_id':'fixture-message','image_id':'fixture-image'})
index=library.read_index(); index['images'][0]['generation']={'prompt':'Neutral fixture','model':'fixture-model'}; library.save_index(index)
review.open_item('library',item['id'])
review.review('library',item['id'],{'review_status':'accepted','category':'Reference','project':'Restart fixture','tags':['Persistent'],'favorite':True})
print(json.dumps({'id':item['id']}))
"""
    writer_result=subprocess.run([sys.executable,'-B','-c',writer],cwd=backend,env=env,capture_output=True,text=True,timeout=30,check=True)
    identifier=json.loads(writer_result.stdout)['id']
    reader="""
import json,sys
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.image_library import router as library_router
from routes.visual_review import router as review_router
app=FastAPI();app.include_router(library_router);app.include_router(review_router)
with TestClient(app) as client:
    listed=client.get('/image-library').json()['images'][0]
    opened=client.post('/visual-review/open',json={'source':'library','ids':[sys.argv[1]]})
    assert opened.status_code==200,opened.text
    print(json.dumps({'listed':listed,'opened':opened.json()}))
"""
    reader_result=subprocess.run([sys.executable,'-B','-c',reader,identifier],cwd=backend,env=env,capture_output=True,text=True,timeout=30,check=True)
    value=json.loads(reader_result.stdout)
    media=value['opened']['media']
    assert media['media_id']=='library:'+identifier and media['media_type']=='image'
    assert media['review_status']=='accepted' and media['favorite'] is True
    assert media['category']=='Reference' and media['project']=='Restart fixture' and media['tags']==['Persistent']
    assert media['file_state']=='present' and Path(media['path']).is_file()
    assert media['metadata']['seed']==12345
    assert value['listed']['generation']=={'prompt':'Neutral fixture','model':'fixture-model'}
    assert value['listed']['origin']['message_id']=='fixture-message'


@pytest.mark.parametrize('immutable', [{'media_id':'replacement'},{'path':'C:/replacement.png'},{'media_type':'video'},{'file_state':'present'}])
def test_media_record_locations_and_identity_cannot_be_edited_by_clients(immutable):
    item=image_library.import_image(picture(),'identity.png')
    app=FastAPI();app.include_router(router);client=TestClient(app)
    response=client.post('/visual-review/review',json={'source':'library','id':item['id'],**immutable})
    assert response.status_code==422
    assert image_library.public_index()['images'][0]['media_id']==item['media_id']


def test_media_credential_cannot_access_regular_workstation_routes(monkeypatch):
    monkeypatch.setenv('LAW_SESSION_TOKEN','host');monkeypatch.setenv('LAW_REVIEW_BRIDGE_TOKEN','review-only')
    app=FastAPI();app.include_router(router);app.add_middleware(SessionGuard)
    client=TestClient(app,base_url='http://127.0.0.1:8000');headers={'X-LAW-Review':'review-only'}
    assert client.get('/visual-review/catalog',headers=headers).status_code==403
    assert client.get('/storage-libraries',headers=headers).status_code==403
    assert client.get('/visual-review/media/catalog',headers=headers).status_code==200
    assert client.get('/visual-review/media/catalog',headers={**headers,'Origin':'app://local'}).status_code==403
    body={'id':'scan::record','name':'video.mp4','digest':'a'*64,'image':base64.b64encode(picture()).decode()}
    response=client.post('/visual-review/media/register',headers=headers,json=body)
    assert response.status_code==200
    assert response.json()['media']['media_type']=='video' and response.json()['media']['path'] is None
    assert response.json()['media']['file_state']=='unchecked'
    assert client.post('/visual-review/media/review',headers=headers,json={'source':'library','id':'unrelated'}).status_code==403


def test_pipeline_runs_once_retains_progress_and_cancellation(monkeypatch):
    raw=picture();digest=register(raw);calls=[]
    class Provider:
        def uses_gpu(self):return False
        def detect(self,image,cancelled):calls.append('detect');assert callable(cancelled);return [face(vector(0))]
        def unload(self):return True
    class Queue:
        def enqueue(self,*args,**kwargs):return SimpleNamespace(cancel_event=__import__('threading').Event())
        async def wait(self,job):pass
        def finish(self,job,error):calls.append('finish')
    monkeypatch.setattr(pipeline,'get_provider',lambda:Provider());monkeypatch.setattr(pipeline,'queue',Queue())
    async def run():
        actor=pipeline.Classifier();sample={'one':{'raw':raw,'digest':digest,'name':'one'}}
        actor.start('media-manager',['one'],True,'',sample);await actor.task
        assert actor.status()['status']=='complete' and actor.status()['processed']==1
        actor.start('media-manager',['one'],True,'',sample);await actor.task
        assert calls.count('detect')==1
        actor.start('media-manager',['one'],True,'',sample);await actor.stop();await actor.task
        assert actor.status()['status']=='cancelled'
        assert store.result(digest)['faces_done']
    asyncio.run(run());assert calls.count('finish')==3


@pytest.mark.parametrize('labels,valid', [(['outdoors','park'],True),(['unapproved trait'],False),(['park']*9,False)])
def test_scene_stream_contract_and_validation(monkeypatch,labels,valid):
    requests=[]
    def handler(request):
        requests.append((request.url.path,json.loads(request.content)))
        if request.url.path=='/api/show':return httpx.Response(200,json={'capabilities':['vision']})
        text=json.dumps({'scenes':labels});middle=len(text)//2
        return httpx.Response(200,content='\n'.join(json.dumps({'message':{'content':part}}) for part in (text[:middle],text[middle:])))
    monkeypatch.setattr(pipeline,'httpx',SimpleNamespace(Timeout=httpx.Timeout,AsyncClient=lambda **kwargs:httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    if valid:assert asyncio.run(pipeline.scene_labels(picture(),'local-vision',threading.Event()))==labels
    else:
        with pytest.raises(ValueError):asyncio.run(pipeline.scene_labels(picture(),'local-vision',threading.Event()))
    payload=requests[-1][1]
    assert payload['stream'] and payload['think'] is False and payload['format']['additionalProperties'] is False
    assert base64.b64decode(payload['messages'][0]['images'][0]).startswith(b'\xff\xd8')


def test_stop_closes_stalled_scene_stream(monkeypatch):
    async def run():
        started=asyncio.Event();closed=asyncio.Event();cancel=threading.Event()
        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                started.set();await asyncio.Event().wait();yield b''
            async def aclose(self):closed.set()
        def handler(request):
            if request.url.path=='/api/show':return httpx.Response(200,json={'capabilities':['vision']})
            return httpx.Response(200,stream=Stream())
        monkeypatch.setattr(pipeline,'httpx',SimpleNamespace(Timeout=httpx.Timeout,AsyncClient=lambda **kwargs:httpx.AsyncClient(transport=httpx.MockTransport(handler))))
        task=asyncio.create_task(pipeline.scene_labels(picture(),'local-vision',cancel))
        await asyncio.wait_for(started.wait(),2);cancel.set()
        with pytest.raises(pipeline.QueueCancelled):await asyncio.wait_for(task,2)
        assert closed.is_set()
    asyncio.run(run())


def test_cancel_queued_batch_never_unloads_another_jobs_models(monkeypatch):
    calls=[]
    class Queue:
        def enqueue(self,*args,**kwargs):return SimpleNamespace(cancel_event=threading.Event())
        async def wait(self,job):raise pipeline.QueueCancelled()
        def finish(self,job,error):calls.append('finish')
    class Provider:
        def uses_gpu(self):return False
        def unload(self):pytest.fail('Queued work must not unload the active provider')
    monkeypatch.setattr(pipeline,'queue',Queue());monkeypatch.setattr(pipeline,'get_provider',lambda:Provider())
    monkeypatch.setattr(pipeline,'httpx',SimpleNamespace(AsyncClient=lambda **kwargs:pytest.fail('Queued work must not call model unload')))
    async def run():
        actor=pipeline.Classifier();actor.start('image-manager',['one'],True,'local-vision');await actor.task
        assert actor.status()['status']=='cancelled'
    asyncio.run(run());assert calls==['finish']


def test_cleanup_failure_releases_queue_and_retains_partial_faces(monkeypatch):
    raw=picture();digest=register(raw);finished=[]
    class Queue:
        def enqueue(self,*args,**kwargs):return SimpleNamespace(cancel_event=threading.Event())
        async def wait(self,job):pass
        def finish(self,job,error):finished.append(error)
    class Provider:
        def uses_gpu(self):return False
        def detect(self,*args):return [face(vector(0))]
        def unload(self):return True
    async def scene(*args):raise ValueError('Invalid scene response')
    async def prepare(*args):pass
    monkeypatch.setattr(pipeline,'queue',Queue());monkeypatch.setattr(pipeline,'get_provider',lambda:Provider())
    monkeypatch.setattr(pipeline,'scene_labels',scene);monkeypatch.setattr(pipeline,'prepare_runtime',prepare)
    monkeypatch.setattr(pipeline,'httpx',SimpleNamespace(AsyncClient=lambda **kwargs:httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(500,text='cleanup failed')))))
    async def run():
        actor=pipeline.Classifier();actor.start('media-manager',['one'],True,'local-vision',{'one':{'raw':raw,'digest':digest,'name':'one'}});await actor.task
        assert actor.status()['status']=='error' and len(actor.status()['errors'])==1
        assert store.result(digest)['faces_done'] and not store.result(digest)['scenes_done']
    asyncio.run(run());assert len(finished)==1 and 'cleanup' in finished[0].lower()
