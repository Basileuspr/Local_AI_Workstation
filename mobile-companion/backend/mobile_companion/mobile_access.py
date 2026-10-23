"""Mobile device pairing. Only digests are retained; invitations are in memory."""
import hashlib
import secrets
import threading
import time
import uuid
from collections import defaultdict, deque

DEVICE_LIFETIME = 30 * 24 * 60 * 60
COOKIE = "__Host-law-mobile"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class MobileAccess:
    def __init__(self, store):
        self.store = store
        self.lock = threading.RLock()
        self.invite = None
        self.requests = defaultdict(deque)

    def invitation(self):
        with self.lock:
            code = secrets.token_urlsafe(24)
            self.invite = (digest(code), time.time() + 300, str(uuid.uuid4()))
            return {"code": code, "expires_in": 300, **self.invitation_status()}

    def invitation_status(self):
        with self.lock:
            if self.invite and self.invite[1] <= time.time():
                self.invite = None
            return {"id": self.invite[2], "expires_at": self.invite[1]} if self.invite else None

    def clear_invitation(self):
        with self.lock:
            self.invite = None

    def throttle(self, key, limit):
        with self.lock:
            now = time.monotonic()
            queue = self.requests[key]
            while queue and queue[0] < now - 60:
                queue.popleft()
            if len(queue) >= limit:
                return False
            queue.append(now)
            return True

    def pair(self, code, name):
        with self.lock:
            if not self.invite or self.invite[1] <= time.time() or not secrets.compare_digest(self.invite[0], digest(code)):
                raise ValueError("Pairing code is invalid or expired. Create a new invitation on the desktop.")
            if sum(bool(peer.get("enabled") and peer.get("expires", 0) > time.time()) for peer in self.store.peers()) >= 20:
                raise ValueError("Device limit reached. Revoke an old device on the desktop.")
            token = secrets.token_urlsafe(32)
            peer = {"id": str(uuid.uuid4()), "name": name.strip() or "Phone", "digest": digest(token),
                    "enabled": True, "created": time.time(), "expires": time.time() + DEVICE_LIFETIME}
            self.store.save_peer(peer)
            self.invite = None
            return peer, token

    def authenticate(self, token):
        if not token or len(token) > 100:
            return None
        hashed = digest(token)
        return next((peer for peer in self.store.peers() if peer.get("enabled") and peer.get("expires", 0) > time.time()
                     and secrets.compare_digest(peer.get("digest", ""), hashed)), None)

    def revoke(self, device_id):
        with self.lock:
            peer = self.store.peer(device_id)
            if peer:
                self.store.save_peer({**peer, "enabled": False, "digest": ""})

    def devices(self):
        return [{**{key: peer.get(key) for key in ("id", "name", "enabled", "created", "expires")},
                 "expired": peer.get("expires", 0) <= time.time()} for peer in self.store.peers()]
