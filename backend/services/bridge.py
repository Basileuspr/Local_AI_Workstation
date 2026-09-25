"""Opt-in HTTPS worker bridge. The normal app API remains loopback-only.

Peers can submit bounded text/image requests, never paths, commands or arbitrary
API routes. Execution goes through the local API and its existing GPU queue.
"""
from __future__ import annotations

import asyncio
import base64
from contextlib import suppress
from datetime import datetime, timedelta, timezone
import hashlib
import io
import ipaddress
import json
import logging
import os
import secrets
import socket
import ssl
import sqlite3
import threading
import time
from urllib.parse import urlsplit
import uuid

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.responses import JSONResponse

from services.bridge_store import BridgeStore, TERMINAL

PROTOCOL = 1
MAX_BODY = 128 * 1024
MAX_RESULT = 24 * 1024 * 1024
logger = logging.getLogger(__name__)


def connection_detail(error):
    if isinstance(error, (httpx.TimeoutException, TimeoutError)):
        return "Peer timed out. Check whether it is asleep, busy or blocked by its private-network firewall."
    if isinstance(error, httpx.ConnectError):
        return "Cannot establish a trusted connection. Check the peer address, listener, firewall and pairing certificate."
    if isinstance(error, ValueError):
        return "Peer rejected the request or returned an invalid response. Check pairing, protocol and model availability."
    return "Bridge connection unavailable. Check both apps and the private network."


def listener_detail(error):
    code = getattr(error, "winerror", None) or getattr(error, "errno", None)
    if code in {98, 48, 10048}:
        return "Bridge port is already in use. Choose an unused port or stop the other bridge listener."
    if code in {99, 49, 10049}:
        return "That IPv4 address is not assigned to this PC. Choose an active Wi-Fi, Ethernet or private VPN address."
    if code in {13, 10013}:
        return "Windows or folder permissions blocked the bridge. Try an unused port and check data-folder access and private-network firewall permissions."
    return "Bridge could not open. Use an IPv4 address assigned to this PC and an unused port. Check data-folder permissions and the backend log."


class BridgeCancelled(Exception):
    pass


def endpoint(value):
    parsed = urlsplit(value)
    try:
        address = ipaddress.IPv4Address(parsed.hostname or "")
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Use an HTTPS address with a private IPv4 address and port.") from exc
    allowed = any(address in ipaddress.ip_network(net) for net in
                  ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8"))
    if not allowed or parsed.scheme != "https" or not port or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("Use https://private-IPv4:port on your LAN or private VPN.")
    return f"https://{address}:{port}"


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: str
    model: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=12000)
    negative_prompt: str = Field(default="", max_length=12000)
    width: int = Field(default=1024, ge=512, le=1536, multiple_of=8)
    height: int = Field(default=1024, ge=512, le=1536, multiple_of=8)
    steps: int = Field(default=24, ge=1, le=50)
    seed: int | None = Field(default=None, ge=0, le=2147483647)

    @field_validator("kind")
    @classmethod
    def kind_allowed(cls, value):
        if value not in {"chat", "image"}:
            raise ValueError("This bridge supports chat and base-model image generation.")
        return value


class PairIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    name: str = Field(min_length=1, max_length=60)
    url: str = Field(max_length=200)
    cert: str = Field(max_length=6000)
    token: str = Field(min_length=40, max_length=100)
    protocol: int = PROTOCOL

    @field_validator("url")
    @classmethod
    def validate_url(cls, value):
        return endpoint(value)


def tls_context(cert):
    context = ssl.create_default_context(cadata=cert)
    context.check_hostname = False  # Trust the exact invitation certificate, not a DNS name.
    return context


async def peer_request(peer, method, path, body=None):
    # No environment proxies, redirects, host names or arbitrary target paths.
    async with asyncio.timeout(35), httpx.AsyncClient(verify=tls_context(peer["cert"]), trust_env=False, timeout=30) as client:
        async with client.stream(method, endpoint(peer["url"]) + path,
                                 headers={"Authorization": "Bearer " + peer["token"]}, json=body) as response:
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > MAX_RESULT:
                    raise ValueError("Peer response exceeds the bridge transfer limit.")
            if response.status_code >= 400:
                # Do not return arbitrary peer HTML, exception paths or credentials.
                raise ValueError(f"Peer rejected the request ({response.status_code}). Check its availability, pairing and model selection.")
            return json.loads(data)


class Bridge:
    def __init__(self, root, local_url, local_token, transport=peer_request, executor=None, local_transport=None):
        self.store = BridgeStore(root)
        self.local_url = local_url
        self.local_token = local_token
        self.transport = transport
        self.executor = executor or self.execute
        self.local_transport = local_transport
        self.node_id = self.store.setting("id") or str(uuid.uuid4())
        self.store.set_setting("id", self.node_id)
        self.name = self.store.setting("name", "My PC")
        self.server = None
        self.thread = None
        self.url = None
        self.invites = {}
        self.tasks = set()
        self.syncing = set()
        self.lock = threading.RLock()
        self.listener_lock = threading.Lock()
        self.listener_error = None
        self.stopping = False
        self.gateway = self.make_gateway()

    @property
    def running(self):
        return bool(self.server and self.server.started and self.thread and self.thread.is_alive())

    def certificate(self):
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        cert_path, key_path = self.store.root / "identity.pem", self.store.root / "identity.key"
        if cert_path.exists() != key_path.exists() or (not cert_path.exists() and self.store.peers()):
            raise ValueError("Bridge identity files are missing or incomplete. Restore identity.pem and identity.key together from backup; existing pairings were preserved.")
        if not cert_path.exists():
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, self.node_id)])
            now = datetime.now(timezone.utc)
            cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                    .serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5))
                    .not_valid_after(now + timedelta(days=3650))
                    .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True).sign(key, hashes.SHA256()))
            key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
            cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
            if os.name != "nt":
                key_path.chmod(0o600)
        try:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert_path, key_path)
            cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
            if cert.not_valid_after_utc <= datetime.now(timezone.utc):
                raise ValueError("Expired certificate")
        except (ValueError, OSError) as exc:
            raise ValueError("Bridge identity is invalid or expired. Restore its certificate and key together; existing pairings were preserved.") from exc
        return cert_path, key_path

    def start(self, address, port, name):
        import uvicorn
        from uvicorn.protocols.http.h11_impl import H11Protocol

        class QuietBridgeProtocol(H11Protocol):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self.access_log = False

        with self.listener_lock:
            if self.thread and self.thread.is_alive():
                raise ValueError("Bridge is already listening. Stop it before changing its address.")
            sock = None
            self.server = self.thread = None
            self.listener_error = None
            self.stopping = False
            try:
                url = endpoint(f"https://{address}:{port}")
                cert, key = self.certificate()
                # Persist before opening the listener; disk failures must not leave it exposed.
                self.store.set_setting("name", name)
                self.store.set_setting("listen", {"address": address, "port": port})
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                    sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                sock.bind((address, port))
                # Uvicorn's access_log=False mutates the process-wide access
                # logger. Suppress only this listener's request logging.
                config = uvicorn.Config(self.gateway, log_config=None, log_level=None,
                                        http=QuietBridgeProtocol, ws="none", proxy_headers=False, server_header=False,
                                        ssl_certfile=str(cert), ssl_keyfile=str(key), limit_concurrency=16,
                                        timeout_keep_alive=5, timeout_graceful_shutdown=3)
                self.server = uvicorn.Server(config)
                config.load()  # TLS/config errors are reported to the caller, not lost in a thread.
                self.url, self.name = url, name
                def serve():
                    try:
                        self.server.run(sockets=[sock])
                    except BaseException as exc:
                        self.listener_error = "Bridge listener stopped unexpectedly. Check the backend log, then start it again."
                        logger.error("Bridge listener failed (%s)", type(exc).__name__)
                    finally:
                        if not self.server.should_exit:
                            self.listener_error = "Bridge listener stopped unexpectedly. Check the backend log, then start it again."
                        logger.info("Bridge listener closed")
                self.thread = threading.Thread(target=serve, daemon=True, name="pc-bridge")
                self.thread.start()
                for _ in range(100):
                    if self.server.started or not self.thread.is_alive():
                        break
                    time.sleep(.02)
                if not self.running:
                    raise ValueError("Bridge listener could not start. Check the address and port.")
            except (ValueError, OSError, sqlite3.Error, RuntimeError) as exc:
                if self.server:
                    self.server.should_exit = True
                if self.thread and self.thread.ident is not None:
                    self.thread.join(timeout=5)
                if sock:
                    sock.close()
                self.url = None
                self.listener_error = str(exc) if isinstance(exc, ValueError) else listener_detail(exc)
                logger.warning("Bridge start failed (%s, errno=%s)", type(exc).__name__, getattr(exc, "errno", None))
                raise ValueError(self.listener_error) from exc
            logger.info("Bridge listening at %s; local execution at %s", self.url, self.local_url)

    def stop(self, force=False):
        with self.listener_lock:
            with self.lock:
                if not force and any(job["status"] not in TERMINAL for job in self.store.jobs("incoming")):
                    raise ValueError("Finish or cancel incoming jobs before stopping the bridge.")
                self.stopping = True
                self.invites.clear()
                if self.server:
                    self.server.should_exit = True
            if self.thread and self.thread.ident is not None:
                self.thread.join(timeout=5)
            if self.thread and self.thread.is_alive():
                self.listener_error = "Bridge is still stopping. Wait for active requests to finish and check again."
                raise ValueError(self.listener_error)
            self.url = None
            self.listener_error = None
            logger.info("Bridge stopped")

    def identity(self, token):
        if not self.running or self.stopping:
            raise ValueError("Start the bridge on both PCs before pairing.")
        cert, _ = self.certificate()
        return dict(id=self.node_id, name=self.name, url=self.url, cert=cert.read_text(), token=token, protocol=PROTOCOL)

    def invitation(self):
        with self.lock:
            self.invites.clear()
            token = secrets.token_urlsafe(32)
            value = self.identity(token)
            self.invites[token] = {"expires": time.time() + 300}
            return base64.urlsafe_b64encode(json.dumps(value).encode()).decode()

    async def pair(self, code):
        if not self.running or self.stopping:
            raise ValueError("Start the bridge on both PCs before pairing.")
        try:
            remote = PairIdentity.model_validate(json.loads(base64.b64decode(code.strip(), altchars=b"-_", validate=True))).model_dump(mode="json")
            tls_context(remote["cert"])
        except Exception as exc:
            raise ValueError("Invalid invitation. Paste the complete code from the other PC.") from exc
        if remote["id"] == self.node_id or remote["protocol"] != PROTOCOL:
            raise ValueError("Use another PC running the same bridge protocol.")
        # Retain the same credential for a retry of this invitation.
        key = hashlib.sha256(code.strip().encode()).hexdigest()
        pending = self.store.setting("pending_pair")
        if not pending or pending["key"] != key:
            pending = {"key": key, "identity": self.identity(secrets.token_urlsafe(32))}
            self.store.set_setting("pending_pair", pending)
        own = pending["identity"]
        if own["url"] != self.url:
            raise ValueError("This PC's address changed during pairing. Create a new invitation and pair again.")
        if len(self.store.peers()) >= 8 and not self.store.peer(remote["id"]):
            raise ValueError("Bridge supports up to eight paired PCs.")
        answer = await self.transport(remote, "POST", "/pair", own)
        received = PairIdentity.model_validate(answer).model_dump(mode="json")
        if received["id"] != remote["id"] or received["cert"] != remote["cert"] or received["url"] != remote["url"] or received["protocol"] != PROTOCOL:
            raise ValueError("Peer identity changed during pairing.")
        self.store.save_peer({**received, "inbound": own["token"], "enabled": True})
        self.store.set_setting("pending_pair", None)
        logger.info("Bridge pairing completed for peer %s", received["id"])
        return {"paired": True}

    def accept_pair(self, token, value):
        peer = PairIdentity.model_validate(value).model_dump(mode="json")
        tls_context(peer["cert"])
        if peer["id"] == self.node_id or peer["protocol"] != PROTOCOL:
            raise ValueError("Incompatible peer identity.")
        with self.lock:
            invite = self.invites.get(token)
            if not invite or invite["expires"] < time.time():
                raise ValueError("Invitation expired. Create a new invitation.")
            if "peer" in invite:
                if invite["peer"] != peer:
                    raise ValueError("Invitation already used.")
                return invite["answer"]
            if len(self.store.peers()) >= 8 and not self.store.peer(peer["id"]):
                raise ValueError("Bridge supports up to eight paired PCs.")
            answer = self.identity(secrets.token_urlsafe(32))
            self.store.save_peer({**peer, "inbound": answer["token"], "enabled": True})
            invite.update(peer=peer, answer=answer)
            logger.info("Bridge pairing accepted for peer %s", peer["id"])
            return answer

    def authorized_peer(self, token):
        return next((peer for peer in self.store.peers() if peer["enabled"] and
                     secrets.compare_digest(peer["inbound"], token)), None)

    def require_peer(self, peer_id):
        peer = self.store.peer(peer_id)
        if not peer or not peer["enabled"]:
            raise ValueError("Peer is disconnected or revoked. Pair it again to continue.")
        return peer

    def status(self):
        from services.network_diagnostics import snapshot
        from services.app_logging import logging_status
        return {"running": self.running, "url": self.url if self.running else None, "name": self.name, "id": self.node_id,
                "listener_error": self.listener_error, "stopping": self.stopping and self.running,
                "network": snapshot(), "logging": logging_status(),
                "listen": self.store.setting("listen", {"address": "", "port": 8765}),
                "peers": [{key: peer[key] for key in ("id", "name", "url", "enabled")} for peer in self.store.peers()]}

    async def local_get(self, path):
        async with httpx.AsyncClient(trust_env=False, timeout=30, transport=self.local_transport) as client:
            response = await client.get(self.local_url + path, headers={"X-LAW-Session": self.local_token})
            response.raise_for_status()
            return response.json()

    async def capabilities(self):
        from services.capabilities import host_resources
        from services.system_stats import read_gpus
        from starlette.concurrency import run_in_threadpool
        async def probe(path):
            try:
                return await asyncio.wait_for(self.local_get(path), 12)
            except (httpx.HTTPError, ValueError, OSError, asyncio.TimeoutError):
                return {"error": "Local service unavailable or still loading. Check this PC's service status and retry."}
        models, images = await asyncio.gather(probe("/models"), probe("/image-generation/models"))
        try:
            gpus, _ = await asyncio.wait_for(run_in_threadpool(read_gpus), 3)
        except Exception:
            gpus = []
        return {"protocol": PROTOCOL, "name": self.name, "host": host_resources(),
                "gpus": [{key: gpu.get(key) for key in ("name", "vram_total_bytes", "vram_used_bytes")} for gpu in gpus],
                "chat_models": [{"id": model["name"], "size": model.get("size")} for model in models.get("models", [])],
                "image_models": [{"id": model["id"], "name": model.get("name", model["id"])} for model in images.get("models", [])] if images.get("runtime", {}).get("ready") else [],
                "chat_error": models.get("error"), "image_error": images.get("error") or images.get("runtime", {}).get("error"),
                "pending": sum(job["status"] not in TERMINAL for job in self.store.jobs("incoming"))}

    async def submit(self, peer_id, job_id, spec):
        peer = self.require_peer(peer_id)
        payload = TaskSpec.model_validate(spec).model_dump()
        job_id = str(uuid.UUID(job_id))
        self.store.insert("outgoing", job_id, peer_id, payload)
        # Persist first. A lost response must never be treated as permission to create a second job.
        return await self.sync(job_id, submit=True)

    async def sync(self, job_id, submit=False):
        with self.lock:
            if job_id in self.syncing:
                return self.store.job("outgoing", job_id)
            self.syncing.add(job_id)
        job = None
        try:
            job = self.store.job("outgoing", job_id)
            if not job:
                raise ValueError("Bridge job not found.")
            if job["status"] in TERMINAL:
                return job
            peer = self.require_peer(job["peer_id"])
            path = "/jobs/" + job_id
            if job["cancel_requested"]:
                response = await self.transport(peer, "POST", path + "/cancel")
            elif submit:
                response = await self.transport(peer, "PUT", path, job["payload"])
            else:
                response = await self.transport(peer, "GET", path)
            if not isinstance(response, dict) or response.get("id") != job_id or not isinstance(response.get("status"), str) or response["status"] not in TERMINAL | {"queued", "running", "cancelling"}:
                raise ValueError("Invalid peer job response.")
            error = response.get("error")
            if error is not None and (not isinstance(error, str) or len(error) > 1000):
                raise ValueError("Invalid peer job error.")
            result = None
            if response["status"] == "completed":
                result = self.validate_result(job["payload"]["kind"], response.get("result"))
            if job.get("connection_error") or job["status"] != response["status"]:
                logger.info("Bridge outgoing job %s: %s (connection available)", job_id, response["status"])
            return self.store.update("outgoing", job_id, status=response["status"], result=result,
                                     error=error, connection_error=None)
        except (httpx.HTTPError, ValueError, OSError) as exc:
            if job is None:
                raise
            detail = connection_detail(exc)
            if job and not job.get("connection_error"):
                logger.warning("Bridge outgoing job %s: connection unavailable (%s)", job_id, type(exc).__name__)
            return self.store.update("outgoing", job_id, connection_error=detail + " Execution status is unknown; reconnect to retrieve it. Retry delivery uses the same job ID.")
        finally:
            with self.lock:
                self.syncing.discard(job_id)

    @staticmethod
    def validate_result(kind, result):
        if not isinstance(result, dict):
            raise ValueError("Invalid result.")
        if kind == "chat":
            text = result.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 1024 * 1024:
                raise ValueError("Invalid chat result.")
            return {"text": text}
        image = result.get("image")
        if not isinstance(image, str) or not image.startswith("data:image/png;base64,") or len(image) > MAX_RESULT - 1024:
            raise ValueError("Invalid image result.")
        raw = base64.b64decode(image.split(",", 1)[1], validate=True)
        if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Result is not PNG data.")
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as picture:
            if picture.format != "PNG" or min(picture.size) < 1 or max(picture.size) > 1536:
                raise ValueError("Image result dimensions exceed bridge limits.")
            picture.verify()
        return {"image": image, "seed": result.get("seed")}

    async def accept_job(self, peer, job_id, spec):
        payload = TaskSpec.model_validate(spec).model_dump()
        with self.lock:
            if self.stopping:
                raise ValueError("Bridge is stopping. Retry after the listener is started again.")
            self.require_peer(peer["id"])
            job, fresh = self.store.insert("incoming", str(uuid.UUID(job_id)), peer["id"], payload)
            if fresh:
                logger.info("Bridge incoming job %s accepted (%s) from peer %s", job_id, payload["kind"], peer["id"])
                task = asyncio.create_task(self.run(job))
                self.tasks.add(task)
                task.add_done_callback(self.task_finished)
            return self.public_job(job)

    def task_finished(self, task):
        self.tasks.discard(task)
        if not task.cancelled() and task.exception():
            logger.error("Bridge task could not persist its outcome (%s); check storage and local queue", type(task.exception()).__name__)

    @staticmethod
    def public_job(job):
        result = job.get("result")
        if result and result.get("image"):
            from services.image_vault import locked_hashes
            digest = hashlib.sha256(base64.b64decode(result["image"].split(",", 1)[1])).hexdigest()
            if digest in locked_hashes():
                raise ValueError("This image is locked on the worker. Unlock it before transferring.")
        return {key: job.get(key) for key in ("id", "status", "result", "error", "updated")}

    async def run(self, job):
        job_id = job["id"]
        try:
            result = await self.executor(job)
            with self.store.lock:
                current = self.store.job("incoming", job_id)
                if current["cancel_requested"]:
                    self.store.update("incoming", job_id, status="cancelled")
                else:
                    result = self.validate_result(job["payload"]["kind"], result)
                    self.store.update("incoming", job_id, status="completed", result=result)
            logger.info("Bridge incoming job %s: %s", job_id, self.store.job("incoming", job_id)["status"])
        except asyncio.CancelledError:
            self.store.update("incoming", job_id, status="interrupted", error="Worker stopped before confirming completion.")
            raise
        except BridgeCancelled:
            self.store.update("incoming", job_id, status="cancelled", result=None, error=None)
        except Exception:
            import logging
            logging.getLogger(__name__).exception("Bridge execution failed for job %s", job_id)
            current = self.store.job("incoming", job_id)
            self.store.update("incoming", job_id, status="cancelled" if current["cancel_requested"] else "failed",
                              error=None if current["cancel_requested"] else "Execution failed on this PC. Check its models, available memory and backend log. The job was not retried.")

    async def cancel_incoming(self, job_id):
        with self.store.lock:
            job = self.store.job("incoming", job_id)
            if job["status"] not in TERMINAL:
                self.store.update("incoming", job_id, status="cancelling", cancel_requested=True)
            return self.public_job(self.store.job("incoming", job_id))

    async def execute(self, job):
        """Use existing local routes: same queue, cancellation, context limits and GPU lease."""
        spec, job_id = job["payload"], job["id"]
        capabilities = await self.capabilities()
        if spec["model"] not in {model["id"] for model in capabilities[spec["kind"] + "_models"]}:
            raise ValueError("The exact requested model is unavailable.")
        request_id = "bridge-" + job_id
        headers = {"X-LAW-Session": self.local_token}
        finished = asyncio.Event()

        async def watch():
            from services.request_queue import queue
            failed = False
            while not finished.is_set():
                try:
                    current = self.store.job("incoming", job_id)
                    queued = queue.find(kind=spec["kind"], request_id=request_id)
                    if current["cancel_requested"] and queued:
                        # Cancellation callback must execute on the local API's loop via HTTP.
                        stop_path = "/chat/stop/" if spec["kind"] == "chat" else "/image-generation/stop/"
                        async with httpx.AsyncClient(trust_env=False, timeout=5, transport=self.local_transport) as client:
                            response = await client.post(self.local_url + stop_path + request_id, headers=headers)
                            response.raise_for_status()
                    elif queued and queued.status == "running" and current["status"] == "queued":
                        self.store.update("incoming", job_id, status="running")
                    if failed:
                        logger.info("Bridge job %s local monitoring recovered", job_id)
                    failed = False
                except (httpx.HTTPError, OSError, sqlite3.Error) as exc:
                    if not failed:
                        logger.warning("Bridge job %s local monitoring unavailable (%s); retrying", job_id, type(exc).__name__)
                    failed = True
                await asyncio.sleep(.3)

        monitor = asyncio.create_task(watch())
        try:
            if self.store.job("incoming", job_id)["cancel_requested"]:
                raise ValueError("Cancelled before execution.")
            async with httpx.AsyncClient(trust_env=False, timeout=httpx.Timeout(3600, connect=5), transport=self.local_transport) as client:
                if spec["kind"] == "image":
                    body = {key: spec[key] for key in ("prompt", "negative_prompt", "width", "height", "steps", "seed")}
                    body.update(model_id=spec["model"], request_id=request_id)
                    response = await client.post(self.local_url + "/image-generation/generate", headers=headers, json=body)
                    if response.status_code == 499:
                        raise BridgeCancelled()
                    response.raise_for_status()
                    value = response.json()
                    return {"image": value["data_url"], "seed": value.get("seed")}
                text, complete = "", False
                async with client.stream("POST", self.local_url + "/chat", headers=headers,
                                         json={"model": spec["model"], "messages": [{"role": "user", "content": spec["prompt"]}],
                                               "request_id": request_id, "use_memory": False, "use_knowledge_base": False}) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        value = json.loads(line[6:])
                        if value.get("cancelled"):
                            raise BridgeCancelled()
                        if value.get("error") or str(value.get("token", "")).startswith("[Error:"):
                            raise ValueError("Chat execution failed.")
                        text += value.get("token", "")
                        complete = complete or value.get("done", False)
                        if len(text) > 1024 * 1024:
                            raise ValueError("Chat output exceeds bridge limit.")
                if not complete:
                    raise ValueError("Chat stream ended without completion.")
                return {"text": text}
        finally:
            finished.set()
            monitor.cancel()
            with suppress(asyncio.CancelledError):
                await monitor

    def make_gateway(self):
        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        bridge = self

        @app.middleware("http")
        async def guard(request: Request, call_next):
            from services.maintenance_gate import gate
            if gate.blocked():
                return JSONResponse({"detail": "Maintenance in progress."}, status_code=503)
            if bridge.stopping:
                return JSONResponse({"detail": "Bridge is stopping; retry later."}, status_code=503)
            if request.headers.get("origin") or request.query_params:
                return JSONResponse({"detail": "Desktop peers only."}, status_code=403)
            if bridge.url and request.headers.get("host") != urlsplit(bridge.url).netloc:
                return JSONResponse({"detail": "Listener address does not match. Pair again after an address change."}, status_code=421)
            authorization = request.headers.get("authorization", "")
            if not authorization.startswith("Bearer "):
                return JSONResponse({"detail": "Pairing required."}, status_code=401)
            token = authorization[7:]
            if request.url.path == "/pair":
                invite = bridge.invites.get(token)
                if not invite or invite["expires"] < time.time():
                    return JSONResponse({"detail": "Invitation unavailable."}, status_code=401)
            else:
                try:
                    peer = bridge.authorized_peer(token)
                except (sqlite3.Error, OSError, json.JSONDecodeError):
                    logger.error("Bridge authentication storage unavailable")
                    return JSONResponse({"detail": "Worker storage unavailable; retry later."}, status_code=503)
                if not peer:
                    return JSONResponse({"detail": "Pairing required."}, status_code=401)
                request.state.peer = peer
            body = bytearray()
            async def read_body():
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > MAX_BODY:
                        return False
                return True
            try:
                if not await asyncio.wait_for(read_body(), 10):
                    return JSONResponse({"detail": "Request too large."}, status_code=413)
            except asyncio.TimeoutError:
                return JSONResponse({"detail": "Request body timed out."}, status_code=408)
            request._body = bytes(body)
            try:
                result = await call_next(request)
            except (sqlite3.Error, OSError):
                logger.error("Bridge request storage unavailable")
                result = JSONResponse({"detail": "Worker storage unavailable; retry later."}, status_code=503)
            except ValueError:
                result = JSONResponse({"detail": "Invalid or unavailable bridge request."}, status_code=409)
            result.headers["Cache-Control"] = "no-store"
            return result

        @app.post("/pair")
        async def pair(request: Request):
            return bridge.accept_pair(request.headers["authorization"].removeprefix("Bearer "), await request.json())

        @app.get("/capabilities")
        async def capabilities():
            return await bridge.capabilities()

        @app.put("/jobs/{job_id}")
        async def submit(job_id: uuid.UUID, spec: TaskSpec, request: Request):
            return await bridge.accept_job(request.state.peer, str(job_id), spec.model_dump())

        def owned(request, job_id):
            job = bridge.store.job("incoming", str(job_id))
            if not job or job["peer_id"] != request.state.peer["id"]:
                raise HTTPException(404, "Job not found.")
            return job

        @app.get("/jobs/{job_id}")
        async def get_job(job_id: uuid.UUID, request: Request):
            return bridge.public_job(owned(request, job_id))

        @app.post("/jobs/{job_id}/cancel")
        async def cancel(job_id: uuid.UUID, request: Request):
            job = bridge.store.job("incoming", str(job_id))
            if job:
                owned(request, job_id)
            else:
                bridge.store.cancel_missing(str(job_id), request.state.peer["id"])
            return await bridge.cancel_incoming(str(job_id))

        return app
