"""
Content-addressed storage for image payloads.

Images used to live inside the session JSON as base64: an uploaded picture was
saved twice (raw payload plus a preview data URL), and a generated one existed
both as a PNG on disk and again as base64 in the transcript. Every session save
then rewrote the whole file, megabytes at a time, and listing the gallery
parsed all of it.

Payloads now live here as files named by the SHA-256 of their content, and the
session JSON keeps only a reference. Addressing by content means the same
picture attached twice costs one copy, and a rewrite never rewrites the bytes.

Nothing in here deletes. Blobs are small relative to what they replace, and a
reference that outlives its file is a broken image the user cannot recover;
an orphan is merely wasted space. Reclaiming orphans is a deliberate,
separate operation.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import re
from pathlib import Path

from config import settings
from services.app_logging import get_logger

logger = get_logger("backend.image_store")

BLOBS_DIR = settings.data_dir / "blobs"

# A stored reference. Kept deliberately narrow so a malformed or hostile value
# can never escape the blob directory.
REF_PREFIX = "blob:"
REF_PATTERN = re.compile(r"^blob:([0-9a-f]{64})$")

SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"GIF87a", "image/gif", ".gif"),
    (b"GIF89a", "image/gif", ".gif"),
)


def is_reference(value: object) -> bool:
    return isinstance(value, str) and bool(REF_PATTERN.match(value))


def _sniff(data: bytes) -> tuple[str, str]:
    """Return (media_type, suffix) from the magic bytes."""
    for signature, media_type, suffix in SIGNATURES:
        if data.startswith(signature):
            return media_type, suffix
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp", ".webp"
    if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in {b"avif", b"avis"}:
        return "image/avif", ".avif"
    return "application/octet-stream", ".bin"


def decode_payload(value: str) -> bytes | None:
    """
    Decode a data URL or bare base64 string into bytes.

    Returns None for anything that is not decodable image data, so callers can
    leave unrecognised values untouched rather than destroying them.
    """
    if not isinstance(value, str) or not value:
        return None
    encoded = value
    if encoded.startswith("data:"):
        header, separator, encoded = encoded.partition(",")
        if not separator or ";base64" not in header:
            return None
    try:
        return base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        return None


def ensure_dir() -> None:
    BLOBS_DIR.mkdir(parents=True, exist_ok=True)


def put_bytes(data: bytes) -> str:
    """
    Store bytes and return their reference.

    Written to a temporary name and then moved into place, so a reference is
    never handed out for a file that is still being written.
    """
    ensure_dir()
    digest = hashlib.sha256(data).hexdigest()
    _, suffix = _sniff(data)
    target = BLOBS_DIR / f"{digest}{suffix}"

    if not target.exists():
        temporary = BLOBS_DIR / f"{digest}.partial"
        temporary.write_bytes(data)
        temporary.replace(target)

    return f"{REF_PREFIX}{digest}"


def put_payload(value: str) -> str | None:
    """Store a data URL or base64 string, returning its reference."""
    data = decode_payload(value)
    if data is None:
        return None
    return put_bytes(data)


def _path_for(reference: str) -> Path | None:
    match = REF_PATTERN.match(reference or "")
    if not match:
        return None
    digest = match.group(1)
    ensure_dir()
    for candidate in BLOBS_DIR.glob(f"{digest}.*"):
        if candidate.suffix != ".partial" and candidate.is_file():
            return candidate
    return None


def exists(reference: str) -> bool:
    return _path_for(reference) is not None


def get_bytes(reference: str) -> tuple[bytes, str] | None:
    """Read a stored payload, returning (bytes, media_type)."""
    from services import image_vault
    if image_vault.is_locked((reference or "").removeprefix("blob:")): return None
    path = _path_for(reference)
    if path is None:
        return None
    try:
        data = path.read_bytes()
    except OSError:
        logger.exception("Could not read image blob %s", reference)
        return None
    media_type, _ = _sniff(data)
    return data, media_type


def get_base64(reference: str) -> str | None:
    """Read a stored payload back as base64, for sending to a vision model."""
    found = get_bytes(reference)
    if found is None:
        return None
    return base64.b64encode(found[0]).decode("ascii")


def stat(reference: str) -> dict | None:
    """Size and media type without reading the whole payload."""
    path = _path_for(reference)
    if path is None:
        return None
    try:
        header = path.open("rb").read(16)
        media_type, _ = _sniff(header)
        return {"size": path.stat().st_size, "type": media_type}
    except OSError:
        return None


def remove(reference: str) -> bool:
    """Permanently remove one blob after its caller proved it is unreferenced."""
    path = _path_for(reference)
    if path is None:
        return False
    try:
        path.unlink()
        return True
    except OSError:
        logger.exception("Could not remove image blob %s", reference)
        return False
