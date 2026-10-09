import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from routes.browser_media import router
from services import browser_media
from services.request_queue import QueueCancelled
from services.request_queue import queue
from services.session_guard import SessionGuard
from test_local_files import make_video

IDENTIFIER='a'*32


@pytest.fixture
def media(tmp_path, monkeypatch):
    root=tmp_path/'media';folder=root/IDENTIFIER;folder.mkdir(parents=True)
    monkeypatch.setenv('LAW_BROWSER_WORKFLOW_DIR',str(root))
    monkeypatch.setenv('LAW_LOCAL_FILES_TOKEN','fixture-native')
    file=folder/'video.bin'
    # Extension-free browser downloads are decoded through restricted demuxers.
    source=folder/'fixture.mp4';make_video(source,audio=True);source.rename(file)
    (folder/'captions.json').write_text(json.dumps({'status':'complete','description':'Fixture clip',
        'tracks':[{'kind':'captions','language':'en','text':'WEBVTT\n\n00:00.000 --> 00:02.500\nFixture speech\n'}]}))
    expected={'duration':3,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
    return folder,expected


def test_full_video_audio_and_caption_handoff(media):
    folder,expected=media
    result=browser_media.verify(IDENTIFIER,expected,threading.Event())
    assert result['completeness']=='complete' and result['decodedFrames']==30
    assert result['audio']=='complete' and (folder/'audio.m4a').stat().st_size>0
    assert result['videoRef']==f'browser-media:{IDENTIFIER}:video'
    assert result['captionRef']==f'browser-media:{IDENTIFIER}:captions'
    assert str(folder) not in json.dumps(result)
    assert browser_media.resolve_reference(result['videoRef'])==folder/'video.bin'
    assert browser_media.resolve_reference(result['audioRef'])==folder/'audio.m4a'


def test_size_hash_duration_truncated_stream_and_cancellation_fail_closed(media):
    folder,expected=media
    for changes in [{'bytes':expected['bytes']+1},{'sha256':'0'*64},{'duration':9}]:
        with pytest.raises(ValueError):browser_media.verify(IDENTIFIER,{**expected,**changes},threading.Event())
    event=threading.Event();event.set()
    with pytest.raises(QueueCancelled):browser_media.verify(IDENTIFIER,expected,event)
    assert not list(folder.glob('*.m4a'))
    file=folder/'video.bin';file.write_bytes(file.read_bytes()[:file.stat().st_size//2])
    truncated={**expected,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
    with pytest.raises(Exception):browser_media.verify(IDENTIFIER,truncated,threading.Event())
    assert not list(folder.glob('*.m4a'))


def test_routes_require_session_and_native_authority_and_never_accept_paths(media):
    folder,expected=media
    app=FastAPI();app.include_router(router);app.add_middleware(SessionGuard)
    with TestClient(app,base_url='http://127.0.0.1:8000') as client:
        endpoint=f'/browser-media/{IDENTIFIER}/verify'
        assert client.post(endpoint,json=expected).status_code==403
        headers={'X-LAW-Session':'test-session-token'}
        assert client.post(endpoint,json=expected,headers=headers).status_code==403
        headers['X-Local-Files']='fixture-native'
        assert client.post(endpoint,json={**expected,'path':str(folder)},headers=headers).status_code==422
        response=client.post(endpoint,json=expected,headers=headers)
        assert response.status_code==200,response.text
        assert response.json()['completeness']=='complete'
        asset=client.get(f'/browser-media/{IDENTIFIER}/audio',headers=headers)
        assert asset.status_code==200 and asset.headers['cache-control']=='no-store'
        assert client.get(f'/browser-media/{IDENTIFIER}/audio',headers={'X-LAW-Session':'test-session-token'}).status_code==403
        assert client.post('/browser-media/not-an-id/verify',json=expected,headers=headers).status_code==400


def test_directory_and_asset_traversal_rejected(media):
    for identifier in ['../secret','A'*32,'a'*33]:
        with pytest.raises(ValueError):browser_media.directory(identifier)
    with pytest.raises(ValueError):browser_media.asset(IDENTIFIER,'../../secret')
    with pytest.raises(ValueError,match='verification'):browser_media.resolve_reference(f'browser-media:{IDENTIFIER}:video')


def test_opaque_silent_video_reports_absent_audio(media):
    folder,expected=media
    source=folder/'silent.mp4';make_video(source,audio=False);source.replace(folder/'video.bin')
    data=(folder/'video.bin').read_bytes()
    result=browser_media.verify(IDENTIFIER,{**expected,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()},threading.Event())
    assert result['completeness']=='complete' and result['audio']=='absent' and result['audioRef'] is None


def test_backend_cancel_waits_for_worker_exit_and_releases_cpu_lane(media,monkeypatch):
    folder,expected=media
    entered=threading.Event();exited=threading.Event()
    def worker(identifier,body,cancel,report):
        entered.set();assert cancel.wait(5);exited.set();raise QueueCancelled()
    monkeypatch.setattr(browser_media,'verify',worker)
    app=FastAPI();app.include_router(router);app.add_middleware(SessionGuard)
    headers={'X-LAW-Session':'test-session-token','X-Local-Files':'fixture-native'}
    with TestClient(app,base_url='http://127.0.0.1:8000',headers=headers) as client, ThreadPoolExecutor() as executor:
        pending=executor.submit(client.post,f'/browser-media/{IDENTIFIER}/verify',json=expected)
        assert entered.wait(5)
        assert client.post(f'/browser-media/{IDENTIFIER}/cancel').json()['stopping']
        assert pending.result(5).status_code==499 and exited.is_set()
        job=queue.find(kind='browser-media',request_id=IDENTIFIER,include_finished=True)
        assert job.status=='cancelled' and job.cpu_lane=='local-video' and not job.requires_gpu
        assert not browser_media.cancel(IDENTIFIER)


def test_verifier_errors_never_expose_paths_or_secrets_in_api_or_queue(media,monkeypatch):
    folder,expected=media
    def fail(*args):raise RuntimeError('Cookie: SECRET C:/private/user/path')
    monkeypatch.setattr(browser_media,'verify',fail)
    app=FastAPI();app.include_router(router);app.add_middleware(SessionGuard)
    headers={'X-LAW-Session':'test-session-token','X-Local-Files':'fixture-native'}
    with TestClient(app,base_url='http://127.0.0.1:8000',headers=headers) as client:
        response=client.post(f'/browser-media/{IDENTIFIER}/verify',json=expected)
        assert response.status_code==400 and 'SECRET' not in response.text and 'private/user' not in response.text
        job=queue.find(kind='browser-media',request_id=IDENTIFIER,include_finished=True)
        assert 'SECRET' not in job.error and job.status=='failed'
