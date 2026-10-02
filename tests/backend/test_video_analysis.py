import asyncio
import json
import threading

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services import video_analysis, local_video, local_files
from services.request_queue import QueueCancelled
from routes.local_files import router
from test_local_files import make_video


def test_streamed_description_uses_images_and_untrusted_data_instructions(monkeypatch):
    captured=[]
    def respond(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200,text='\n'.join(json.dumps(row) for row in [
            {'message':{'content':'A red object '}},{'message':{'content':'is on the left.'},'done':True}]))
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(respond),**kw))
    result=asyncio.run(video_analysis.describe(b'picture','model',threading.Event(),1.25,'Describe the objects'))
    assert result=='A red object is on the left.'
    assert captured[0]['messages'][1]['images']
    assert '1.250' in captured[0]['messages'][1]['content']
    assert 'untrusted source data' in captured[0]['messages'][0]['content']


@pytest.mark.parametrize('payload',[{'done':True,'message':{'content':''}},{'message':{'content':'Incomplete'}},{'error':'Model is unavailable'}])
def test_empty_or_truncated_stream_is_not_success(monkeypatch,payload):
    original=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(lambda _:httpx.Response(200,text=json.dumps(payload))),**kw))
    with pytest.raises(ValueError):asyncio.run(video_analysis.complete('model','prompt',threading.Event()))


def test_stop_during_first_token_wait_closes_stream(monkeypatch):
    started=threading.Event();closed=[]
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):closed.append(True)
        def stream(self,*args,**kwargs):return self
        def raise_for_status(self):pass
        async def aiter_lines(self):
            started.set();await asyncio.sleep(60);yield ''
    monkeypatch.setattr(httpx,'AsyncClient',Client)
    async def scenario():
        stop=threading.Event();task=asyncio.create_task(video_analysis.complete('model','prompt',stop))
        while not started.is_set():await asyncio.sleep(.01)
        stop.set()
        with pytest.raises(QueueCancelled):await asyncio.wait_for(task,1)
    asyncio.run(scenario());assert closed


def test_analyze_samples_whole_video_and_full_does_not_reuse_stale_selection(tmp_path,monkeypatch):
    path=tmp_path/'video.mp4';make_video(path,gop=300)
    opened=local_files.open_file(path);item=local_files.get(opened['id']);old=item.data['frames'][0]['id']
    assert len(item.data['frames'])==1
    received=[]
    async def analyze(frames,directory,model,limit,cancel,report,focus,transcript,analysis):
        received.append(frames)
        analysis.update(status='complete',summary='Descriptive summary',observations=[{'id':f['id'],'time':f['time'],'text':'A visible object.'} for f in frames[:limit]])
    monkeypatch.setattr(local_video,'vision',analyze)
    app=FastAPI();app.include_router(router)
    try:
        with TestClient(app) as client:
            assert client.post(f'/local-files/{item.id}/video',json={'operation':'vision'}).status_code==400
            extracted=client.post(f'/local-files/{item.id}/video',json={'operation':'frames','keyframes':True}).json()['data']
            assert len(extracted['frames'])==1 and extracted['sampling']=='keyframes'
            assert 'compression keyframes, not scene changes' in extracted['note']
            response=client.post(f'/local-files/{item.id}/video',json={'operation':'vision','model':'test','keyframes':True})
            assert response.json()['data']['analysis']['summary']=='Descriptive summary'
            assert response.json()['data']['sampling']=='timed'
            assert len(received[-1])>1 and received[-1][-1]['time']>2
            response=client.post(f'/local-files/{item.id}/video',json={'operation':'full','model':'test','frame_ids':[old],'keyframes':True})
            assert response.status_code==200 and len(received[-1])>1
            assert response.json()['data']['sampling']=='timed'
    finally:local_files.close(item.id)
