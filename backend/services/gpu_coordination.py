"""One process-wide lease for local GPU-heavy image work."""

from __future__ import annotations

import threading


class GpuCoordinator:
    """Coordinate long-lived GPU work across independent service managers."""

    def __init__(self) -> None:
        self._lease = threading.Lock()
        self._state = threading.Lock()
        self._owner: str | None = None
        self._reserved = False

    def acquire(self, owner: str) -> bool:
        with self._state:
            # A queue reservation is handed to its matching service exactly once.
            if self._owner == owner and self._reserved:
                self._reserved = False
                return True
            if not self._lease.acquire(blocking=False):
                return False
            self._owner = owner
        return True

    def reserve(self, owner: str) -> bool:
        with self._state:
            if not self._lease.acquire(blocking=False):
                return False
            self._owner = owner
            self._reserved = True
            return True

    def release(self, owner: str) -> bool:
        with self._state:
            if self._owner != owner:
                return False
            self._owner = None
            self._reserved = False
            self._lease.release()
        return True

    def current_owner(self) -> str | None:
        with self._state:
            return self._owner


gpu_coordinator = GpuCoordinator()
