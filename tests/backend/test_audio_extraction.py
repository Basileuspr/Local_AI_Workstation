from fractions import Fraction
import io
from pathlib import Path
import threading
from uuid import uuid4

import pytest
av = pytest.importorskip('av')
np = pytest.importorskip('numpy')
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.audio import router
from routes import audio_extraction as routes
from services import audio_extraction as extraction
from services.audio import AudioError


def media(path, tracks=1, video=True, seconds=.4, rate=48000):
    """Small real video/audio fixture, with a different tone in each track."""
    with av.open(str(path),'w') as container:
        container.metadata['title'] = 'Private fixture metadata'
        if video:
            v = container.add_stream('libvpx' if path.suffix == '.webm' else 'mpeg4',rate=10)
            v.width = v.height = 32
            v.pix_fmt = 'yuv420p'
        streams = [container.add_stream('libopus' if path.suffix == '.webm' else 'aac',rate=rate) for _ in range(tracks)]
        for stream in streams:
            stream.layout = 'stereo'
        if video:
            for i in range(max(1,int(seconds*10))):
                frame = av.VideoFrame.from_ndarray(np.zeros((32,32,3),dtype=np.uint8),format='rgb24')
                frame.pts = i
                for packet in v.encode(frame): container.mux(packet)
            for packet in v.encode(None): container.mux(packet)
        for index,stream in enumerate(streams):
            values = np.sin(np.arange(int(seconds*rate))*2*np.pi*(440+440*index)/rate).astype('float32')*.2
            for start in range(0,len(values),1024):
                frame = av.AudioFrame.from_ndarray(np.stack([values[start:start+1024]]*2),format='fltp',layout='stereo')
                frame.sample_rate = rate
                frame.pts = start
                frame.time_base = Fraction(1,rate)
                for packet in stream.encode(frame): container.mux(packet)
            for packet in stream.encode(None): container.mux(packet)


def decoded(path):
    with av.open(str(path)) as container:
        assert len(container.streams.audio) == 1 and not container.streams.video
        assert 'Private fixture metadata' not in str(container.metadata)
        resampler = av.AudioResampler(format='fltp',layout='mono',rate=48000)
        values = []
        for frame in container.decode(audio=0):
            frame.pts = None
            values.extend(item.to_ndarray().reshape(-1) for item in resampler.resample(frame))
        values.extend(item.to_ndarray().reshape(-1) for item in resampler.resample(None))
        return np.concatenate(values)


@pytest.fixture
def source(tmp_path):
    path = tmp_path/'sample.mp4'; media(path,tracks=2)
    return path


@pytest.mark.parametrize('output_format',['mp3','wav','m4a','flac'])
def test_real_extraction_preserves_source_and_selects_audio_track(source,tmp_path,output_format):
    original = source.read_bytes()
    output = tmp_path/('extracted.'+output_format)
    info = extraction.extract(source,output,output_format,1,str(uuid4()),threading.Event())
    values = decoded(output)
    peak = np.fft.rfftfreq(len(values),1/48000)[np.argmax(abs(np.fft.rfft(values)))]
    assert peak == pytest.approx(880,abs=12)
    assert len(values)/48000 == pytest.approx(.4,abs=.1)
    assert info['audio_tracks'] == 2 and info['track'] == 2 and info['channels'] == 2
    assert info['bytes'] == output.stat().st_size and not extraction.status()['busy']
    assert original == source.read_bytes()


def test_audio_only_and_lower_sample_rate(tmp_path):
    source = tmp_path/'audio.m4a';media(source,video=False,rate=16000)
    for kind in extraction.FORMATS:
        output = tmp_path/('out.'+kind)
        extraction.extract(source,output,kind,0,str(uuid4()),threading.Event())
        assert len(decoded(output)) > 48000*.3


@pytest.mark.parametrize('extension',['mov','mkv','webm','avi'])
def test_other_video_containers(tmp_path,extension):
    source = tmp_path/('video.'+extension); media(source)
    output = tmp_path/'sound.wav'
    extraction.extract(source,output,'wav',0,'id',threading.Event())
    assert len(decoded(output)) > 48000*.3


def test_cancellation_during_encoding_and_busy_lock(source,tmp_path):
    class CancelDuringEncoding:
        checks = 0
        def is_set(self):
            self.checks += 1
            return self.checks > 8
    with pytest.raises(AudioError,match='cancelled'):
        extraction.extract(source,tmp_path/'out.wav','wav',0,'id',CancelDuringEncoding())
    assert not extraction.status()['busy'] and extraction.status()['progress'] is None
    with extraction._lock:
        with pytest.raises(AudioError,match='busy'):
            extraction.extract(source,tmp_path/'out.wav','wav',0,'id',threading.Event())


def test_disconnected_request_cancels_worker_and_removes_files(monkeypatch):
    import asyncio
    from starlette.datastructures import UploadFile
    started = threading.Event()
    paths = []
    class Request:
        async def is_disconnected(self): return started.is_set()
    def worker(source,output,kind,track,request_id,cancelled):
        paths.append(source.parent); started.set()
        assert cancelled.wait(3), 'Disconnect did not reach the worker'
        raise AudioError('Audio extraction cancelled.',499)
    monkeypatch.setattr(extraction,'extract',worker)
    with pytest.raises(routes.HTTPException) as failure:
        asyncio.run(routes.extract(Request(),UploadFile(io.BytesIO(b'fixture'),filename='sample.mp4'),'mp3',1,uuid4()))
    assert failure.value.status_code == 499
    assert paths and not paths[0].exists()


def test_no_audio_invalid_track_and_corrupt_media(source,tmp_path):
    output = tmp_path/'out.wav'
    with pytest.raises(AudioError,match='2 audio track'):
        extraction.extract(source,output,'wav',2,'id',threading.Event())
    silent = tmp_path/'silent.mp4';media(silent,tracks=0)
    with pytest.raises(AudioError,match='no audio track'):
        extraction.extract(silent,output,'wav',0,'id',threading.Event())
    bad = tmp_path/'bad.mp4';bad.write_bytes(b'not a video')
    with pytest.raises(AudioError,match='Could not extract'):
        extraction.extract(bad,output,'wav',0,'id',threading.Event())
    assert not extraction.status()['busy']


def test_bounds_and_cancellation_release_lock(source,tmp_path,monkeypatch):
    output = tmp_path/'out.wav';cancelled = threading.Event();cancelled.set()
    with pytest.raises(AudioError,match='cancelled'):
        extraction.extract(source,output,'wav',0,'id',cancelled)
    assert not extraction.status()['busy']
    monkeypatch.setattr(extraction,'MAX_SECONDS',.1)
    with pytest.raises(AudioError,match='2 hours'):
        extraction.extract(source,output,'wav',0,'id',threading.Event())
    monkeypatch.setattr(extraction,'MAX_SECONDS',7200)
    monkeypatch.setattr(extraction,'MAX_OUTPUT_BYTES',100)
    with pytest.raises(AudioError,match='250 MB'):
        extraction.extract(source,output,'wav',0,'id',threading.Event())
    assert not extraction.status()['busy']


@pytest.fixture
def client():
    app = FastAPI(); app.include_router(router)
    return TestClient(app)


def test_real_api_download_and_failure_remove_temporary_files(client,source,monkeypatch):
    paths = []
    original = routes.TemporaryDirectory
    def temporary(**kwargs):
        value = original(**kwargs); paths.append(Path(value.name)); return value
    monkeypatch.setattr(routes,'TemporaryDirectory',temporary)
    options = {'request_id':str(uuid4()),'output_format':'wav','track':2}
    response = client.post('/audio/extract',files={'file':('../../sample.mp4',source.read_bytes())},data=options)
    assert response.status_code == 200 and response.content.startswith(b'RIFF')
    assert response.headers['content-type'] == 'audio/wav'
    assert 'X-Audio-Extraction' in response.headers['access-control-expose-headers']
    assert not paths[-1].exists()
    response = client.post('/audio/extract',files={'file':('bad.mp4',b'bad')},data=options)
    assert response.status_code == 400 and not paths[-1].exists()
    monkeypatch.setattr(extraction,'MAX_INPUT_BYTES',2)
    response = client.post('/audio/extract',files={'file':('sample.mp4',b'123')},data=options)
    assert response.status_code == 413 and not paths[-1].exists()


@pytest.mark.parametrize('name,body,extra,code',[
    ('x.exe',b'x',{},400),('x.mp4',b'',{},400),('x.mp4',b'x',{'output_format':'exe'},400),
    ('x.mp4',b'x',{'track':0},422),('x.mp4',b'x',{'request_id':'../other'},422),
])
def test_api_input_validation(client,name,body,extra,code):
    response = client.post('/audio/extract',files={'file':(name,body)},data={'request_id':str(uuid4()),**extra})
    assert response.status_code == code


def test_disconnected_download_still_cleans_files(tmp_path):
    import asyncio
    class Temporary:
        def __init__(self): self.cleaned = False
        def cleanup(self): self.cleaned = True
    temporary = Temporary(); path = tmp_path/'out.mp3';path.write_bytes(b'fixture')
    response = routes.ExtractionResponse(path,temporary=temporary)
    async def send(message): raise OSError('Client disconnected')
    async def receive(): return {'type':'http.disconnect'}
    with pytest.raises(OSError):
        asyncio.run(response({'type':'http','method':'GET','headers':[],'asgi':{'spec_version':'2.4'}},receive,send))
    assert temporary.cleaned
