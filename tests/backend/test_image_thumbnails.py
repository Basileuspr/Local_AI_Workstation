from io import BytesIO
from types import SimpleNamespace
import hashlib
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from services import image_thumbnails as thumbs, image_vault as vault
from services.session_guard import SessionGuard


def picture(mode="RGB", size=(1200, 600), color="red", exif=None):
    stream = BytesIO()
    Image.new(mode, size, color).save(stream, "PNG", **({"exif": exif} if exif else {}))
    return stream.getvalue()


@pytest.fixture(autouse=True)
def private_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(vault, "ROOT", tmp_path / "vault")
    thumbs.clear_cache()
    yield
    thumbs.clear_cache()


def test_small_preview_preserves_original_and_uses_bounded_content_cache():
    data = picture(); original = hashlib.sha256(data).hexdigest()
    preview, mime = thumbs.render(data)
    assert Image.open(BytesIO(preview)).size == (320, 160)
    assert mime == "image/jpeg" and len(preview) < len(data)
    assert hashlib.sha256(data).hexdigest() == original
    assert thumbs.render(data) is thumbs.render(data)
    assert thumbs.render(picture(color="blue"))[0] != preview


def test_orientation_transparency_and_animation():
    exif = Image.Exif(); exif[274] = 6
    rotated, _ = thumbs.render(picture(exif=exif))
    assert Image.open(BytesIO(rotated)).size == (160, 320)
    transparent, mime = thumbs.render(picture(mode="RGBA", color=(255, 0, 0, 0)))
    assert mime == "image/png" and Image.open(BytesIO(transparent)).getpixel((0, 0))[3] == 0
    gif = BytesIO(); Image.new("RGB", (20, 10), "red").save(gif, "GIF", save_all=True, append_images=[Image.new("RGB", (20, 10), "blue")])
    first, _ = thumbs.render(gif.getvalue()); assert Image.open(BytesIO(first)).getpixel((0, 0))[0] > 200


def test_cache_respects_current_lock_and_corrupt_policy_even_after_warming(monkeypatch):
    data = picture(); thumbs.render(data)
    def blocked(digest): raise vault.LockedImageError("Locked")
    monkeypatch.setattr(vault, "require_public", blocked)
    with pytest.raises(HTTPException) as error: thumbs.render(data)
    assert error.value.status_code == 403


def test_rechecks_access_after_decode(monkeypatch):
    calls = []
    def changed(digest):
        calls.append(digest)
        if len(calls) > 1: raise vault.LockedImageError("Locked during decode")
    monkeypatch.setattr(vault, "require_public", changed)
    with pytest.raises(HTTPException) as error: thumbs.render(picture())
    assert error.value.status_code == 403 and not thumbs._cache


def test_queued_cached_preview_checks_locks_after_waiting(monkeypatch):
    from contextlib import contextmanager
    data = picture(); thumbs.render(data)
    locked = False
    @contextmanager
    def wait_for_slot():
        nonlocal locked
        locked = True
        yield
    def require_public(digest):
        if locked: raise vault.LockedImageError('Locked while queued')
    monkeypatch.setattr(thumbs, '_slots', wait_for_slot())
    monkeypatch.setattr(vault, 'require_public', require_public)
    with pytest.raises(HTTPException) as error: thumbs.render(data)
    assert error.value.status_code == 403


def test_invalid_and_oversized_images_fail_without_caching(monkeypatch):
    for data in [b"", b"not an image"]:
        with pytest.raises(HTTPException) as error: thumbs.render(data)
        assert error.value.status_code == 422
    monkeypatch.setattr(thumbs, "MAX_PIXELS", 10)
    with pytest.raises(HTTPException): thumbs.render(picture())
    assert not thumbs._cache


def test_cache_item_and_byte_limits(monkeypatch):
    monkeypatch.setattr(thumbs, "CACHE_ITEMS", 2)
    monkeypatch.setattr(thumbs, "CACHE_BYTES", 3000)
    for color in ["red", "blue", "green", "yellow"]: thumbs.render(picture(size=(80, 40), color=color))
    assert len(thumbs._cache) <= 2
    assert thumbs._cache_bytes == sum(len(item[0]) for item in thumbs._cache.values()) <= 3000


@pytest.mark.parametrize("route", ["library", "session", "legacy-session", "web", "face", "lora", "asset", "workflow", "stitched", "converted"])
def test_actual_image_routes_return_small_authenticated_previews_and_originals(route, tmp_path, monkeypatch):
    from routes import image_library, sessions, web, faces, lora, image_workflows, workspaces
    data = picture(); path = tmp_path / "source.png"; path.write_bytes(data)
    monkeypatch.setattr(image_library.library, "image_bytes", lambda identifier: (data, {"type": "image/png"}))
    monkeypatch.setattr(sessions, "get_session_image_by_id", lambda *args: (data, "image/png"))
    monkeypatch.setattr(sessions, "get_session_image", lambda *args: (data, "image/png"))
    monkeypatch.setattr(web.image_store, "get_bytes", lambda *args: (data, "image/png"))
    monkeypatch.setattr(faces.store, "crop_path", lambda *args: path)
    monkeypatch.setattr(lora.lora_store, "image_path", lambda *args: path)
    monkeypatch.setattr(image_workflows.store, "asset_path", lambda *args: (path, SimpleNamespace(media_type="image/png")))
    monkeypatch.setattr(image_workflows.runner, "output_path", lambda *args: (path, {}))
    monkeypatch.setattr(image_workflows.exports, "stitched_path", lambda *args: (path, {"name": "image.png"}))
    monkeypatch.setattr(workspaces.image_conversion, "read", lambda *args: ({"name": "image.png", "format": "png"}, path))
    endpoints = {
        "library": (image_library.router, "/image-library/images/a/content"), "session": (sessions.router, "/sessions/a/images/by-id/b/c"),
        "legacy-session": (sessions.router, "/sessions/a/images/0/0"), "web": (web.router, "/web/images/" + "a" * 64),
        "face": (faces.router, "/faces/datasets/a/faces/b/crop"), "lora": (lora.router, "/lora/projects/a/images/b"),
        "asset": (image_workflows.router, "/image-workflows/a/assets/b"), "workflow": (image_workflows.router, "/image-workflows/a/jobs/b/outputs/c"),
        "stitched": (image_workflows.router, "/image-workflows/a/jobs/b/stitched/grid"), "converted": (workspaces.router, "/workspaces/converted/a"),
    }
    router, endpoint = endpoints[route]
    app = FastAPI(); app.include_router(router); app.add_middleware(SessionGuard)
    client = TestClient(app, base_url="http://127.0.0.1:8000")
    assert client.get(endpoint + "?thumbnail=true").status_code == 403
    preview = client.get(endpoint + "?thumbnail=true&law_token=test-session-token")
    assert preview.status_code == 200, preview.text
    assert preview.headers["cache-control"] == "no-store"
    assert Image.open(BytesIO(preview.content)).size == (320, 160)
    original = client.get(endpoint + "?law_token=test-session-token")
    assert original.status_code == 200 and original.content == data
    assert path.read_bytes() == data
    client.close()
