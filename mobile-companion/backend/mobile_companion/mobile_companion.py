"""Explicit mobile listener lifecycle; never starts on import or application boot."""
import socket
import ssl
import threading
import time
from pathlib import Path

import uvicorn
from uvicorn.protocols.http.h11_impl import H11Protocol
from mobile_companion.connection_setup import MobileListen

from services.bridge_store import TERMINAL
from mobile_companion.mobile_access import MobileAccess
from mobile_companion.mobile_api import create_mobile_api
from mobile_companion.mobile_jobs import MobileJobs
from mobile_companion.mobile_updates import MobileUpdates


class QuietMobileProtocol(H11Protocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.access_log = False


class MobileCompanion:
    def __init__(self, root, local_url, local_token, assets, *, transport=None):
        self.jobs = MobileJobs(root, local_url, local_token, transport=transport)
        self.access = MobileAccess(self.jobs.store)
        self.assets = Path(assets)
        self.updates = MobileUpdates(self.assets, root)
        self.server = self.thread = self.config = None
        self.lock = threading.RLock()
        self.listener_error = None

    @property
    def running(self):
        return bool(self.server and self.server.started and self.thread and self.thread.is_alive())

    def status(self):
        return {"running": self.running, "origin": self.config.origin if self.config else None,
                "listen": self.jobs.store.setting("listen"),
                "invitation": self.access.invitation_status() if self.running else None,
                "build_ready": self.updates.resolve('index.html') is not None,
                "devices": self.updates.devices(self.access.devices()), "client_update": self.updates.status(),
                "active_jobs": sum(job["status"] not in TERMINAL for job in self.jobs.store.jobs("incoming")),
                "error": self.listener_error}

    def start(self, config):
        with self.lock:
            if self.running:
                raise ValueError("Stop the existing mobile listener before changing its configuration.")
            if self.updates.resolve('index.html') is None:
                raise ValueError("Build the mobile client first with npm run build:mobile.")
            if config.certificate:
                context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
                try:
                    context.load_cert_chain(config.certificate, config.private_key)
                except (OSError, ssl.SSLError):
                    raise ValueError("Certificate/key could not be loaded. Use a trusted certificate matching the configured HTTPS origin.") from None
            # Remember setup, never an enabled/auto-start flag. These paths and
            # private origin stay in local app data, not source or phone replies.
            self.jobs.store.set_setting("listen", config.model_dump())
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                sock.bind((config.address, config.port))
                sock.listen(128)
                app = create_mobile_api(self.jobs, self.access, config.origin, self.assets, updates=self.updates)
                # Match the PC bridge: quiet only this listener. access_log=False
                # would also disable the desktop's process-wide access logger.
                self.server = uvicorn.Server(uvicorn.Config(app, host=config.address, port=config.port,
                    proxy_headers=False, forwarded_allow_ips="", http=QuietMobileProtocol, ws="none", log_config=None,
                    timeout_graceful_shutdown=5, ssl_certfile=config.certificate or None,
                    ssl_keyfile=config.private_key or None))
                self.config = config
                server = self.server
                def serve():
                    try:
                        server.run(sockets=[sock])
                    finally:
                        sock.close()
                self.thread = threading.Thread(target=serve, name="law-mobile", daemon=True)
                self.thread.start()
                deadline = time.monotonic() + 5
                while self.thread.is_alive() and not server.started and time.monotonic() < deadline:
                    time.sleep(.02)
                if not self.running:
                    server.should_exit = True
                    self.thread.join(6)
                    raise ValueError("Mobile listener failed to start. Check the port and certificate on the desktop.")
                self.listener_error = None
            except Exception as error:
                sock.close()
                self.listener_error = "Mobile listener could not start. Check the private address, port and certificate."
                if isinstance(error, ValueError):
                    raise
                raise ValueError(self.listener_error) from None
            return self.status()

    def stop(self, force=False):
        with self.lock:
            if not force and self.status()["active_jobs"]:
                raise ValueError("Finish or cancel active mobile jobs before stopping the listener.")
            self.access.clear_invitation()
            if self.server:
                self.server.should_exit = True
            if self.thread:
                self.thread.join(8)
                if self.thread.is_alive():
                    raise ValueError("Mobile listener is still stopping. Wait and retry.")
            self.server = self.thread = None
            return self.status()

    def invitation(self):
        if not self.running:
            raise ValueError("Start the approved HTTPS connection before pairing a phone.")
        return self.access.invitation()
