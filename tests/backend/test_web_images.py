import asyncio
import io

import httpx
import pytest
from fastapi import FastAPI
from PIL import Image

from services import image_store, image_vault
from services.web_access import WebAccess
from test_web_access import public_dns, run, service

URL = "https://pages.example.com/chapter/"


@pytest.fixture(autouse=True)
def isolated_images(tmp_path, monkeypatch):
    monkeypatch.setattr(image_store, "BLOBS_DIR", tmp_path / "blobs")
    monkeypatch.setattr(image_vault, "ROOT", tmp_path / "vault")


def raster(color="red", format="PNG"):
    output = io.BytesIO()
    Image.new("RGB", (12, 50), color).save(output, format=format)
    return output.getvalue()


def page_handler(html, image_handler=None):
    def respond(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text="User-agent: *\nAllow: /\n")
        if request.url.path == "/chapter/":
            return httpx.Response(200, headers={"content-type": "text/html"}, text=html)
        if image_handler:
            return image_handler(request)
        return httpx.Response(200, headers={"content-type": "image/png"}, content=raster())
    return respond


def test_image_only_page_order_lazy_srcset_and_offline_reuse(tmp_path):
    html = '''<html><head><title>Chapter</title><base href="https://cdn.example.com/images/"></head><body>
        <nav><img src="/logo.png"></nav>
        <img src="data:image/gif;base64,AAAA" data-src="01.png" alt="Panel 1">
        <img src="placeholder.png" data-lazy-src="02.png" alt="Panel 2">
        <img srcset="03-small.png 200w, 03.png 800w" alt="Panel 3">
        <img src="01.png"><script><img src="evil.png"></script></body></html>'''
    manager, clock, requests = service(tmp_path, page_handler(html))
    result = run(manager.fetch(URL, {}))
    assert result["text"] == ""
    assert result["images_found"] == 3
    assert [i["source_url"] for i in result["images"]] == [f"https://cdn.example.com/images/0{i}.png" for i in range(1, 4)]
    assert [i["name"] for i in result["images"]] == ["Panel 1", "Panel 2", "Panel 3"]
    assert all(i["width"] == 12 and i["height"] == 50 for i in result["images"])
    assert all(image_store.get_bytes(i["src"])[0] == raster() for i in result["images"])
    assert all(b[0] - a[0] >= 10 for a, b in zip(requests, requests[1:]))
    assert all(request.url.host == "93.184.216.34" for _, request in requests)
    fresh, _, _ = service(tmp_path, lambda _: pytest.fail("Offline cache must not contact the site"))
    fresh.now = clock.now
    assert run(fresh.fetch(URL, {}))["cached"] is True


def test_text_only_mode_avoids_assets_and_has_separate_cache(tmp_path):
    manager, _, requests = service(tmp_path, page_handler('<body>Words<img src="/image.png"></body>'))
    text = run(manager.fetch(URL, {}, include_images=False))
    assert text["images"] == []
    assert len(requests) == 2
    images = run(manager.fetch(URL, {}))
    assert len(images["images"]) == 1
    assert images["id"] != text["id"]


@pytest.mark.parametrize("target", ["https://127.0.0.1/secret", "http://cdn.example.com/a", "https://169.254.169.254/", "file:///C:/secret"])
def test_unsafe_image_redirect_preserves_text_and_never_reaches_target(tmp_path, target):
    manager, _, requests = service(tmp_path, page_handler('<body>Words<img src="/image.png"></body>',
        lambda _: httpx.Response(302, headers={"location": target})))
    result = run(manager.fetch(URL, {}))
    assert result["text"] == "Words"
    assert not result["images"]
    assert "not allowed" in result["image_warnings"][0]
    assert len(requests) == 3


def test_image_host_private_dns_is_never_contacted(tmp_path):
    manager, _, requests = service(tmp_path, page_handler('<body>Words<img src="https://cdn.example.com/i.png"></body>'))
    async def dns(host):
        return ["10.0.0.1"] if host == "cdn.example.com" else ["93.184.216.34"]
    manager.resolver = dns
    result = run(manager.fetch(URL, {}))
    assert not result["images"]
    assert "private" in result["image_warnings"][0]
    assert all(req.headers["host"] == "pages.example.com" for _, req in requests)


def test_image_robots_disallow(tmp_path):
    handler = page_handler('<body>Words<img src="https://cdn.example.com/i.png"></body>')
    def respond(request):
        if request.headers["host"] == "cdn.example.com":
            assert request.url.path == "/robots.txt"
            return httpx.Response(200, text="User-agent: *\nDisallow: /\n")
        return handler(request)
    manager, _, _ = service(tmp_path, respond)
    result = run(manager.fetch(URL, {}))
    assert not result["images"]
    assert "robots" in result["image_warnings"][0]


@pytest.mark.parametrize("content_type,body", [("image/svg+xml", b"<svg/>"), ("text/html", b"<script/>"), ("image/png", b"not a png")])
def test_non_raster_or_invalid_bytes_not_saved(tmp_path, content_type, body):
    manager, _, _ = service(tmp_path, page_handler('<body>Words<img src="/i.png"></body>',
        lambda _: httpx.Response(200, headers={"content-type": content_type}, content=body)))
    result = run(manager.fetch(URL, {}))
    assert result["images"] == []
    assert len(result["image_warnings"]) == 1
    assert not list((tmp_path / "blobs").glob("*"))


def test_failed_middle_image_keeps_reading_order(tmp_path):
    def response(request):
        if request.url.path == "/2.png":
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": "image/png"}, content=raster())
    manager, _, _ = service(tmp_path, page_handler('<body>Words<img src="/1.png"><img src="/2.png"><img src="/3.png"></body>', response))
    result = run(manager.fetch(URL, {}))
    assert [i["order"] for i in result["images"]] == [1, 3]
    assert result["image_warnings"] == ["Image 2: Image was not found (404)."]


def test_slow_image_does_not_discard_other_images(tmp_path):
    def response(request):
        if request.url.path == "/1.png":
            raise TimeoutError()
        return httpx.Response(200, headers={"content-type": "image/png"}, content=raster())
    manager, _, _ = service(tmp_path, page_handler('<body>Words<img src="/1.png"><img src="/2.png"></body>', response))
    result = run(manager.fetch(URL, {}))
    assert [image["order"] for image in result["images"]] == [2]
    assert "deadline" in result["image_warnings"][0]


def test_hourly_limit_preserves_downloaded_images(tmp_path):
    from services.web_access import atomic_json
    manager, clock, requests = service(tmp_path, page_handler('<body>Words<img src="/1.png"><img src="/2.png"></body>'))
    atomic_json(tmp_path / "limits.json", {"requests": [clock.now()] * 27, "next_at": 0, "blocked_until": 0})
    result = run(manager.fetch(URL, {}))
    assert len(result["images"]) == 1
    assert len(requests) == 3
    assert "hourly budget" in result["image_warnings"][-1]


@pytest.mark.parametrize("status", [403, 429, 503])
def test_image_denial_stops_remaining_requests(tmp_path, status):
    manager, _, requests = service(tmp_path, page_handler('<body>Words<img src="/1.png"><img src="/2.png"></body>',
        lambda _: httpx.Response(status)))
    result = run(manager.fetch(URL, {}))
    assert not result["images"]
    assert len(requests) == 3
    assert "Remaining images" in result["image_warnings"][-1]


def test_count_pixel_and_byte_limits(tmp_path, monkeypatch):
    from services import web_access
    monkeypatch.setattr(web_access, "MAX_IMAGES", 2)
    manager, _, requests = service(tmp_path, page_handler('<body>Words' +
        ''.join(f'<img src="/{i}.png">' for i in range(3)) + '</body>'))
    result = run(manager.fetch(URL, {}))
    assert len(result["images"]) == 2
    assert "first 2" in result["image_warnings"][0]
    monkeypatch.setattr(web_access, "MAX_IMAGE_PIXELS", 10)
    with pytest.raises(web_access.WebError):
        WebAccess._validate_image(raster())
    monkeypatch.setattr(web_access, "MAX_IMAGE_PIXELS", 40_000_000)
    monkeypatch.setattr(web_access, "MAX_IMAGE_TOTAL", len(raster()) + 1)
    manager, _, requests = service(tmp_path / "budget", page_handler('<body>Words<img src="/1.png"><img src="/2.png"><img src="/3.png"></body>'))
    result = run(manager.fetch(URL, {}))
    assert len(result["images"]) == 1
    assert "budget" in result["image_warnings"][-1]
    assert len(requests) == 4


def test_cancel_during_image_fetch_does_not_publish_snapshot(tmp_path):
    async def exercise():
        started, closed = asyncio.Event(), asyncio.Event()
        base = page_handler('<body>Words<img src="/1.png"></body>')
        async def handler(request):
            if request.url.path == "/1.png":
                started.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    closed.set()
            return base(request)
        async def no_wait(_): pass
        manager = WebAccess(tmp_path, httpx.MockTransport(handler), public_dns, sleep=no_wait)
        job = manager.start(URL)
        await started.wait()
        result = await manager.cancel(job["id"])
        assert result["status"] == "cancelled"
        assert closed.is_set()
        assert not list((tmp_path / "cache").glob("*.json"))
    run(exercise())


def test_image_route_and_chat_survive_reopen_and_respect_vault(tmp_path, monkeypatch, sessions_dir):
    from routes import web
    from services import session_store
    reference = image_store.put_bytes(raster())
    session = session_store.create_session()
    session_store.update_session(session["id"], [{"role": "user", "content": "Web source", "imagePreviews": [
        {"id": "web-1", "src": reference, "name": "Panel 1", "source": "web"}]}])
    saved = session_store.get_session(session["id"])
    message = saved["messages"][0]
    assert session_store.get_session_image_by_id(session["id"], message["id"], "web-1")[0] == raster()
    async def exercise():
        app = FastAPI()
        app.include_router(web.router)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
            response = await client.get('/web/images/' + reference[5:])
            assert response.status_code == 200 and response.content == raster()
            assert response.headers["content-type"] == "image/png"
            assert (await client.get('/web/images/not-a-digest')).status_code == 404
            monkeypatch.setattr(image_vault, "is_locked", lambda _: True)
            assert (await client.get('/web/images/' + reference[5:])).status_code == 404
    run(exercise())
