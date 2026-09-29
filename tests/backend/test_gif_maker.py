import hashlib
import io

import pytest
from fastapi import FastAPI, UploadFile
from fastapi.testclient import TestClient
from PIL import Image
from routes.workspaces import router
from services import gif_maker


def png(color, size=(80, 40)):
    buffer = io.BytesIO()
    Image.new("RGBA", size, color).save(buffer, "PNG")
    return buffer.getvalue()


def upload(raw):
    return UploadFile(io.BytesIO(raw), filename="frame.png")


@pytest.fixture(autouse=True)
def isolate_privacy(monkeypatch):
    monkeypatch.setattr(gif_maker.image_vault, "require_public", lambda _: None)
    from routes import workspaces, request_queue
    from services.request_queue import RequestQueue
    from services.gpu_coordination import GpuCoordinator
    queue = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(workspaces, 'queue', queue)
    monkeypatch.setattr(request_queue, 'queue', queue)
    monkeypatch.setattr(gif_maker, 'progress', gif_maker.GifProgress())


@pytest.mark.parametrize("loop", [True, False])
def test_gif_order_timing_dimensions_background_and_loop(loop):
    raw = [png("red"), png("blue"), png((0, 0, 0, 0))]
    files = [upload(value) for value in raw]
    result = gif_maker.create(files, width=100, height=100, duration=170, loop=loop, background="#00ff00", fit="contain")
    with Image.open(io.BytesIO(result)) as gif:
        assert gif.size == (100, 100)
        assert gif.n_frames == 3
        assert gif.info.get("loop") == (0 if loop else None)
        for i, color in enumerate([(255, 0, 0), (0, 0, 255), (0, 255, 0)]):
            gif.seek(i)
            assert gif.info["duration"] == 170
            assert gif.convert("RGB").getpixel((50, 50)) == color
            assert gif.convert("RGB").getpixel((0, 0)) == (0, 255, 0)
    assert [file.file.getvalue() for file in files] == raw


@pytest.mark.parametrize("settings", [{"width": 0}, {"height": 2048}, {"duration": 55}, {"duration": 20}, {"background": "invalid"}, {"fit": "stretch"}])
def test_rejects_invalid_settings(settings):
    with pytest.raises(ValueError):
        gif_maker.create([upload(png("red")), upload(png("blue"))], **settings)


@pytest.mark.parametrize('size', [(16, 8), (8, 16), (400, 100)])
def test_default_fill_enlarges_and_center_crops_without_borders(size):
    raw = [png('red', size), png('blue', size)]
    result = gif_maker.create([upload(data) for data in raw], width=128, height=128)
    with Image.open(io.BytesIO(result)) as gif:
        for index, color in enumerate([(255, 0, 0), (0, 0, 255)]):
            gif.seek(index)
            assert gif.convert('RGB').getextrema() == tuple((channel, channel) for channel in color)


def test_fill_crops_edges_and_fit_enlarges_small_images():
    source = Image.new('RGB', (100, 50), 'red')
    from PIL import ImageDraw
    ImageDraw.Draw(source).rectangle((25, 0, 74, 49), fill='blue')
    data = io.BytesIO()
    source.save(data, 'PNG')
    for fit in ['cover', 'contain']:
        result = gif_maker.create([upload(data.getvalue()), upload(png('green'))], width=200, height=200, fit=fit)
        with Image.open(io.BytesIO(result)) as gif:
            pixels = gif.convert('RGB')
            assert pixels.getpixel((100, 100)) == (0, 0, 255)
            if fit == 'cover':
                assert pixels.getpixel((10, 10)) == (0, 0, 255)
            else:
                assert pixels.getpixel((10, 60)) == (255, 0, 0)
                assert pixels.getpixel((10, 10)) == (255, 255, 255)


def test_rejects_limits_invalid_and_animated_inputs(monkeypatch):
    with pytest.raises(ValueError, match="2 and 60"):
        gif_maker.create([upload(png("red"))])
    with pytest.raises(ValueError, match="decoded"):
        gif_maker.create([upload(b"not an image"), upload(png("red"))])
    animated = gif_maker.create([upload(png("red")), upload(png("blue"))])
    with pytest.raises(ValueError, match="still"):
        gif_maker.create([upload(animated), upload(png("red"))])
    monkeypatch.setattr(gif_maker, "MAX_TOTAL_BYTES", 10)
    with pytest.raises(ValueError, match="160 MiB"):
        gif_maker.create([upload(png("red")), upload(png("blue"))])


def test_locked_source_is_rejected(monkeypatch):
    red = png("red")
    def guard(digest):
        if digest == hashlib.sha256(red).hexdigest():
            raise ValueError("Locked image")
    monkeypatch.setattr(gif_maker.image_vault, "require_public", guard)
    with pytest.raises(ValueError, match="Locked"):
        gif_maker.create([upload(red), upload(png("blue"))])


def test_http_returns_real_animation_and_validation_errors():
    app = FastAPI()
    app.include_router(router)
    files = [("files", ("red.png", png("red"), "image/png")), ("files", ("blue.png", png("blue"), "image/png"))]
    with TestClient(app) as client:
        response = client.post("/workspaces/gif", files=files, data={"width": 128, "height": 64, "duration": 300, "loop": "false"})
        assert response.status_code == 200
        assert response.headers["content-type"] == "image/gif"
        assert response.headers["cache-control"] == "no-store"
        with Image.open(io.BytesIO(response.content)) as image:
            assert image.n_frames == 2
            assert image.size == (128, 64)
            assert image.info["duration"] == 300
            assert "loop" not in image.info
        assert client.post("/workspaces/gif", files=files[:1]).status_code == 400


def test_reports_real_frame_counts_and_indeterminate_encoding():
    events = []
    gif_maker.create([upload(png('red')), upload(png('blue'))], report=lambda *event: events.append(event))
    assert events == [('Preparing frames', 0, 2), ('Preparing frames', 1, 2), ('Preparing frames', 2, 2),
                      ('Encoding GIF', None, None), ('GIF encoded', 2, 2)]


def test_progress_endpoint_stays_responsive_during_encoding(monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from uuid import uuid4
    reached, resume = threading.Event(), threading.Event()
    original = gif_maker.create
    monkeypatch.setattr(gif_maker, 'progress', gif_maker.GifProgress())
    def slow_create(*args):
        report = args[-1]
        def observed(phase, completed, total):
            report(phase, completed, total)
            if phase == 'Encoding GIF':
                reached.set()
                assert resume.wait(10)
        return original(*args[:-1], report=observed)
    monkeypatch.setattr(gif_maker, 'create', slow_create)
    app = FastAPI()
    app.include_router(router)
    key = str(uuid4())
    files = [('files', ('red.png', png('red'), 'image/png')), ('files', ('blue.png', png('blue'), 'image/png'))]
    with TestClient(app) as client, ThreadPoolExecutor() as pool:
        future = pool.submit(client.post, '/workspaces/gif', files=files, data={'request_id':key})
        try:
            assert reached.wait(10)
            progress = client.get(f'/workspaces/gif/progress/{key}').json()['progress']
            assert progress['phase'] == 'Encoding GIF'
            assert progress['completed'] is None and progress['total'] is None
            assert progress['elapsed_seconds'] >= 0
        finally:
            resume.set()
        assert future.result(timeout=10).status_code == 200
        assert client.get(f'/workspaces/gif/progress/{key}').json()['progress']['phase'] == 'Ready'
        failed_key = str(uuid4())
        assert client.post('/workspaces/gif', files=files[:1], data={'request_id':failed_key}).status_code == 400
        assert client.get(f'/workspaces/gif/progress/{failed_key}').json()['progress']['phase'] == 'Failed'


def test_progress_records_expire_and_duplicate_ids_are_rejected(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(gif_maker.time, 'monotonic', lambda: now[0])
    progress = gif_maker.GifProgress()
    progress.start('one', 2)
    with pytest.raises(ValueError, match='already exists'):
        progress.start('one', 2)
    progress.finish('one', True)
    now[0] += 301
    assert progress.get('one') is None
    for index in range(70):
        progress.start(str(index), 2)
        progress.finish(str(index), True)
    assert len(progress.records) == 64


def test_queue_tracks_gif_waiting_and_running_cancellation(monkeypatch):
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor
    from uuid import uuid4
    from routes.request_queue import router as queue_router
    from routes import workspaces
    reached, resume = threading.Event(), threading.Event()
    original = gif_maker.create
    def slow_create(*args):
        report = args[-1]
        def observed(phase, completed, total):
            report(phase, completed, total)
            if phase == 'Encoding GIF':
                reached.set()
                assert resume.wait(10)
        return original(*args[:-1], report=observed)
    monkeypatch.setattr(gif_maker, 'create', slow_create)
    app = FastAPI()
    app.include_router(router)
    app.include_router(queue_router)
    files = [('files', ('red.png', png('red'), 'image/png')), ('files', ('blue.png', png('blue'), 'image/png'))]
    first_id, second_id = str(uuid4()), str(uuid4())
    with TestClient(app) as client, ThreadPoolExecutor() as pool:
        first = pool.submit(client.post, '/workspaces/gif', files=files, data={'request_id':first_id, 'name':'First animation'})
        try:
            assert reached.wait(10)
            second = pool.submit(client.post, '/workspaces/gif', files=files, data={'request_id':second_id})
            deadline = time.monotonic() + 5
            while workspaces.queue.find(kind='gif', request_id=second_id) is None and time.monotonic() < deadline:
                time.sleep(.01)
            jobs = client.get('/queue').json()['jobs']
            assert [(job['kind'], job['status']) for job in jobs] == [('gif','running'), ('gif','queued')]
            assert jobs[0]['label'] == 'First animation' and jobs[0]['stage'] == 'Encoding GIF'
            assert jobs[1]['position'] == 1 and jobs[1]['cpu_lane'] == 'gif'
            assert client.get('/queue').json()['gpu_owner'] is None
            client.post(f"/queue/{jobs[1]['id']}/cancel")
            assert second.result(timeout=5).status_code == 499
            client.post(f"/queue/{jobs[0]['id']}/cancel")
            assert client.get('/queue').json()['jobs'][0]['status'] == 'cancelling'
            assert not first.done()
        finally:
            resume.set()
        assert first.result(timeout=10).status_code == 499
        assert all(job['status'] == 'cancelled' for job in client.get('/queue').json()['jobs'])
        assert client.get(f'/workspaces/gif/progress/{first_id}').json()['progress']['phase'] == 'Cancelled'
