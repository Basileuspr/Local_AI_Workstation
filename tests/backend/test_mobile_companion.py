import asyncio
import base64
import io
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from services import image_library, image_store, image_vault, session_store
from services.mobile_access import COOKIE, MobileAccess
from services.mobile_api import MAX_BODY, create_mobile_api
from services.mobile_companion import MobileCompanion, MobileListen
from services.mobile_jobs import MobileJobs, MobileSubmission

ORIGIN = "https://desktop.example.ts.net"
HEADERS = {"Origin": ORIGIN, "X-LAW-Mobile": "1"}


@pytest.fixture(autouse=True)
def isolate(sessions_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(image_store, "BLOBS_DIR", tmp_path / "blobs")
    monkeypatch.setattr(image_library, "ROOT", tmp_path / "library")
    monkeypatch.setattr(image_vault, "ROOT", tmp_path / "vault")
    monkeypatch.setattr(image_library, "public_index", lambda: {"images": [], "folders": []})


@pytest.fixture
def service(tmp_path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "index.html").write_text("<h1>Mobile</h1>")
    service = MobileCompanion(tmp_path / "mobile", "http://127.0.0.1:8000", "test-session-token", assets)
    app = create_mobile_api(service.jobs, service.access, ORIGIN, assets)
    with TestClient(app, base_url=ORIGIN) as client:
        yield service, client


def pair(service, client):
    invitation = service.access.invitation()
    response = client.post("/api/pair", json={"code": invitation["code"], "name": "Test phone"}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()["device"], response


def spec(session, **extra):
    return MobileSubmission(kind="chat", model="test-model", prompt="Hello desktop",
        session_id=session["id"], expected_revision=session["revision"], **extra)


def test_gallery_orders_images_by_chat_position_instead_of_random_ids(service):
    service, client = service
    pair(service, client)
    session = session_store.create_session("Image order")
    def ref(color):
        data = io.BytesIO()
        Image.new("RGB", (2, 2), color).save(data, "PNG")
        return image_store.put_bytes(data.getvalue())
    # IDs deliberately disagree with chronological order, including a batch.
    session_store.append_messages(session["id"], [
        {"id": "zzz-old", "role": "assistant", "generatedImages": [{"id": "zzz", "name": "Old.png", "src": ref("blue")}]},
        {"id": "aaa-new", "role": "assistant", "generatedImages": [
            {"id": "zzz-first", "name": "Batch first.png", "src": ref("green")},
            {"id": "aaa-last", "name": "Batch last.png", "src": ref("red")},
        ]},
    ])
    names = lambda query="": [item["name"] for item in client.get("/api/gallery" + query).json()["images"]]
    assert names() == ["Batch last.png", "Batch first.png", "Old.png"]
    assert names("?sort=oldest") == ["Old.png", "Batch first.png", "Batch last.png"]
    session_store.hide_session_image(session["id"], "aaa-last")
    assert names("?source=session&session_id=" + session["id"]) == ["Batch first.png", "Old.png"]


def test_gallery_filters_before_paging_and_normalizes_dates(service, monkeypatch):
    service, client = service
    pair(service, client)
    now = datetime.now(timezone.utc)
    records = [
        {"session_id": "new-chat", "message_id": "a", "image_id": "a", "name": "Zebra.png",
         "session_title": "Nature studies", "updated_at": now.isoformat(), "path": "private-path"},
        {"session_id": "old-chat", "message_id": "b", "image_id": "b", "name": "Bee.png",
         "session_title": "Old studies", "updated_at": (now - timedelta(days=10)).isoformat()},
        {"session_id": "legacy", "message_id": "c", "image_id": "c", "name": "Legacy.png",
         "session_title": "Legacy", "updated_at": "unknown"},
    ]
    monkeypatch.setattr(session_store, "list_session_images", lambda: records)
    saved = (now - timedelta(hours=1)).astimezone(timezone(timedelta(hours=14))).isoformat()
    monkeypatch.setattr(image_library, "public_index", lambda: {"images": [
        {"id": "saved", "name": "Ant.png", "created_at": saved, "path": "private-path"},
        {"id": "review", "name": "Review only.png", "created_at": saved, "review_only": True},
    ]})
    get = lambda query="": client.get("/api/gallery" + query).json()
    assert [item["name"] for item in get()["images"]] == ["Zebra.png", "Ant.png", "Bee.png", "Legacy.png"]
    assert [item["name"] for item in get("?sort=oldest")["images"]] == ["Bee.png", "Ant.png", "Zebra.png", "Legacy.png"]
    assert [item["name"] for item in get("?sort=name_asc&offset=1&limit=2")["images"]] == ["Bee.png", "Legacy.png"]
    assert get("?sort=name_desc")["images"][0]["name"] == "Zebra.png"
    assert get("?source=library")["total"] == 1
    assert get("?source=session&days=7")["total"] == 1
    assert get("?days=1")["total"] == 2
    assert get("?days=30")["total"] == 3
    assert get("?session_id=old-chat")["images"][0]["name"] == "Bee.png"
    assert get("?search=nAtUrE&source=session&limit=1")["total"] == 1
    assert get("?search=ANT&source=library&offset=1&limit=1") == {"images": [], "total": 1}
    assert get("?source=library&session_id=new-chat")["total"] == 0
    assert "private-path" not in json.dumps(get())


@pytest.mark.parametrize("query", ["sort=random", "source=hidden", "session_id=../secret", "days=31"])
def test_gallery_rejects_invalid_filter_values(service, query):
    service, client = service
    pair(service, client)
    assert client.get("/api/gallery?" + query).status_code == 422


def test_pair_cookie_single_use_hashing_expiry_and_revocation(service):
    service, client = service
    assert client.get("/api/state").status_code == 401
    device, response = pair(service, client)
    cookie = response.headers["set-cookie"]
    assert all(value in cookie for value in ("Secure", "HttpOnly", "SameSite=strict", "Path=/"))
    token = client.cookies.get(COOKIE)
    assert token not in service.jobs.store.path.read_bytes().decode("latin1")
    assert client.get("/api/state").status_code == 200
    invitation = service.access.invitation()
    assert client.post("/api/pair", json={"code": invitation["code"], "name": "Second"}, headers=HEADERS).status_code == 200
    assert client.post("/api/pair", json={"code": invitation["code"], "name": "Again"}, headers=HEADERS).status_code == 400
    service.access.revoke(client.get("/api/state").json()["device"]["id"])
    assert client.get("/api/state").status_code == 401
    invitation = service.access.invitation()
    service.access.invite = (service.access.invite[0], time.time() - 1)
    assert client.post("/api/pair", json={"code": invitation["code"], "name": "Expired"}, headers=HEADERS).status_code == 400


def test_gateway_blocks_hosts_origins_csrf_url_secrets_and_unrelated_routes(service):
    service, client = service
    pair(service, client)
    assert client.get("/api/state", headers={"Host": "evil.example"}).status_code == 403
    assert client.get("/api/state", headers={"Origin": "null"}).status_code == 403
    assert client.get("/api/state", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.get("/api/state?law_token=secret").status_code == 400
    assert client.post("/api/sessions", json={}).status_code == 403
    assert client.post("/api/sessions", json={}, headers={"Origin": ORIGIN}).status_code == 403
    assert client.post("/api/sessions", content=b"x" * (MAX_BODY + 1), headers=HEADERS).status_code == 413
    assert client.post("/api/sessions", content="hello", headers=HEADERS).status_code == 415
    for path in ("/health", "/docs", "/openapi.json", "/sessions/list", "/api/vault/unlock", "/api/local-files", "/api/reset", "/assets/../../backend/main.py"):
        assert client.get(path).status_code == 404
    response = client.get("/api/state")
    assert response.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
    assert response.headers["referrer-policy"] == "no-referrer"


def test_pairing_rate_limited(service):
    service, client = service
    for _ in range(12):
        assert client.post("/api/pair", json={"code": "bad", "name": "Phone"}, headers=HEADERS).status_code == 400
    assert client.post("/api/pair", json={"code": "bad", "name": "Phone"}, headers=HEADERS).status_code == 429


def test_model_controls_share_desktop_capabilities_without_paths(service, monkeypatch):
    service, client = service
    pair(service, client)
    async def local(path):
        if path == "/models":
            return {"models": []}
        return {"models": [{"id": "fixture", "name": "Fixture", "path": "private-model-path",
            "dimension_multiple": 8, "supports_long_prompt": True, "supports_lora_training": True,
            "recommended_settings": {"steps": 30, "guidanceScale": 6, "outputDir": "private-output-path"}}],
            "loras": [{"id": "adapter", "base_model_id": "fixture", "name": "Adapter", "trigger_word": "watercolor", "path": "private-adapter-path"}],
            "lora_error": "private-error-path", "runtime": {"ready": True, "python": "private-python-path",
                "resolution_limits": {"standard_max_side": 1024, "extended_max_side": 1536}}}
    monkeypatch.setattr(service.jobs, "local", local)
    response = client.get("/api/models")
    assert response.status_code == 200
    value = response.json()
    assert value["image_models"][0]["recommended_settings"] == {"steps": 30, "guidanceScale": 6}
    assert value["image_loras"][0]["trigger_word"] == "watercolor"
    assert value["image_runtime"]["resolution_limits"]["standard_max_side"] == 1024
    assert "private-" not in response.text


def test_desktop_phone_snapshot_etag_and_cancellation(service, monkeypatch):
    from fastapi import FastAPI
    from routes import mobile
    service, phone = service
    monkeypatch.setattr(mobile, "_instance", service)
    job_id = str(uuid.uuid4())
    service.jobs.store.insert("incoming", job_id, "phone", {"kind": "image", "session_id": "chat", "prompt": "Fixture"})
    calls = []
    async def local(path, method="GET", body=None):
        calls.append((method, path))
        return {"stopped": True}
    monkeypatch.setattr(service.jobs, "local", local)
    app = FastAPI()
    app.include_router(mobile.router)
    with TestClient(app) as desktop:
        response = desktop.get("/mobile/image-tasks")
        assert response.json()["tasks"][0]["status"] == "queued"
        assert desktop.get("/mobile/image-tasks", headers={"If-None-Match": response.headers["etag"]}).status_code == 304
        assert desktop.post(f"/mobile/image-tasks/{job_id}/cancel").status_code == 200
        assert service.jobs.store.job("incoming", job_id)["cancel_requested"]
        assert calls == [("POST", "/image-generation/stop/mobile-" + job_id)]
    pair(service, phone)
    assert phone.get("/mobile/image-tasks").status_code == 404


def test_legacy_receipts_accept_new_default_fields_without_duplicate_work(tmp_path):
    jobs = MobileJobs(tmp_path / "receipts", "http://127.0.0.1:8000", "test-session-token")
    async def scenario():
        session = session_store.create_session()
        payload = spec(session).model_dump()
        for key in ("lora_id", "lora_scale", "long_prompt", "allow_long_wait"):
            payload.pop(key)
        payload.update(width=768, height=768)
        for kind in ("chat", "image"):
            old = {**payload, "kind": kind}
            job_id = str(uuid.uuid4())
            jobs.store.insert("incoming", job_id, "phone", old)
            jobs.store.update("incoming", job_id, status="completed")
            assert (await jobs.submit("phone", job_id, MobileSubmission(**old)))["status"] == "completed"
        assert not jobs.tasks
    asyncio.run(scenario())


def test_gallery_download_is_original_and_hidden_locked_media_are_denied(service):
    service, client = service
    pair(service, client)
    data = io.BytesIO()
    Image.new("RGB", (1200, 800), "green").save(data, "PNG")
    original = data.getvalue()
    session = session_store.create_session()
    session_store.append_messages(session["id"], [{"id": "reply", "role": "assistant", "content": "Image",
        "generatedImages": [{"id": "picture", "name": "Forest.png", "src": "data:image/png;base64," + base64.b64encode(original).decode()}]}])
    gallery = client.get("/api/gallery").json()
    assert gallery["total"] == 1
    url = gallery["images"][0]["url"]
    response = client.get(url + "?download=true&thumbnail=true")
    assert response.content == original
    assert "attachment;" in response.headers["content-disposition"]
    assert Image.open(io.BytesIO(client.get(url + "?thumbnail=true").content)).size == (320, 213)
    visible = client.get("/api/sessions/" + session["id"]).json()
    assert visible["messages"][0]["images"][0]["url"] == url
    assert "blob:" not in json.dumps(visible) and "data:image" not in json.dumps(visible)
    session_store.hide_session_image(session["id"], "picture")
    assert client.get("/api/gallery").json()["total"] == 0
    assert client.get(url).status_code == 404
    session_store.hide_session_image(session["id"], "picture", False)
    # Real vault policy changes must be observed after a warm inventory.
    import hashlib
    from unittest.mock import patch
    with patch.object(image_vault, "locked_hashes", return_value={hashlib.sha256(original).hexdigest()}):
        assert client.get("/api/gallery").json()["total"] == 0
        assert client.get(url).status_code == 404


def test_job_ownership_and_restart_receipts(service, tmp_path):
    service, client = service
    device, _ = pair(service, client)
    session = session_store.create_session()
    job_id = str(uuid.uuid4())
    service.jobs.store.insert("incoming", job_id, "another-device", spec(session).model_dump())
    for suffix in ("", "/events"):
        assert client.get("/api/jobs/" + job_id + suffix).status_code == 404
    assert client.post("/api/jobs/" + job_id + "/cancel", headers=HEADERS).status_code == 404
    assert client.get("/api/state").json()["jobs"] == []
    service.jobs.store.update("incoming", job_id, result={"text": "Partial output"})
    reopened = MobileJobs(service.jobs.store.root, "http://127.0.0.1:8000", "test-session-token")
    record = reopened.store.job("incoming", job_id)
    assert record["status"] == "interrupted" and record["result"]["text"] == "Partial output"


@pytest.mark.parametrize("values", [
    {"address": "0.0.0.0"}, {"address": "8.8.8.8"}, {"address": "169.254.169.254"},
    {"origin": "http://desktop.example.ts.net"}, {"origin": "https://public.example.com"},
    {"origin": "https://desktop.example.ts.net/path"}, {"origin": "https://user:password@desktop.example.ts.net"},
    {"address": "192.168.1.4"}, {"certificate": "certificate.pem"},
])
def test_listener_configuration_fails_closed(values):
    with pytest.raises(ValueError):
        MobileListen(**{"origin": ORIGIN, **values})


def test_listener_is_disabled_by_default_and_requires_build(tmp_path):
    service = MobileCompanion(tmp_path / "mobile", "http://127.0.0.1:8000", "test-session-token", tmp_path / "missing")
    assert not service.running and not service.status()["build_ready"]
    with pytest.raises(ValueError, match="Build"):
        service.start(MobileListen(origin=ORIGIN))
    with pytest.raises(ValueError, match="Start"):
        service.invitation()


def test_chat_uses_real_desktop_queue_saves_once_and_rejects_stale_state(tmp_path, monkeypatch):
    import main
    from fastapi.responses import StreamingResponse
    from services.request_queue import RequestQueue
    from services.gpu_coordination import GpuCoordinator
    queue = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(main, "queue", queue)
    calls = []
    async def prepare(_kind):
        pass
    async def chat(request, _client):
        calls.append(request)
        async def stream():
            yield 'data: {"token":"Hello ","done":false}\n\n'
            yield 'data: {"token":"phone","done":true}\n\n'
        return StreamingResponse(stream(), media_type="text/event-stream")
    monkeypatch.setattr(main, "prepare_runtime", prepare)
    monkeypatch.setattr(main, "_chat", chat)
    jobs = MobileJobs(tmp_path / "mobile", "http://127.0.0.1:8000", "test-session-token", transport=httpx.ASGITransport(app=main.app))

    async def scenario():
        session = session_store.create_session()
        payload = spec(session)
        first, second = str(uuid.uuid4()), str(uuid.uuid4())
        block = queue.enqueue("chat", "Desktop first")
        assert queue.try_start(block)
        await jobs.submit("phone", first, payload)
        await jobs.submit("phone", first, payload)  # lost acknowledgment
        await asyncio.sleep(.05)
        assert not calls and jobs.owned("phone", first)["status"] == "queued"
        with pytest.raises(ValueError):
            await jobs.submit("phone", second, payload)
        # A desktop edit while the generation runs must survive assistant append.
        session_store.append_messages(session["id"], [{"id": "desktop", "role": "user", "content": "Keep this edit"}])
        queue.finish(block)
        await asyncio.wait_for(asyncio.gather(*jobs.tasks.values()), 5)
        assert jobs.owned("phone", first)["status"] == "completed"
        assert len(calls) == 1 and calls[0].session_id == session["id"]
        assert [message.content for message in calls[0].messages] == ["Hello desktop"]
        assert not calls[0].tool_ids and calls[0].use_memory is False
        messages = session_store.get_session(session["id"])["messages"]
        assert [message["content"] for message in messages] == ["Hello desktop", "Keep this edit", "Hello phone"]
        assert (await jobs.submit("phone", first, payload))["status"] == "completed"
        assert len(calls) == 1
        with pytest.raises(session_store.SessionConflict):
            await jobs.submit("phone", second, payload)
        assert jobs.store.job("incoming", second) is None
        assert queue.active is None
    asyncio.run(scenario())


def test_failed_stream_keeps_partial_output_without_completed_chat(tmp_path):
    async def broken(request):
        return httpx.Response(200, text='data: {"token":"Partial"}\n\n', headers={"content-type": "text/event-stream"})
    jobs = MobileJobs(tmp_path / "mobile", "http://127.0.0.1:8000", "test-session-token", transport=httpx.MockTransport(broken))
    async def scenario():
        session = session_store.create_session()
        job_id = str(uuid.uuid4())
        await jobs.submit("phone", job_id, spec(session))
        await asyncio.gather(*jobs.tasks.values())
        record = jobs.owned("phone", job_id)
        assert record["status"] == "failed" and record["result"]["text"] == "Partial"
        assert len(session_store.get_session(session["id"])["messages"]) == 1
    asyncio.run(scenario())


def test_image_uses_existing_tasks_queue_and_persists_gallery_result(tmp_path, monkeypatch):
    import main
    from routes import image_generation
    from services import request_queue
    from services.image_tasks import ImageTasks
    from services.gpu_coordination import GpuCoordinator
    queue = request_queue.RequestQueue(GpuCoordinator())
    tasks = ImageTasks()
    monkeypatch.setattr(image_generation, "queue", queue)
    monkeypatch.setattr(request_queue, "queue", queue)
    monkeypatch.setattr(image_generation, "image_tasks", tasks)
    calls = []
    async def prepare(_kind):
        pass
    def generate(request, *args, **kwargs):
        calls.append(request)
        data = io.BytesIO()
        Image.new("RGB", (request.width, request.height), "purple").save(data, "PNG")
        return {"filename": "Mobile.png", "image_ref": image_store.put_bytes(data.getvalue()), "seed": 42}
    monkeypatch.setattr(image_generation, "prepare_runtime", prepare)
    monkeypatch.setattr(image_generation, "_generate_image", generate)
    jobs = MobileJobs(tmp_path / "mobile", "http://127.0.0.1:8000", "test-session-token", transport=httpx.ASGITransport(app=main.app))
    async def scenario():
        session = session_store.create_session()
        payload = MobileSubmission(kind="image", session_id=session["id"], expected_revision=session["revision"], model="image-model", prompt="A purple scene",
            lora_id="fixture-adapter", lora_scale=.75, long_prompt=False, allow_long_wait=True, steps=200, guidance_scale=5.6, seed=0)
        job_id = str(uuid.uuid4())
        await jobs.submit("phone", job_id, payload)
        await asyncio.wait_for(asyncio.gather(*jobs.tasks.values()), 10)
        assert jobs.owned("phone", job_id)["status"] == "completed"
        assert len(calls) == 1
        assert (calls[0].lora_id, calls[0].lora_scale, calls[0].long_prompt, calls[0].allow_long_wait) == ("fixture-adapter", .75, False, True)
        assert (calls[0].steps, calls[0].guidance_scale, calls[0].seed) == (200, 5.6, 0)
        messages = session_store.get_session(session["id"])["messages"]
        assert len(messages) == 2  # no duplicate request from the image-task service
        images = session_store.list_session_images()
        assert len(images) == 1 and images[0]["name"] == "Mobile.png"
        data, _ = session_store.get_session_image_by_id(session["id"], images[0]["message_id"], images[0]["image_id"])
        assert Image.open(io.BytesIO(data)).size == (1024, 1024)
        snapshot = jobs.image_snapshot()
        assert snapshot["tasks"][0]["request_id"] == "mobile-" + job_id
        assert snapshot["tasks"][0]["result"]["url"].startswith("/sessions/")
        restored = MobileJobs(tmp_path / "mobile", "http://127.0.0.1:8000", "test-session-token")
        assert restored.image_snapshot()["tasks"] == snapshot["tasks"]
        assert (await jobs.submit("phone", job_id, payload))["status"] == "completed"
        assert queue.active is None
    asyncio.run(scenario())


def test_queued_chat_cancellation_is_confirmed_without_result(tmp_path, monkeypatch):
    import main
    from services.request_queue import RequestQueue
    from services.gpu_coordination import GpuCoordinator
    queue = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(main, "queue", queue)
    jobs = MobileJobs(tmp_path / "mobile", "http://127.0.0.1:8000", "test-session-token", transport=httpx.ASGITransport(app=main.app))
    async def scenario():
        session = session_store.create_session()
        blocker = queue.enqueue("chat", "Desktop job")
        queue.try_start(blocker)
        job_id = str(uuid.uuid4())
        await jobs.submit("phone", job_id, spec(session))
        await asyncio.sleep(.05)
        assert (await jobs.cancel("phone", job_id))["status"] == "cancelling"
        await asyncio.wait_for(asyncio.gather(*jobs.tasks.values()), 5)
        assert jobs.owned("phone", job_id)["status"] == "cancelled"
        assert len(session_store.get_session(session["id"])["messages"]) == 1
        queue.finish(blocker)
    asyncio.run(scenario())


def test_mobile_blocks_maintenance_and_maintenance_blocks_mobile(service, monkeypatch):
    from services import maintenance_gate
    from routes import mobile
    from fastapi import HTTPException
    from types import SimpleNamespace
    service, client = service
    pair(service, client)
    monkeypatch.setattr(maintenance_gate.gate, "locked", True)
    monkeypatch.setattr(maintenance_gate.gate, "expires", time.monotonic() + 60)
    assert client.get("/api/state").status_code == 503
    monkeypatch.setattr(maintenance_gate.gate, "locked", False)
    monkeypatch.setattr(mobile, "_instance", SimpleNamespace(running=True))
    monkeypatch.setattr(maintenance_gate, "authorize", lambda _: None)
    with pytest.raises(HTTPException, match="Mobile companion"):
        asyncio.run(maintenance_gate.lock(None))
    assert not maintenance_gate.gate.locked


def test_expired_credentials_and_dismissed_receipts_cannot_be_reused(service):
    service, client = service
    device, _ = pair(service, client)
    session = session_store.create_session()
    job_id = str(uuid.uuid4())
    payload = spec(session).model_dump()
    service.jobs.store.insert("incoming", job_id, device["id"], payload)
    assert client.delete("/api/jobs/" + job_id, headers=HEADERS).status_code == 409
    service.jobs.store.update("incoming", job_id, status="completed", result={"text": "Large result"})
    assert "result" not in json.dumps(client.get("/api/state").json())
    assert client.get("/api/jobs/" + job_id).json()["text"] == "Large result"
    assert client.delete("/api/jobs/" + job_id, headers=HEADERS).status_code == 200
    assert client.get("/api/state").json()["jobs"] == []
    assert client.put("/api/jobs/" + job_id, headers=HEADERS, json=payload).json()["status"] == "failed"
    assert not service.jobs.tasks
    peer = service.jobs.store.peer(device["id"])
    service.jobs.store.save_peer({**peer, "expires": time.time() - 1})
    assert client.get("/api/state").status_code == 401


def test_saved_images_download_reuses_desktop_content_and_checks_current_locks(service, monkeypatch):
    import main
    import hashlib
    service, client = service
    pair(service, client)
    data = io.BytesIO()
    Image.new("RGB", (1024, 768), "blue").save(data, "PNG")
    original = data.getvalue()
    saved = image_library.import_image(original, "Saved original.png", {"kind": "generated"})
    monkeypatch.setattr(image_library, "public_index", lambda: {"images": [saved]})
    service.jobs.transport = httpx.ASGITransport(app=main.app)
    listing = client.get("/api/gallery").json()
    assert listing["total"] == 1
    assert "path" not in listing["images"][0]
    url = listing["images"][0]["url"]
    downloaded = client.get(url + "?download=true&thumbnail=true")
    assert downloaded.status_code == 200 and downloaded.content == original
    assert "Saved%20original.png" in downloaded.headers["content-disposition"]
    monkeypatch.setattr(image_vault, "locked_hashes", lambda: {hashlib.sha256(original).hexdigest()})
    assert client.get(url).status_code == 404


def test_desktop_activity_route_does_not_enable_or_initialize_gateway(monkeypatch):
    from fastapi import FastAPI
    from routes import mobile
    monkeypatch.setattr(mobile, "_instance", None)
    app = FastAPI()
    app.include_router(mobile.router)
    with TestClient(app) as client:
        assert client.get("/mobile/activity").json() == {"revision": None}
        assert client.get("/mobile/image-tasks").json()["tasks"] == []
        assert mobile._instance is None


def test_real_https_listener_conflict_restart_and_persistent_pairing(tmp_path, monkeypatch):
    import ipaddress
    import logging
    import socket
    import ssl
    from datetime import datetime, timedelta, timezone
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Mobile test")])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False)
        .sign(key, hashes.SHA256()))
    cert_path, key_path = tmp_path / "fixture.pem", tmp_path / "fixture.key"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    occupied = socket.socket()
    occupied.bind(("127.0.0.1", 0)); occupied.listen()
    port = occupied.getsockname()[1]
    origin = f"https://127.0.0.1:{port}"
    config = MobileListen(origin=origin, port=port, certificate=str(cert_path), private_key=str(key_path))
    assets = tmp_path / "assets"; assets.mkdir(); (assets / "index.html").write_text("Mobile")
    service = MobileCompanion(tmp_path / "mobile", "http://127.0.0.1:1", "unused-local-token", assets)
    access_logger = logging.getLogger("uvicorn.access")
    access_output = io.StringIO()
    access_handler = logging.StreamHandler(access_output)
    monkeypatch.setattr(access_logger, "handlers", [access_handler])
    monkeypatch.setattr(access_logger, "propagate", True)
    try:
        with pytest.raises(ValueError, match="could not start"):
            service.start(config)
    finally:
        occupied.close()
    context = ssl.create_default_context(cafile=str(cert_path))
    service.start(config)
    assert access_logger.handlers == [access_handler] and access_logger.propagate
    try:
        with httpx.Client(base_url=origin, verify=context, trust_env=False) as client:
            code = service.invitation()["code"]
            paired = client.post("/api/pair", headers={"Origin": origin, "X-LAW-Mobile": "1"}, json={"code": code, "name": "Persistent phone"})
            assert paired.status_code == 200
            assert client.get("/api/state").status_code == 200
            service.stop()
            service = MobileCompanion(tmp_path / "mobile", "http://127.0.0.1:1", "unused-local-token", assets)
            assert not service.running and service.status()["listen"]["origin"] == origin
            service.start(MobileListen(**service.status()["listen"]))
            assert access_logger.handlers == [access_handler] and access_logger.propagate
            assert client.get("/api/state").json()["device"]["name"] == "Persistent phone"
            peer_id = paired.json()["device"]["id"]
            service.access.revoke(peer_id)
            assert client.get("/api/state").status_code == 401
    finally:
        service.stop(force=True)
    assert access_output.getvalue() == ""  # Phone requests stay out of access logs.
