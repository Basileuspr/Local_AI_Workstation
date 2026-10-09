import asyncio
import hashlib
import json
import threading

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
import pytest

from routes.reels import router
from services import browser_media, reels_analysis as analysis, reels_store as store
from services.request_queue import QueueCancelled
from services.session_guard import SessionGuard
from test_local_files import make_video

WF='b'*32
BODY={'profileId':'default','sourceUrl':'https://www.instagram.com/direct/t/fixture/',
      'reels':['https://www.instagram.com/reel/owned_one/','https://www.instagram.com/reel/owned_one/'],
      'accountRef':'a'*64,'visionModel':'fixture-local-vision','whisperModel':'small'}


def test_prompt_evidence_redacts_credentials_and_signed_addresses():
    cleaned=analysis.clean('https://fixture-user:fixture-password@github.com/owner/repo?signature=SIGNED#TOKEN '
                           'Authorization: Bearer PRIVATE token=HIDDEN')
    assert 'https://github.com/owner/repo' in cleaned
    assert all(secret not in cleaned for secret in ('fixture-user','fixture-password','SIGNED','TOKEN','PRIVATE','HIDDEN'))
    assert analysis.clean('https://[invalid')=='[address]'


@pytest.fixture
def paths(tmp_path,monkeypatch):
    monkeypatch.setenv('LAW_REELS_DATA_DIR',str(tmp_path/'saved'))
    root=tmp_path/'media'; root.mkdir();monkeypatch.setenv('LAW_BROWSER_WORKFLOW_DIR',str(root))
    monkeypatch.setenv('LAW_LOCAL_FILES_TOKEN','fixture-native')
    return tmp_path,root


def capture(root,audio=False,brief=False):
    folder=root/WF;folder.mkdir()
    original=folder/'video.mp4'
    if brief:brief_video(original)
    else:make_video(original,audio=audio)
    original.rename(folder/'video.bin')
    (folder/'captions.json').write_text(json.dumps({'status':'complete','description':'A creator demonstrates a local tool.', 'tracks':[]}))
    data=(folder/'video.bin').read_bytes()
    browser_media.verify(WF,{'duration':3,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()},threading.Event())
    return folder


def test_atomic_dedupe_restart_recovery_and_independent_cache(paths):
    tmp,root=paths
    session=tmp/'chromium';session.mkdir();(session/'login').write_text('preserve')
    record=store.create(BODY);assert len(record['items'])==1
    folder=capture(root);assert store.claim(record['id'],0,WF)
    result={'summary':'The creator demonstrates a local tool. They describe its use for searching files.','repository':None}
    store.complete(record['id'],0,result)
    # Crash after summary commit, before cleanup/checkpoint release.
    store._initialized.clear()
    restored=store.get(record['id'])
    assert restored['items'][0]['status']=='complete' and not folder.exists()
    assert not store.claim(record['id'],0,WF)
    assert len(store.listing()['summaries'])==1
    assert store.create(BODY)['items'][0]['status']=='duplicate'
    assert (session/'login').read_text()=='preserve'
    another={**BODY,'reels':['https://www.instagram.com/reel/owned_two/']}
    second=store.create(another);folder=capture(root);store.claim(second['id'],0,WF)
    store.update(second['id'],status='running');store._initialized.clear()
    assert store.get(second['id'])['status']=='interrupted'
    assert store.get(second['id'])['items'][0]['status']=='interrupted'
    assert not folder.exists() and len(store.listing()['summaries'])==1


@pytest.mark.parametrize('url',['https://127.0.0.1/reel/id/','https://localhost/reel/id/',
    'https://192.168.1.1/reel/id/','https://www.instagram.com/reel/id/?token=SECRET',
    'https://user:SECRET@www.instagram.com/reel/id/','http://www.instagram.com/reel/id/'])
def test_signed_private_or_credential_source_never_stored(paths,url):
    with pytest.raises(ValueError):store.create({**BODY,'reels':[url]})
    assert not store.listing()['summaries']


def brief_video(path):
    import av
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',32)
    with av.open(str(path),'w') as output:
        stream=output.add_stream('libx264',rate=20);stream.width=640;stream.height=360;stream.pix_fmt='yuv420p'
        for index in range(60):
            picture=Image.new('RGB',(640,360),'white')
            if index==23:ImageDraw.Draw(picture).text((10,285),'github.com/fixture/brief-tool',font=font,fill='black')
            frame=av.VideoFrame.from_image(picture)
            for packet in stream.encode(frame):output.mux(packet)
            picture.close()
        for packet in stream.encode():output.mux(packet)


def test_fleeting_url_still_and_original_resolution_crops_are_retained(paths):
    tmp,root=paths;folder=root/WF;folder.mkdir();video=folder/'brief.mp4';brief_video(video)
    rows=analysis.scan(video,folder/'frames',threading.Event(),lambda _:None)
    assert any(abs(r['time']-1.15)<.001 for r in rows)
    assert rows==sorted(rows,key=lambda r:r['time'])
    selected=next(r for r in rows if abs(r['time']-1.15)<.001)
    import io
    with Image.open(io.BytesIO(analysis.image_bytes(selected['path'],(.6,1)))) as crop:
        assert crop.width==640 and crop.height==144
    assert rows[0]['time']==0 and rows[-1]['time']>=2.9


def test_repository_parser_never_guesses_partial_or_unclear_addresses():
    assert analysis.repositories('github.com/owner/project')=={'https://github.com/owner/project'}
    for text in ['github.com/owner/[unreadable]','github.com/owner','github.com/owner/proj...',
                 'https://github.com','github.com/unknown/project']:
        assert not analysis.repositories(text)
    assert 'SECRET' not in analysis.clean('token=SECRET https://cdn.example/a?signature=SECRET')


def test_summary_rejects_guessed_names_quotes_and_repository_addresses():
    lookup={'caption':'The creator demonstrates FileFinder. It searches local files.'}
    supported={'text':'The creator demonstrates FileFinder.','names':['FileFinder'],
        'evidence':[{'id':'caption','quote':'demonstrates FileFinder'}]}
    second={'text':'The creator says it searches local files.','names':[],
        'evidence':[{'id':'caption','quote':'searches local files'}]}
    sentences,_=analysis.validate_draft({'sentences':[supported,second]},lookup)
    assert len(sentences)==2
    for change in [{'names':['InventedTool']},{'text':'Find its repository at https://github.com/invented/project.'},
                   {'evidence':[{'id':'caption','quote':'Made up capability'}]}]:
        with pytest.raises(ValueError):analysis.validate_draft({'sentences':[{**supported,**change},second]},lookup)


def test_dense_refinement_reopens_original_frames_and_preserves_timestamp_order(paths):
    tmp,root=paths;folder=root/WF;folder.mkdir();path=folder/'brief.mp4';brief_video(path)
    directory=folder/'analysis'/'frames';directory.mkdir(parents=True)
    seen={1.0};rows=analysis.dense_neighbors(path,directory,1.0,3,seen,threading.Event())
    assert any(abs(r['time']-1.1)<.001 for r in rows)
    assert rows==sorted(rows,key=lambda row:row['time'])
    with Image.open(rows[0]['path']) as picture:assert picture.size==(640,360)
    cancelled=threading.Event();cancelled.set()
    with pytest.raises(QueueCancelled):analysis.dense_neighbors(path,directory,2,3,seen,cancelled)


def test_local_only_model_runtime(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(analysis,'settings',SimpleNamespace(ollama_base_url='https://external.example'))
    with pytest.raises(ValueError,match='loopback'):analysis.local_runtime()


def test_local_evidence_contract_rejects_hallucinated_link_and_cleans_at_route(paths,monkeypatch):
    tmp,root=paths;capture(root,brief=True)
    async def prepare(*args):pass
    monkeypatch.setattr(analysis,'prepare_runtime',prepare)
    async def model(name,prompt,event,image=None,tokens=650,**kwargs):
        if image is not None:return 'Local tool demo; github.com/fixture/brief-tool' if 'EXACTLY' in prompt else 'Local tool demo; github.com/fixture/[unreadable]'
        if prompt.startswith('Extract only'):
            group=json.loads(prompt.rsplit('\n',1)[1]);row=group[0]
            return json.dumps({'selected':[{'id':row['id'],'quote':row['text'][:120]}]})
        if prompt.startswith('Check each'):return '{"supported":true}'
        return json.dumps({'sentences':[{'text':'The creator demonstrates a local tool.','evidence':[{'id':'caption','quote':'demonstrates a local tool'}]},
              {'text':'The creator describes the tool in a short demonstration.','evidence':[{'id':'caption','quote':'A creator demonstrates'}]}]})
    monkeypatch.setattr(analysis.video_analysis,'complete',model)
    result=asyncio.run(analysis.analyze(WF,'fixture','small',threading.Event(),lambda _:None))
    # Full-frame OCR alone supplied a plausible URL. Native crops did NOT confirm it.
    assert result['repository'] is None and result['summary'].count('.')==2
    assert (root/WF/'analysis'/'evidence.json').exists()


def app():
    server=FastAPI();server.include_router(router);server.add_middleware(SessionGuard);return server


def test_native_auth_and_mismatch_fail_without_analysis(paths,monkeypatch):
    calls=[]
    async def worker(*args):calls.append(1);raise RuntimeError('Cookie SECRET private path')
    monkeypatch.setattr(analysis,'analyze',worker)
    with TestClient(app(),base_url='http://127.0.0.1:8000') as client:
        assert client.get('/reels/state').status_code==403
        client.headers.update({'X-LAW-Session':'test-session-token'})
        assert client.get('/reels/state').status_code==403
        client.headers.update({'X-Local-Files':'fixture-native'})
        batch=client.post('/reels/batches',json=BODY).json()
        url=f'/reels/batches/{batch["id"]}/items/0/analyze'
        assert client.post(url,json={'workflowId':WF,'capturedUrl':'https://www.instagram.com/reel/other/'}).status_code==400
        assert not calls


def test_saved_result_then_cleanup_cancel_and_failure(paths,monkeypatch):
    tmp,root=paths
    headers={'X-LAW-Session':'test-session-token','X-Local-Files':'fixture-native'}
    async def worker(*args):return {'summary':'The creator demonstrates a tool. They describe a local capability.','repository':None}
    monkeypatch.setattr(analysis,'analyze',worker)
    with TestClient(app(),base_url='http://127.0.0.1:8000',headers=headers) as client:
        batch=client.post('/reels/batches',json=BODY).json();folder=capture(root)
        url=f'/reels/batches/{batch["id"]}/items/0/analyze';payload={'workflowId':WF,'capturedUrl':BODY['reels'][0]}
        assert client.post(url,json=payload).status_code==200
        assert not folder.exists() and len(client.get('/reels/state').json()['summaries'])==1
        assert client.post(url,json=payload).json()['duplicate']
        assert client.post('/reels/clear-cache',json={}).status_code==200
        assert len(client.get('/reels/state').json()['summaries'])==1
        async def fail(*args):raise RuntimeError('Cookie SECRET private path')
        monkeypatch.setattr(analysis,'analyze',fail)
        batch=client.post('/reels/batches',json={**BODY,'reels':['https://www.instagram.com/reel/failed/']}).json();folder=capture(root)
        response=client.post(f'/reels/batches/{batch["id"]}/items/0/analyze',json={**payload,'capturedUrl':'https://www.instagram.com/reel/failed/'})
        assert response.status_code==400 and 'SECRET' not in response.text and not folder.exists()


def test_cancel_retains_worker_lease_until_exit_then_cleans_without_a_summary(paths,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    tmp,root=paths;entered=threading.Event();release=threading.Event();exited=threading.Event()
    async def worker(wf,vision,whisper,event,report,summary=None):
        entered.set()
        while not release.is_set():await asyncio.sleep(.01)
        assert event.is_set();exited.set();raise QueueCancelled()
    monkeypatch.setattr(analysis,'analyze',worker)
    headers={'X-LAW-Session':'test-session-token','X-Local-Files':'fixture-native'}
    with TestClient(app(),base_url='http://127.0.0.1:8000',headers=headers) as client,ThreadPoolExecutor() as pool:
        batch=client.post('/reels/batches',json=BODY).json();folder=capture(root)
        url=f'/reels/batches/{batch["id"]}/items/0/analyze';payload={'workflowId':WF,'capturedUrl':BODY['reels'][0]}
        pending=pool.submit(client.post,url,json=payload);assert entered.wait(5)
        assert client.post(f'/reels/batches/{batch["id"]}/cancel').json()['stopping']
        assert client.post('/reels/clear-cache',json={}).status_code==409 and folder.exists()
        assert client.post(url,json=payload).status_code==409
        release.set();assert pending.result(5).status_code==499 and exited.is_set()
        assert not folder.exists() and not client.get('/reels/state').json()['summaries']
        assert client.get('/reels/state').json()['processing']==[]
        assert client.post('/reels/clear-cache',json={}).status_code==200
