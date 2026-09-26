"""Incremental SHA-256 hashing (constant memory, regardless of file size)."""
from __future__ import annotations

import hashlib

from . import winfs

CHUNK_SIZE = 4 * 1024 * 1024


class Interrupted(Exception):
    """Raised when the user interrupts a long-running operation."""


def sha256_file(path: str, on_bytes=None, stop_event=None) -> tuple[str, int]:
    """Return (uppercase hex SHA-256, bytes read).  Reads CHUNK_SIZE at a time."""
    digest = hashlib.sha256()
    total = 0
    buf = bytearray(CHUNK_SIZE)
    view = memoryview(buf)
    with open(winfs.long_path(path), "rb", buffering=0) as f:
        while True:
            n = f.readinto(view)
            if not n:
                break
            digest.update(view[:n])
            total += n
            if on_bytes is not None:
                on_bytes(n)
            if stop_event is not None and stop_event.is_set():
                raise Interrupted()
    return digest.hexdigest().upper(), total
