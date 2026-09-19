"""PIN-unlocked encrypted collection and app-wide original-image access policy.

Original files/backups remain on disk for recovery and lineage. The PIN gates
app access; it is not filesystem encryption of those pre-existing copies.
"""
import base64
import hashlib
import json
import re
import secrets
import threading
import time
import uuid
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from config import settings
from services.image_library import atomic, inspect, identity

ROOT = settings.data_dir / "locked_images"
LOCK = threading.RLock()
TOKENS = {}
TTL = 15 * 60


class LockedImageError(ValueError): pass
class PinError(ValueError): pass


def encode(value): return base64.b64encode(value).decode("ascii")
def decode(value): return base64.b64decode(value, validate=True)


def config():
    path = ROOT / "vault.json"
    if not path.exists(): return None
    try:
        result = json.loads(path.read_bytes())
        if result["version"] != 1 or not isinstance(result["locks"], dict): raise ValueError()
        if any(not re.fullmatch(r"[0-9a-f]{32}", key) or not isinstance(hashes, list) or not hashes or any(not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) for digest in hashes) for key, hashes in result["locks"].items()): raise ValueError()
        return result
    except (ValueError, KeyError, TypeError) as exc:
        raise LockedImageError("Locked Images records are unreadable; image access is blocked until repaired.") from exc


def save_config(value): atomic(ROOT / "vault.json", json.dumps(value).encode())


def locked_hashes():
    value = config()
    return set(digest for hashes in value["locks"].values() for digest in hashes) if value else set()


def is_locked(digest): return digest in locked_hashes()


def require_public(digest):
    if is_locked(digest): raise LockedImageError("This image is in Locked Images. Restore it there to use it elsewhere.")


@lru_cache(maxsize=2048)
def _file_hash(path, size, modified):
    from pathlib import Path
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def guard_path(path):
    if not locked_hashes(): return
    info = path.stat()
    require_public(_file_hash(str(path.resolve()), info.st_size, info.st_mtime_ns))


def derive(pin, salt):
    if not re.fullmatch(r"[0-9]{4,12}", pin): raise PinError("Use a PIN of 4–12 digits")
    return Scrypt(salt=salt, length=32, n=32768, r=8, p=1).derive(pin.encode())


def encrypt(key, data, label):
    nonce = secrets.token_bytes(12)
    return nonce + AESGCM(key).encrypt(nonce, data, label.encode())


def decrypt(key, data, label): return AESGCM(key).decrypt(data[:12], data[12:], label.encode())


def grant(key, *, preserve_sessions=False):
    if not preserve_sessions:
        TOKENS.clear()
    else:
        for old, (_, expiry) in list(TOKENS.items()):
            if expiry <= time.monotonic(): TOKENS.pop(old, None)
        if len(TOKENS) >= 8: raise PinError("Too many temporary unlocks. Close a deletion dialog or wait for its access to expire.")
    token = secrets.token_urlsafe(32)
    TOKENS[token] = (key, time.monotonic() + TTL)
    return {"token": token, "expires_in": TTL}


def key_for(token):
    with LOCK:
        found = TOKENS.get(token)
        if not found or time.monotonic() >= found[1]:
            TOKENS.pop(token, None)
            raise PinError("Unlock Locked Images with your PIN")
        return found[0]


def setup(pin):
    with LOCK:
        if config(): raise PinError("A PIN is already configured")
        key, salt = secrets.token_bytes(32), secrets.token_bytes(16)
        wrapped = encrypt(derive(pin, salt), key, "vault-key-v1")
        save_private(key, [])
        save_config({"version": 1, "salt": encode(salt), "wrapped_key": encode(wrapped), "locks": {}, "failures": 0, "retry_after": 0})
        return grant(key)


def unlock(pin, *, preserve_sessions=False):
    with LOCK:
        value = config()
        if not value: raise PinError("Set up your PIN first")
        if time.time() < value.get("retry_after", 0): raise PinError("Too many attempts. Wait a minute before trying again.")
        try:
            key = decrypt(derive(pin, decode(value["salt"])), decode(value["wrapped_key"]), "vault-key-v1")
        except (InvalidTag, ValueError):
            value["failures"] = value.get("failures", 0) + 1
            if value["failures"] >= 5: value["retry_after"] = time.time() + 60
            save_config(value)
            raise PinError("Incorrect PIN") from None
        value.update(failures=0, retry_after=0); save_config(value)
        return grant(key, preserve_sessions=preserve_sessions)


def change_pin(token, old_pin, new_pin):
    with LOCK:
        key_for(token)
        credentials = unlock(old_pin)
        key = key_for(credentials["token"])
        value, salt = config(), secrets.token_bytes(16)
        value.update(salt=encode(salt), wrapped_key=encode(encrypt(derive(new_pin, salt), key, "vault-key-v1")))
        save_config(value)
        return grant(key)


def lock():
    with LOCK: TOKENS.clear()


def revoke(token):
    with LOCK: TOKENS.pop(token, None)


def private_index(key):
    return json.loads(decrypt(key, (ROOT / "index.enc").read_bytes(), "vault-index-v1"))


def save_private(key, images): atomic(ROOT / "index.enc", encrypt(key, json.dumps(images, ensure_ascii=False).encode(), "vault-index-v1"))


def list_images(token):
    with LOCK: return [item for item in private_index(key_for(token)) if item["id"] in config()["locks"]]


def read_image(token, item_id):
    with LOCK:
        key = key_for(token)
        item = next((item for item in private_index(key) if item["id"] == identity(item_id)), None)
        if not item or item_id not in config()["locks"]: raise ValueError("Locked image no longer exists")
        data = decrypt(key, (ROOT / (item_id + ".enc")).read_bytes(), item_id)
        return data, item


def add(token, data, name, origin=None):
    with LOCK:
        key = key_for(token)
        if origin and origin.get("workflow_id"):
            from services.image_workflows import store
            try: store.get(origin["workflow_id"])
            except store.NotFound: raise ValueError("The source workflow was deleted") from None
        item = {**inspect(data, name), "id": uuid.uuid4().hex, "origin": origin or {"kind": "upload"}}
        current = [image for image in private_index(key) if image["id"] in config()["locks"]]
        existing = next((image for image in current if image["sha256"] == item["sha256"]), None)
        if existing: return existing
        # Also conceal existing stitched derivatives containing this output.
        blocked = {item["sha256"]}
        from services.image_workflows import store, runner
        if store.ROOT.exists():
            for record_path in store.ROOT.glob("*/jobs/*/run.json"):
                try:
                    record = json.loads(record_path.read_bytes())
                    if any(output.get("sha256") == item["sha256"] for output in record.get("outputs", [])):
                        for image in (record_path.parent / "artifacts").glob("*.png"):
                            blocked.add(hashlib.sha256(image.read_bytes()).hexdigest())
                except (OSError, ValueError):
                    raise ValueError("Could not check workflow derivatives; image was not locked")
        atomic(ROOT / (item["id"] + ".enc"), encrypt(key, data, item["id"]))
        save_private(key, [*current, item])
        value = config(); value["locks"][item["id"]] = sorted(blocked); save_config(value)
        return item


def restore(token, item_id):
    with LOCK:
        key = key_for(token)
        data, item = read_image(token, item_id)
        value = config()
        old = value["locks"].pop(item_id, [])
        save_config(value)
        try:
            from services.image_library import import_image
            public = import_image(data, item["name"], item["origin"])
        except BaseException:
            value["locks"][item_id] = old; save_config(value)
            raise
        save_private(key, [image for image in private_index(key) if image["id"] != item_id])
        (ROOT / (item_id + ".enc")).unlink(missing_ok=True)
        return public
