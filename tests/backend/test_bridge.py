import asyncio
import base64
import json
import socket
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from services.bridge import Bridge, TaskSpec, endpoint, peer_request, MAX_BODY
from services.bridge_store import BridgeStore


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def spec(kind="chat"):
    return TaskSpec(kind=kind, model="test-model", prompt="Explain a bridge").model_dump()


def seed_peer(bridge):
    peer = {"id": str(uuid.uuid4()), "name": "Other PC", "url": "https://127.0.0.1:8765", "cert": "unused",
            "token": "t" * 43, "inbound": "i" * 43, "enabled": True}
    bridge.store.save_peer(peer)
    return peer


@pytest.mark.parametrize("url", ["http://192.168.1.2:8765", "https://example.com:8765", "https://8.8.8.8:8765",
    "https://169.254.169.254:80", "https://192.168.1.2:8765/path", "https://u:p@192.168.1.2:8765", "https://[::1]:8765"])
def test_endpoint_rejects_arbitrary_network_targets(url):
    with pytest.raises(ValueError):
        endpoint(url)


def test_durable_restart_and_deduplication(tmp_path):
    store = BridgeStore(tmp_path)
    job_id, peer_id = str(uuid.uuid4()), str(uuid.uuid4())
    store.insert("incoming", job_id, peer_id, spec())
    reopened = BridgeStore(tmp_path)
    assert reopened.job("incoming", job_id)["status"] == "interrupted"
    assert reopened.insert("incoming", job_id, peer_id, spec())[1] is False
    with pytest.raises(ValueError):
        reopened.insert("incoming", job_id, peer_id, {**spec(), "prompt": "Changed"})
    reopened.delete("incoming", job_id)
    assert reopened.insert("incoming", job_id, peer_id, spec())[1] is False
    assert reopened.job("incoming", job_id)["result"] is None


def test_gateway_auth_ownership_and_input_limits(tmp_path):
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "local-secret")
    peer = seed_peer(bridge)
    headers = {"Authorization": "Bearer " + peer["inbound"]}
    other_id = str(uuid.uuid4())
    bridge.store.insert("incoming", other_id, str(uuid.uuid4()), spec())
    with TestClient(bridge.gateway) as client:
        assert client.get("/capabilities").status_code == 401
        assert client.get("/sessions/list", headers=headers).status_code == 404
        assert client.get("/capabilities", headers={**headers, "Origin": "http://evil.example"}).status_code == 403
        assert client.get("/capabilities?token=secret", headers=headers).status_code == 403
        assert client.get("/jobs/" + other_id, headers=headers).status_code == 404
        assert client.post("/jobs/" + other_id + "/cancel", headers=headers).status_code == 404
        target = "/jobs/" + str(uuid.uuid4())
        assert client.put(target, headers=headers, json={**spec(), "command": "anything"}).status_code == 422
        assert client.put(target, headers=headers, content=b"x" * (MAX_BODY + 1)).status_code == 413
        peer["enabled"] = False
        bridge.store.save_peer(peer)
        assert client.get("/capabilities", headers=headers).status_code == 401


def test_actual_tls_pair_execute_both_directions_and_lost_ack(tmp_path):
    calls = []

    async def execute(job):
        calls.append(job["id"])
        return {"text": "A result from the worker"}

    a = Bridge(tmp_path / "a", "http://127.0.0.1:1", "local-a", executor=execute)
    b = Bridge(tmp_path / "b", "http://127.0.0.1:1", "local-b", executor=execute)
    a.start("127.0.0.1", free_port(), "PC A")
    b.start("127.0.0.1", free_port(), "PC B")

    async def scenario():
        code = a.invitation()
        await b.pair(code)
        assert b.store.peer(a.node_id)["enabled"]
        assert a.store.peer(b.node_id)["enabled"]
        assert "token" not in json.dumps(a.status())
        # Another node cannot reuse the consumed invitation.
        invitation = json.loads(base64.urlsafe_b64decode(code))
        with pytest.raises(ValueError):
            await peer_request(invitation, "POST", "/pair", {**b.identity("z" * 43), "id": str(uuid.uuid4())})
        # A certificate mismatch must fail, even with a valid bearer token.
        wrong = {**b.store.peer(a.node_id), "cert": b.identity("x" * 43)["cert"]}
        with pytest.raises(httpx.ConnectError):
            await peer_request(wrong, "GET", "/capabilities")

        job_id = str(uuid.uuid4())
        async def lost_ack(peer, method, path, body=None):
            response = await peer_request(peer, method, path, body)
            if method == "PUT":
                raise httpx.ReadTimeout("simulated response loss")
            return response
        b.transport = lost_ack
        first = await b.submit(a.node_id, job_id, spec())
        assert first["connection_error"]
        b.transport = peer_request
        await b.sync(job_id, submit=True)
        for _ in range(50):
            state = await b.sync(job_id)
            if state["status"] == "completed":
                break
            await asyncio.sleep(.02)
        assert state["result"]["text"] == "A result from the worker"
        assert calls.count(job_id) == 1
        reverse_id = str(uuid.uuid4())
        await a.submit(b.node_id, reverse_id, spec())
        for _ in range(50):
            state = await a.sync(reverse_id)
            if state["status"] == "completed":
                break
            await asyncio.sleep(.02)
        assert state["status"] == "completed"
        assert calls.count(reverse_id) == 1
        # Saved result survives the sender restarting.
        reopened = BridgeStore(b.store.root)
        assert reopened.job("outgoing", job_id)["result"]["text"]

    try:
        asyncio.run(scenario())
    finally:
        a.stop(force=True)
        b.stop(force=True)


def test_cancel_waits_for_worker_and_blocks_stop(tmp_path):
    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        async def execute(job):
            entered.set()
            await release.wait()
            return {"text": "Discard cancelled result"}
        bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret", executor=execute)
        peer = seed_peer(bridge)
        job_id = str(uuid.uuid4())
        await bridge.accept_job(peer, job_id, spec())
        await entered.wait()
        await bridge.cancel_incoming(job_id)
        assert bridge.store.job("incoming", job_id)["status"] == "cancelling"
        with pytest.raises(ValueError):
            bridge.stop()
        release.set()
        await asyncio.gather(*bridge.tasks)
        assert bridge.store.job("incoming", job_id)["status"] == "cancelled"
        assert bridge.store.job("incoming", job_id)["result"] is None
    asyncio.run(scenario())


def test_public_result_honors_image_locks(tmp_path, monkeypatch):
    import hashlib
    from services import image_vault
    data = b"\x89PNG\r\n\x1a\nexample"
    monkeypatch.setattr(image_vault, "locked_hashes", lambda: {hashlib.sha256(data).hexdigest()})
    with pytest.raises(ValueError, match="locked"):
        Bridge.public_job({"result": {"image": "data:image/png;base64," + base64.b64encode(data).decode()}})


def test_native_inputs_and_result_validation():
    with pytest.raises(ValueError):
        TaskSpec(**{**spec(), "kind": "shell"})
    with pytest.raises(ValueError):
        TaskSpec(**{**spec(), "width": 513})
    with pytest.raises(ValueError):
        Bridge.validate_result("image", {"image": "data:image/svg+xml;base64,anything"})
    with pytest.raises(ValueError):
        Bridge.validate_result("chat", {"text": ""})


def test_worker_local_cancel_is_reported_as_cancelled(tmp_path):
    from services.bridge import BridgeCancelled
    async def execute(job):
        raise BridgeCancelled()
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret", executor=execute)
    peer = seed_peer(bridge)
    async def scenario():
        job_id = str(uuid.uuid4())
        await bridge.accept_job(peer, job_id, spec())
        await asyncio.gather(*bridge.tasks)
        assert bridge.store.job("incoming", job_id)["status"] == "cancelled"
    asyncio.run(scenario())


def test_cancel_before_delivery_prevents_late_execution(tmp_path):
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret")
    peer = seed_peer(bridge)
    headers = {"Authorization": "Bearer " + peer["inbound"]}
    job_id = str(uuid.uuid4())
    with TestClient(bridge.gateway) as client:
        assert client.post(f"/jobs/{job_id}/cancel", headers=headers).json()["status"] == "cancelled"
        response = client.put(f"/jobs/{job_id}", headers=headers, json=spec())
        assert response.status_code == 200
        assert response.json()["status"] == "cancelled"
        assert not bridge.tasks


def test_worker_executes_through_real_local_routes_and_shared_queue(tmp_path, monkeypatch):
    import main
    from routes import image_generation
    from services import request_queue
    from services.gpu_coordination import GpuCoordinator
    from fastapi.responses import StreamingResponse
    queue = request_queue.RequestQueue(GpuCoordinator())
    monkeypatch.setattr(main, "queue", queue)
    monkeypatch.setattr(image_generation, "queue", queue)
    monkeypatch.setattr(request_queue, "queue", queue)
    seen = []

    async def prepare(kind):
        seen.append(kind)

    async def chat(request, client_request):
        assert request.use_memory is False and request.use_knowledge_base is False
        assert request.session_id is None
        assert request.model == "test-model"
        async def stream():
            yield 'data: {"token":"Hello ","done":false}\n\n'
            yield 'data: {"token":"peer","done":true}\n\n'
        return StreamingResponse(stream(), media_type="text/event-stream")

    monkeypatch.setattr(main, "prepare_runtime", prepare)
    monkeypatch.setattr(image_generation, "prepare_runtime", prepare)
    monkeypatch.setattr(main, "_chat", chat)
    import io
    from PIL import Image
    image_bytes = io.BytesIO()
    Image.new("RGB", (8, 8), "green").save(image_bytes, format="PNG")
    png = "data:image/png;base64," + base64.b64encode(image_bytes.getvalue()).decode()
    monkeypatch.setattr(image_generation, "_generate_image", lambda *args: {"data_url": png, "seed": 42})
    bridge = Bridge(tmp_path, "http://127.0.0.1:8000", "test-session-token", local_transport=httpx.ASGITransport(app=main.app))

    async def capabilities():
        return {"chat_models": [{"id": "test-model"}], "image_models": [{"id": "test-model"}]}
    bridge.capabilities = capabilities
    peer = seed_peer(bridge)

    async def scenario():
        blocker = queue.enqueue("chat", "Local user first")
        assert queue.try_start(blocker)
        job_id = str(uuid.uuid4())
        await bridge.accept_job(peer, job_id, spec())
        await asyncio.sleep(.05)
        assert bridge.store.job("incoming", job_id)["status"] == "queued"
        assert queue.active is blocker
        queue.finish(blocker)
        await asyncio.wait_for(asyncio.gather(*bridge.tasks), 5)
        assert bridge.store.job("incoming", job_id)["result"] == {"text": "Hello peer"}
        image_id = str(uuid.uuid4())
        await bridge.accept_job(peer, image_id, spec("image"))
        await asyncio.wait_for(asyncio.gather(*bridge.tasks), 5)
        assert bridge.store.job("incoming", image_id)["result"]["seed"] == 42
        assert queue.active is None
        assert all(job.status == "completed" for job in queue.jobs)
        assert seen == ["chat", "image"]
    asyncio.run(scenario())


def test_local_routes_require_session_and_save_result_once(tmp_path, monkeypatch, sessions_dir):
    import main
    from routes import bridge as controls
    from services import session_store
    from services.maintenance_gate import gate
    monkeypatch.setattr(gate, "locked", False)
    bridge = Bridge(tmp_path / "bridge", "http://127.0.0.1:8000", "test-session-token")
    monkeypatch.setattr(controls, "_instance", bridge)
    job_id = str(uuid.uuid4())
    bridge.store.insert("outgoing", job_id, str(uuid.uuid4()), spec())
    bridge.store.update("outgoing", job_id, status="completed", result={"text": "Remote answer"})
    with TestClient(main.app, base_url="http://127.0.0.1:8000") as client:
        assert client.get("/bridge").status_code == 403
        headers = {"X-LAW-Session": "test-session-token"}
        result = client.post(f"/bridge/jobs/outgoing/{job_id}/save-chat", headers=headers)
        assert result.status_code == 200, result.text
        session_id = result.json()["session_id"]
        saved = session_store.get_session(session_id)
        assert saved["messages"][1]["content"] == "Remote answer"
        session_store.update_session(session_id, [{"role": "user", "content": "Later user edit"}])
        result = client.post(f"/bridge/jobs/outgoing/{job_id}/save-chat", headers=headers)
        assert result.json()["session_id"] == session_id
        assert session_store.get_session(session_id)["messages"][0]["content"] == "Later user edit"
        assert len(list(sessions_dir.glob("*.json"))) == 1


def test_bind_conflict_cleans_up_and_can_retry(tmp_path):
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret")
    with socket.socket() as blocker:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            blocker.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        blocker.bind(("127.0.0.1", 0))
        blocker.listen()
        with pytest.raises(ValueError, match="unused port"):
            bridge.start("127.0.0.1", blocker.getsockname()[1], "PC")
        assert not bridge.running and bridge.listener_error
    try:
        bridge.start("127.0.0.1", free_port(), "PC")
        assert bridge.running and bridge.listener_error is None
        assert bridge.server.config.proxy_headers is False
    finally:
        bridge.stop(True)
    assert not bridge.running and bridge.url is None


def test_missing_certificate_never_silently_rotates_peer_identity(tmp_path):
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret")
    cert, key = bridge.certificate()
    original = key.read_bytes()
    cert.unlink()
    with pytest.raises(ValueError, match="Restore"):
        bridge.start("127.0.0.1", free_port(), "PC")
    assert key.read_bytes() == original
    assert not bridge.running


def test_thread_start_failure_releases_bound_socket(tmp_path, monkeypatch):
    import threading
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret")
    port = free_port()
    def fail(*args):
        raise RuntimeError("cannot start new thread")
    monkeypatch.setattr(threading.Thread, "start", fail)
    with pytest.raises(ValueError, match="Bridge could not open"):
        bridge.start("127.0.0.1", port, "PC")
    assert not bridge.running and bridge.listener_error
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", port))


def test_partial_capabilities_keep_chat_when_image_service_fails(tmp_path, monkeypatch):
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret")
    async def get(path):
        if path == "/models":
            return {"models": [{"name": "chat-model"}]}
        raise httpx.ReadTimeout("loading")
    monkeypatch.setattr(bridge, "local_get", get)
    monkeypatch.setattr("services.system_stats.read_gpus", lambda: ([], None))
    result = asyncio.run(bridge.capabilities())
    assert result["chat_models"] == [{"id": "chat-model", "size": None}]
    assert result["image_models"] == [] and result["image_error"]
    assert result["chat_error"] is None


def test_retry_delivery_preserves_cancellation_intent(tmp_path):
    calls = []
    async def transport(peer, method, path, body=None):
        calls.append((method, path))
        return {"id": job_id, "status": "cancelled"}
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret", transport=transport)
    peer = seed_peer(bridge)
    job_id = str(uuid.uuid4())
    bridge.store.insert("outgoing", job_id, peer["id"], spec())
    bridge.store.update("outgoing", job_id, cancel_requested=True)
    assert asyncio.run(bridge.sync(job_id, submit=True))["status"] == "cancelled"
    assert calls == [("POST", f"/jobs/{job_id}/cancel")]


def test_gateway_checks_bearer_host_and_softens_storage_failure(tmp_path, monkeypatch):
    import sqlite3
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret")
    peer = seed_peer(bridge)
    bridge.url = "https://127.0.0.1:8765"
    headers = {"Authorization": "Bearer " + peer["inbound"]}
    with TestClient(bridge.gateway, base_url=bridge.url) as client:
        assert client.get("/capabilities", headers={"Authorization": peer["inbound"]}).status_code == 401
        assert client.get("/capabilities", headers={**headers, "Host": "unrelated.local"}).status_code == 421
        def fail():
            raise sqlite3.OperationalError("database locked")
        monkeypatch.setattr(bridge.store, "peers", fail)
        response = client.get("/capabilities", headers=headers)
        assert response.status_code == 503
        assert "storage unavailable" in response.text


def test_job_list_omits_large_results_and_receipts_preserve_deduplication(tmp_path):
    store = BridgeStore(tmp_path)
    job_id, peer_id = str(uuid.uuid4()), str(uuid.uuid4())
    store.insert("incoming", job_id, peer_id, spec())
    store.update("incoming", job_id, status="completed", result={"text": "large result"})
    assert "result" not in store.jobs()[0]
    assert store.job("incoming", job_id)["result"]["text"] == "large result"
    store.delete("incoming", job_id)
    assert store.jobs() == []
    assert store.insert("incoming", job_id, peer_id, spec())[1] is False


def test_local_storage_failure_returns_actionable_503(tmp_path, monkeypatch):
    import sqlite3
    from fastapi import FastAPI
    from routes import bridge as controls
    bridge = Bridge(tmp_path, "http://127.0.0.1:1", "secret")
    monkeypatch.setattr(controls, "_instance", bridge)
    def fail(*args):
        raise sqlite3.OperationalError("disk full")
    monkeypatch.setattr(bridge.store, "jobs", fail)
    app = FastAPI()
    app.include_router(controls.router)
    with TestClient(app) as client:
        response = client.get("/bridge/jobs")
        assert response.status_code == 503
        assert "free disk space" in response.text


def test_polling_survives_storage_failure_and_recovers(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from routes import bridge as controls
    calls = []
    recovered = asyncio.Event()
    def jobs(*args):
        calls.append(True)
        if len(calls) == 1:
            raise OSError("temporarily unavailable")
        recovered.set()
        return []
    fake = SimpleNamespace(running=True, store=SimpleNamespace(jobs=jobs), stop=lambda *args: None)
    monkeypatch.setattr(controls, "_instance", fake)
    async def scenario():
        await controls.startup()
        try:
            await asyncio.wait_for(recovered.wait(), 5)
            assert not controls._poll_task.done()
        finally:
            await controls.shutdown()
    asyncio.run(scenario())
