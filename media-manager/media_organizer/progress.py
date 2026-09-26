"""Console progress display: one self-updating line on a terminal, periodic lines otherwise."""
from __future__ import annotations

import shutil
import sys
import threading
import time


class JobProgress:
    """Thread-safe phase progress and measured, per-phase time estimates for the UI."""
    def __init__(self):
        self._lock = threading.Lock()
        self._started = self._phase_started = time.monotonic()
        self._finished = None
        self._data = {"phase": "preparing", "completed": 0, "total": None,
                      "currentFile": "", "bytesCompleted": None, "totalBytes": None}

    def update(self, phase, completed=0, total=None, currentFile="", bytesCompleted=None, totalBytes=None):
        with self._lock:
            if phase != self._data["phase"]:
                self._phase_started = time.monotonic()
            self._data = dict(phase=phase, completed=completed, total=total, currentFile=currentFile,
                              bytesCompleted=bytesCompleted, totalBytes=totalBytes)

    def finish(self, success):
        with self._lock:
            self._finished = time.monotonic()
            if success:
                self._data.update(phase="complete", currentFile="")

    def snapshot(self):
        with self._lock:
            now = self._finished if self._finished is not None else time.monotonic()
            data = dict(self._data)
            done, total = data["completed"], data["total"]
            phase_elapsed = max(0, now - self._phase_started)
            measurable = data["phase"] in ("analyzing", "moving", "extracting", "processing")
            percent = min(100, 100 * done / total) if total and measurable else None
            # File sizes and probing costs vary. Wait for a measured sample and
            # never claim an estimate for discovery or report-writing.
            eta = ((total - done) * phase_elapsed / done
                   if measurable and total and 0 < done < total and phase_elapsed >= 2 and self._finished is None else None)
            if data["phase"] == "complete":
                percent, eta = 100, 0
            return dict(data, percent=percent, elapsedSeconds=max(0, now - self._started), etaSeconds=eta)


def shorten_middle(text: str, width: int) -> str:
    if len(text) <= width:
        return text
    if width < 8:
        return text[:width]
    keep = width - 3
    head = keep // 3
    return text[:head] + "..." + text[-(keep - head):]


def human_bytes(n: float | int | None) -> str:
    if n is None:
        return "?"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def human_duration(seconds: float) -> str:
    seconds = int(max(0, seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}h{m:02d}m" if h else (f"{m}m{s:02d}s" if m else f"{s}s")


class Progress:
    def __init__(self, stream=None, enabled: bool = True, tty_interval: float = 0.2, line_interval: float = 10.0):
        self.stream = stream or sys.stderr
        self.tty = bool(getattr(self.stream, "isatty", lambda: False)())
        self.enabled = enabled
        self.interval = tty_interval if self.tty else line_interval
        self._last = 0.0
        self._width_used = 0
        self._lock = threading.Lock()

    def update(self, text: str, force: bool = False) -> None:
        if not self.enabled:
            return
        now = time.monotonic()
        with self._lock:
            if not force and now - self._last < self.interval:
                return
            self._last = now
            if self.tty:
                width = max(20, shutil.get_terminal_size((120, 20)).columns - 1)
                line = shorten_middle(text, width)
                pad = " " * max(0, self._width_used - len(line))
                self.stream.write("\r" + line + pad)
                self._width_used = len(line)
            else:
                self.stream.write(text + "\n")
            self.stream.flush()

    def clear(self) -> None:
        with self._lock:
            if self.tty and self._width_used:
                self.stream.write("\r" + " " * self._width_used + "\r")
                self.stream.flush()
            self._width_used = 0

    def line(self, text: str) -> None:
        """Print a permanent line (clearing the progress line first)."""
        self.clear()
        if self.enabled:
            self.stream.write(text + "\n")
            self.stream.flush()
