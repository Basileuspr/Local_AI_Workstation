"""
Session Store Service
Manages chat sessions as individual JSON files in data/sessions/.

Key design decisions:
- Each session is a separate file — they never bleed into each other
- Sessions only load when you explicitly choose to resume one
- New sessions start completely clean — no memory from past chats
- File contents read during a session stay in THAT session only
"""

import base64
import hashlib
import binascii
import json
import uuid
import re
import threading
import os
import tempfile
from functools import wraps
from datetime import datetime
from pathlib import Path

from config import settings
from services import image_store
from services.app_logging import get_logger

logger = get_logger("backend.session_store")
_session_lock = threading.RLock()


def _serialized(function):
    @wraps(function)
    def locked(*args, **kwargs):
        with _session_lock:
            return function(*args, **kwargs)
    return locked

# Default comes from the central configuration; kept as a module constant so a
# test can redirect just this store.
SESSIONS_DIR = settings.sessions_dir

# Sessions are copied here once, immediately before their images are first
# moved out of the JSON. The originals are never modified in place.
BACKUPS_DIR = settings.data_dir / "backups" / "sessions"
GENERATED_IMAGES_DIR = settings.generated_images_dir

# Fields that can carry an image payload, and the key holding it.
_PREVIEW_FIELDS = ("imagePreviews", "generatedImages", "generated_images")
_PAYLOAD_KEYS = ("src", "url", "data")


def public_session(session):
    """Check response privacy without rewriting or redacting stored history."""
    from services import image_vault
    hashes = image_vault.locked_hashes()
    if not session or not hashes:
        return session
    for message in session.get("messages") or []:
        values = list(message.get("images") or [])
        for field in _PREVIEW_FIELDS:
            for preview in message.get(field) or []:
                if isinstance(preview, dict):
                    values.extend(preview.get(key) for key in _PAYLOAD_KEYS)
        for value in values:
            if not isinstance(value, str) or image_store.is_reference(value):
                continue
            data = image_store.decode_payload(value)
            if data and hashlib.sha256(data).hexdigest() in hashes:
                raise image_vault.LockedImageError("This older chat contains a locked image that could not be migrated. Restore the image with your PIN or repair image storage before opening or exporting this chat.")
    return session


def _externalize_message(message: dict) -> bool:
    """
    Replace inline image payloads in one message with blob references.

    Returns True if anything changed. A payload is only dropped once its bytes
    are stored and confirmed readable, so a failure here leaves the message
    exactly as it was rather than losing the picture.
    """
    changed = False

    for field in _PREVIEW_FIELDS:
        previews = message.get(field)
        if not isinstance(previews, list):
            continue
        for preview in previews:
            if not isinstance(preview, dict):
                continue
            for key in _PAYLOAD_KEYS:
                value = preview.get(key)
                if not isinstance(value, str) or image_store.is_reference(value):
                    continue
                # A served path, not a payload; nothing to move.
                if value.startswith("/") or value.startswith("http"):
                    continue
                reference = image_store.put_payload(value)
                if reference and image_store.exists(reference):
                    preview[key] = reference
                    changed = True

    raw_images = message.get("images")
    if isinstance(raw_images, list):
        for index, value in enumerate(raw_images):
            if not isinstance(value, str) or image_store.is_reference(value):
                continue
            reference = image_store.put_payload(value)
            if reference and image_store.exists(reference):
                raw_images[index] = reference
                changed = True

    return changed


def _externalize_session(session: dict) -> bool:
    """Move every inline image payload in a session out to the blob store."""
    changed = False
    for message in session.get("messages") or []:
        if isinstance(message, dict) and _externalize_message(message):
            changed = True
    return changed


def _backup_session_file(session_id: str) -> None:
    """
    Keep the pre-migration file.

    Migration rewrites sessions that may hold months of work, so the original
    is preserved before the first rewrite and never overwritten afterwards.
    """
    source = SESSIONS_DIR / f"{session_id}.json"
    if not source.exists():
        return
    try:
        BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
        target = BACKUPS_DIR / f"{session_id}.pre-blob.json"
        if not target.exists():
            target.write_bytes(source.read_bytes())
            logger.info("Backed up %s before moving images out of the JSON", session_id)
    except OSError:
        logger.exception("Could not back up session %s; leaving it unmigrated", session_id)
        raise


def _message_image_records(message: dict) -> list[dict]:
    """Normalize uploaded and future generated image records without duplicating data."""
    records = []
    seen_sources = set()

    preview_groups = (
        ("imagePreviews", None),
        ("generatedImages", "generated"),
        ("generated_images", "generated"),
    )
    for field, forced_source in preview_groups:
        previews = message.get(field) or []
        if not isinstance(previews, list):
            continue
        for preview_index, preview in enumerate(previews):
            if not isinstance(preview, dict):
                continue
            src = preview.get("src") or preview.get("url") or preview.get("data")
            if not isinstance(src, str) or not src or src in seen_sources:
                continue
            seen_sources.add(src)
            records.append({
                "id": preview.get("id") or f"{field}-{preview_index}",
                "data": src,
                "name": preview.get("name") or preview.get("filename"),
                "type": preview.get("type") or preview.get("mime_type"),
                "size": preview.get("size"),
                "source": forced_source
                or ("generated" if message.get("role") == "assistant" else "uploaded"),
            })

    raw_images = message.get("images") or []
    if isinstance(raw_images, list):
        for image_index, image_data in enumerate(raw_images):
            if not isinstance(image_data, str) or not image_data:
                continue
            if image_data in seen_sources:
                continue
            # Current uploads save both a preview data URL and the raw base64.
            # Match those by position instead of listing the same image twice.
            if image_index < len(records):
                preview_payload = records[image_index]["data"].split(",", 1)[-1]
                if preview_payload == image_data:
                    continue
            records.append({
                "id": _raw_image_id(message, image_index),
                "data": image_data,
                "name": None,
                "type": None,
                "size": None,
                "source": "generated" if message.get("role") == "assistant" else "uploaded",
            })

    return records


def _raw_image_id(message: dict, index: int) -> str:
    ids = message.get("raw_image_ids")
    if isinstance(ids, list) and index < len(ids) and isinstance(ids[index], str) and ids[index]:
        return ids[index]
    return f"raw-{message.get('id', 'legacy')}-{index}"


def _ensure_stable_ids(session: dict) -> bool:
    """Add durable IDs to legacy messages and image previews on first touch."""
    changed = False
    messages = session.get("messages")
    if not isinstance(messages, list):
        session["messages"] = []
        messages = session["messages"]
        changed = True

    for message in messages:
        if not isinstance(message, dict):
            continue
        if not isinstance(message.get("id"), str) or not message["id"]:
            message["id"] = uuid.uuid4().hex
            changed = True
        # Keep legacy raw-image identities stable when another image is deleted.
        # Initial IDs match the old URLs; newly appended images get unique IDs.
        raw = message.get("images")
        if isinstance(raw, list) and raw:
            existing = message.get("raw_image_ids")
            ids = []
            for index in range(len(raw)):
                candidate = _raw_image_id(message, index) if existing is None or (isinstance(existing, list) and index < len(existing)) else f"raw-{message['id']}-{uuid.uuid4().hex}"
                ids.append(candidate if candidate not in ids else f"raw-{message['id']}-{uuid.uuid4().hex}")
            if existing != ids:
                message["raw_image_ids"] = ids
                changed = True
        for field in ("imagePreviews", "generatedImages", "generated_images"):
            previews = message.get(field)
            if not isinstance(previews, list):
                continue
            for preview in previews:
                if isinstance(preview, dict) and not preview.get("id"):
                    preview["id"] = uuid.uuid4().hex
                    changed = True

    hidden = session.get("hidden_gallery_image_ids")
    if not isinstance(hidden, list):
        session["hidden_gallery_image_ids"] = []
        changed = True
    return changed


def _decode_image(record: dict) -> tuple[bytes, str]:
    encoded = record.get("data") or ""
    declared_type = record.get("type") or "image/jpeg"

    # Current sessions hold references; legacy ones still hold the payload
    # inline until they are migrated, so both are read here.
    if image_store.is_reference(encoded):
        found = image_store.get_bytes(encoded)
        if found is None:
            raise ValueError("Image data is no longer available")
        return found

    if encoded.startswith("data:"):
        header, separator, encoded = encoded.partition(",")
        if not separator or ";base64" not in header:
            raise ValueError("Unsupported image data URL")
        declared_type = header[5:].split(";", 1)[0] or declared_type

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Invalid image data") from exc
    from services import image_vault
    image_vault.require_public(hashlib.sha256(image_bytes).hexdigest())

    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        media_type = "image/png"
    elif image_bytes.startswith(b"\xff\xd8\xff"):
        media_type = "image/jpeg"
    elif image_bytes.startswith((b"GIF87a", b"GIF89a")):
        media_type = "image/gif"
    elif image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        media_type = "image/webp"
    elif len(image_bytes) >= 12 and image_bytes[4:8] == b"ftyp" and image_bytes[8:12] in {b"avif", b"avis"}:
        media_type = "image/avif"
    else:
        media_type = declared_type if str(declared_type).startswith("image/") else "image/jpeg"

    return image_bytes, media_type


def ensure_sessions_dir():
    """Create the sessions directory if it doesn't exist."""
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def create_session(title: str = None) -> dict:
    """
    Create a new, empty session.
    Returns the session object with a unique ID.
    No memory from any previous session is included.
    """
    ensure_sessions_dir()

    session_id = str(uuid.uuid4())[:8]  # Short readable ID like "a3f1b2c9"
    now = datetime.now().isoformat()

    session = {
        "id": session_id,
        "title": title or "New Chat",
        "created_at": now,
        "updated_at": now,
        "model": None,           # Which model was used (set on first message)
        "messages": [],          # Empty — clean slate
        "memory_summary": "",
        "summarized_message_count": 0,
        "hidden_gallery_image_ids": [],
    }

    # Save to disk immediately
    _save_session(session)
    return session


@_serialized
def get_session(session_id: str) -> dict | None:
    """
    Load a specific session by ID.
    Returns the full session including all messages, or None if not found.
    """
    ensure_sessions_dir()
    filepath = SESSIONS_DIR / f"{session_id}.json"

    if not filepath.exists():
        return None

    with open(filepath, "r", encoding="utf-8") as f:
        session = json.load(f)

    needs_save = _ensure_stable_ids(session)

    # Legacy sessions carry their images inline. Migrate on first touch, after
    # taking a backup, so opening an old chat quietly shrinks it instead of
    # requiring a separate migration step.
    try:
        if _externalize_session(session):
            _backup_session_file(session_id)
            needs_save = True
    except OSError:
        needs_save = needs_save and False

    if needs_save:
        _save_session(session)
    return session


@_serialized
def append_messages(session_id: str, messages: list[dict], model=None, memory_summary=None, summarized_message_count=None):
    """Merge this request's messages without replacing another queued result."""
    if not re.fullmatch(r"[A-Za-z0-9_-]+", session_id or ""):
        raise ValueError("Invalid session ID")
    if any(not isinstance(message, dict) or not isinstance(message.get("id"), str) or not message["id"] for message in messages):
        raise ValueError("Appended messages require stable IDs")
    session = get_session(session_id)
    if session is None:
        return None
    merged = list(session.get("messages") or [])
    indices = {message.get("id"): index for index, message in enumerate(merged)}
    for message in messages:
        if message["id"] in indices:
            merged[indices[message["id"]]] = message
        else:
            indices[message["id"]] = len(merged)
            merged.append(message)
    return update_session(session_id, merged, model=model, memory_summary=memory_summary,
                          summarized_message_count=summarized_message_count)


@_serialized
def update_session(
    session_id: str,
    messages: list,
    model: str = None,
    title: str = None,
    memory_summary: str | None = None,
    summarized_message_count: int | None = None,
) -> dict | None:
    """
    Update a session with new messages.
    Called after each exchange (user message + assistant response).
    """
    session = get_session(session_id)
    if not session:
        return None

    session["messages"] = messages
    _ensure_stable_ids(session)
    # Incoming messages may carry freshly uploaded or generated payloads; move
    # them out before the file is written so the JSON stays small.
    _externalize_session(session)
    session["updated_at"] = datetime.now().isoformat()

    if model:
        session["model"] = model

    # Auto-title: use the first user message if title is still default.
    # Reads defensively — a message missing role/content must not abort the
    # save and lose the user's turn.
    if session["title"] == "New Chat" and not title:
        first_user_msg = next(
            (m for m in messages if isinstance(m, dict) and m.get("role") == "user"),
            None,
        )
        if first_user_msg:
            # Truncate to first 50 chars for a readable title
            content = first_user_msg.get("content") or ""
            if content:
                session["title"] = content[:50] + ("..." if len(content) > 50 else "")

    if title:
        session["title"] = title

    if memory_summary is not None:
        session["memory_summary"] = memory_summary

    if summarized_message_count is not None:
        session["summarized_message_count"] = summarized_message_count

    _save_session(session)
    return session


def list_sessions() -> list:
    """
    List all sessions, sorted by most recently updated.
    Returns summary info only — not the full message history.
    This keeps the list fast even with many sessions.
    """
    ensure_sessions_dir()
    sessions = []

    for filepath in SESSIONS_DIR.glob("*.json"):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                session = json.load(f)
                sessions.append({
                    "id": session["id"],
                    "title": session["title"],
                    "created_at": session["created_at"],
                    "updated_at": session["updated_at"],
                    "model": session.get("model"),
                    "message_count": len(session.get("messages", [])),
                })
        except (json.JSONDecodeError, KeyError):
            continue  # Skip corrupted files

    # Most recent first
    sessions.sort(key=lambda s: s["updated_at"], reverse=True)
    return sessions


def list_session_images(hidden: bool = False) -> list:
    """List image metadata across chats without copying the embedded image data."""
    ensure_sessions_dir()
    images = []
    from services import image_vault
    locked = image_vault.locked_hashes()

    for filepath in SESSIONS_DIR.glob("*.json"):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                session = json.load(f)
            if _ensure_stable_ids(session):
                _save_session(session)

            messages = session.get("messages", [])
            hidden_image_ids = set(session.get("hidden_gallery_image_ids", []))
            for message_index in range(len(messages) - 1, -1, -1):
                message = messages[message_index]
                if not isinstance(message, dict):
                    continue
                records = _message_image_records(message)
                for image_index in range(len(records) - 1, -1, -1):
                    record = records[image_index]
                    image_id = record["id"]
                    if (image_id in hidden_image_ids) != hidden:
                        continue
                    if locked:
                        raw = record.get("data") or ""
                        digest = raw.removeprefix("blob:") if image_store.is_reference(raw) else hashlib.sha256(image_store.decode_payload(raw) or b"").hexdigest()
                        if digest in locked: continue
                    images.append({
                        "id": f"{session['id']}:{message['id']}:{image_id}",
                        "session_id": session["id"],
                        "session_title": session.get("title") or "New Chat",
                        "message_id": message["id"],
                        "image_id": image_id,
                        "message_index": message_index,
                        "image_index": image_index,
                        "name": record.get("name") or f"Chat image {image_index + 1}",
                        "type": record.get("type"),
                        "size": record.get("size"),
                        "source": record.get("source") or "uploaded",
                        "updated_at": session.get("updated_at") or session.get("created_at") or "",
                        "url": f"/sessions/{session['id']}/images/by-id/{message['id']}/{image_id}",
                    })
        except (json.JSONDecodeError, KeyError, TypeError):
            continue

    images.sort(key=lambda image: image["updated_at"], reverse=True)
    return images


def get_session_image(
    session_id: str,
    message_index: int,
    image_index: int,
) -> tuple[bytes, str] | None:
    """Read one image from its owning session on demand."""
    session = get_session(session_id)
    if not session:
        return None

    messages = session.get("messages", [])
    if message_index < 0 or message_index >= len(messages):
        return None

    records = _message_image_records(messages[message_index])
    if image_index < 0 or image_index >= len(records):
        return None

    try:
        return _decode_image(records[image_index])
    except ValueError:
        return None


def get_session_image_by_id(
    session_id: str,
    message_id: str,
    image_id: str,
) -> tuple[bytes, str] | None:
    """Read an image by durable message and image IDs."""
    session = get_session(session_id)
    if not session:
        return None
    message = next(
        (item for item in session.get("messages", []) if item.get("id") == message_id),
        None,
    )
    if not message:
        return None
    record = next((item for item in _message_image_records(message) if item["id"] == image_id), None)
    if not record:
        return None
    try:
        return _decode_image(record)
    except ValueError:
        return None


@_serialized
def hide_session_image(session_id: str, image_id: str, hidden: bool = True) -> bool:
    """Remove an item from the gallery while preserving its original chat record."""
    session = get_session(session_id)
    if not session:
        return False

    image_exists = any(
        record["id"] == image_id
        for message in session.get("messages", [])
        if isinstance(message, dict)
        for record in _message_image_records(message)
    )
    if not image_exists:
        return False

    hidden_ids = session.setdefault("hidden_gallery_image_ids", [])
    if hidden and image_id not in hidden_ids:
        hidden_ids.append(image_id)
        _save_session(session)
    elif not hidden and image_id in hidden_ids:
        hidden_ids.remove(image_id)
        _save_session(session)
    return True


def _references_in(value: object) -> set[str]:
    """Collect blob references from a JSON-shaped object without trusting its shape."""
    if isinstance(value, str):
        return {value} if image_store.is_reference(value) else set()
    if isinstance(value, list):
        return set().union(*(_references_in(item) for item in value)) if value else set()
    if isinstance(value, dict):
        return set().union(*(_references_in(item) for item in value.values())) if value else set()
    return set()


def _stored_sessions(include_backups: bool = True):
    directories = [SESSIONS_DIR, TRASH_DIR]
    if include_backups:
        directories.append(BACKUPS_DIR)
    for directory in directories:
        if not directory.exists():
            continue
        yield from directory.glob("*.json")


def _reference_is_retained(reference: str) -> bool:
    for path in _stored_sessions():
        try:
            if reference in _references_in(json.loads(path.read_text(encoding="utf-8"))):
                return True
        except (OSError, json.JSONDecodeError):
            # Keep the blob if a session cannot be inspected. A wasted file is
            # safer than a broken recoverable image.
            return True
    return False


def _generated_output_is_retained(filename: str) -> bool:
    if not filename:
        return False
    for path in _stored_sessions(include_backups=False):
        try:
            session = json.loads(path.read_text(encoding="utf-8"))
            for message in session.get("messages") or []:
                if isinstance(message, dict):
                    for record in _message_image_records(message):
                        if record.get("source") == "generated" and record.get("name") == filename:
                            return True
        except (OSError, json.JSONDecodeError, TypeError):
            return True
    return False


def _remove_migration_backup(session_id: str) -> None:
    """A backup can contain the exact image a user chose to erase."""
    backup = BACKUPS_DIR / f"{session_id}.pre-blob.json"
    try:
        backup.unlink(missing_ok=True)
    except OSError:
        logger.exception("Could not remove migration backup for session %s", session_id)


def _remove_blob_if_unused(reference: str | None) -> None:
    if reference and image_store.is_reference(reference) and not _reference_is_retained(reference):
        image_store.remove(reference)


@_serialized
def permanently_delete_session_image(session_id: str, image_id: str) -> bool:
    """Erase an image from its chat and disk, preserving any shared blob."""
    session = get_session(session_id)
    if not session:
        return False

    for message in session.get("messages") or []:
        if not isinstance(message, dict):
            continue
        for field in _PREVIEW_FIELDS:
            previews = message.get(field)
            if not isinstance(previews, list):
                continue
            for index, preview in enumerate(previews):
                if not isinstance(preview, dict) or preview.get("id") != image_id:
                    continue
                source = next((preview.get(key) for key in _PAYLOAD_KEYS if isinstance(preview.get(key), str)), None)
                filename = preview.get("name") if field in {"generatedImages", "generated_images"} else None
                del previews[index]
                # Legacy uploads carried both an image preview and the same
                # raw payload. Delete the paired raw value too.
                if source and isinstance(message.get("images"), list):
                    kept = [(value, _raw_image_id(message, index)) for index, value in enumerate(message["images"]) if value != source]
                    message["images"] = [value for value, _ in kept]
                    message["raw_image_ids"] = [image_id for _, image_id in kept]
                session["hidden_gallery_image_ids"] = [item for item in session.get("hidden_gallery_image_ids", []) if item != image_id]
                _remove_migration_backup(session_id)
                _save_session(session)
                _remove_blob_if_unused(source)
                if filename and not _generated_output_is_retained(filename):
                    try:
                        (GENERATED_IMAGES_DIR / Path(filename).name).unlink(missing_ok=True)
                    except OSError:
                        logger.exception("Could not remove generated image %s", filename)
                return True

        raw_images = message.get("images")
        if isinstance(raw_images, list):
            for index, value in enumerate(raw_images):
                if image_id != _raw_image_id(message, index):
                    continue
                ids = [_raw_image_id(message, i) for i in range(len(raw_images))]
                del raw_images[index]
                del ids[index]
                message["raw_image_ids"] = ids
                session["hidden_gallery_image_ids"] = [item for item in session.get("hidden_gallery_image_ids", []) if item != image_id]
                _remove_migration_backup(session_id)
                _save_session(session)
                _remove_blob_if_unused(value if isinstance(value, str) else None)
                return True
    return False


TRASH_DIR = settings.data_dir / "trash" / "sessions"


@_serialized
def delete_session(session_id: str) -> bool:
    """
    Remove a session from the list, keeping the file.

    Deletion used to unlink immediately, with no confirmation and no way back,
    while removing a single gallery image asked first. A conversation is worth
    more than one picture, so the file is moved aside instead of destroyed and
    can be restored.
    """
    ensure_sessions_dir()
    filepath = SESSIONS_DIR / f"{session_id}.json"

    if not filepath.exists():
        return False

    try:
        TRASH_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        filepath.replace(TRASH_DIR / f"{session_id}.{stamp}.json")
        logger.info("Moved session %s to the trash", session_id)
    except OSError:
        logger.exception("Could not move session %s to the trash; preserving the original", session_id)
        raise

    return True


def list_deleted_sessions() -> list[dict]:
    """Sessions in the trash, most recently deleted first."""
    if not TRASH_DIR.exists():
        return []

    entries = []
    for filepath in TRASH_DIR.glob("*.json"):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                session = json.load(f)
            entries.append({
                "id": session.get("id") or filepath.stem.split(".")[0],
                "title": session.get("title") or "Untitled",
                "message_count": len(session.get("messages") or []),
                "deleted_at": datetime.fromtimestamp(filepath.stat().st_mtime).isoformat(),
                "file": filepath.name,
            })
        except (json.JSONDecodeError, KeyError, OSError):
            continue

    entries.sort(key=lambda entry: entry["deleted_at"], reverse=True)
    return entries


def restore_session(filename: str) -> dict | None:
    """Put a trashed session back, refusing any path that escapes the trash."""
    safe_name = Path(filename).name
    source = TRASH_DIR / safe_name
    if not source.is_file():
        return None

    try:
        with open(source, "r", encoding="utf-8") as f:
            session = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None

    session_id = session.get("id") or safe_name.split(".")[0]
    session["id"] = session_id
    ensure_sessions_dir()
    _save_session(session)
    source.unlink(missing_ok=True)
    logger.info("Restored session %s from the trash", session_id)
    return session


def permanently_delete_trashed_session(filename: str) -> bool:
    """Erase one trashed chat, its backup, SQLite transcript, and unused blobs."""
    source = TRASH_DIR / Path(filename).name
    if not source.is_file():
        return False
    try:
        session = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False

    session_id = session.get("id") or source.name.split(".")[0]
    references = _references_in(session)
    generated = {
        record.get("name")
        for message in session.get("messages") or []
        if isinstance(message, dict)
        for record in _message_image_records(message)
        if record.get("source") == "generated" and record.get("name")
    }
    try:
        from services.memory_store import delete_chat_session_data
        delete_chat_session_data(session_id)
        source.unlink()
    except OSError:
        logger.exception("Could not permanently remove trashed session %s", session_id)
        return False

    # Retain a backup only when another active or trashed copy of this same
    # session still exists and could be restored.
    same_session_remains = False
    for path in _stored_sessions(include_backups=False):
        try:
            if json.loads(path.read_text(encoding="utf-8")).get("id") == session_id:
                same_session_remains = True
                break
        except (OSError, json.JSONDecodeError):
            continue
    if not same_session_remains:
        _remove_migration_backup(session_id)
    for reference in references:
        _remove_blob_if_unused(reference)
    for filename in generated:
        if not _generated_output_is_retained(filename):
            try:
                (GENERATED_IMAGES_DIR / Path(filename).name).unlink(missing_ok=True)
            except OSError:
                logger.exception("Could not remove generated image %s", filename)
    logger.info("Permanently removed trashed session %s", session_id)
    return True


# --- Internal helpers ---

@_serialized
def _save_session(session: dict):
    """Replace a complete JSON file; a failed write preserves the previous chat."""
    ensure_sessions_dir()
    filepath = SESSIONS_DIR / f"{session['id']}.json"

    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=SESSIONS_DIR,
                                         prefix=".pending-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(session, stream, indent=2, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(filepath)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
