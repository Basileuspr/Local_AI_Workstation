"""Small, on-demand video thumbnails. Originals are only read; cache is in memory."""
from collections import OrderedDict
from pathlib import Path
import subprocess
import threading

from . import tools


class ThumbnailUnavailable(ValueError):
    pass


class ThumbnailCache:
    def __init__(self, capacity=128):
        self.capacity = capacity
        self._cache = OrderedDict()
        self._lock = threading.Lock()
        self._workers = threading.BoundedSemaphore(2)
        self._tool = None

    def get(self, path: Path, size="small") -> bytes:
        dimensions = {"small": (320, 180), "large": (960, 540), "full": (1920, 1080)}
        if size not in dimensions:
            raise ValueError("Unknown thumbnail size.")
        width, height = dimensions[size]
        stat = path.stat()
        key = (str(path), stat.st_size, stat.st_mtime_ns, size)
        # At most two decoders run at once, even when a whole grid loads.
        with self._workers:
            with self._lock:
                if key in self._cache:
                    image = self._cache[key]
                    self._cache.move_to_end(key)
                    if image:
                        return image
                    raise ThumbnailUnavailable("No video thumbnail is available for this file.")
                if self._tool is None:
                    self._tool = tools.find_tool("ffmpeg")
                tool = self._tool
            if not tool.ok:
                raise ThumbnailUnavailable("FFmpeg is unavailable; video thumbnails cannot be generated.")
            image = None
            # Retry the first frame for clips shorter than the initial seek.
            for position in (0.5, 0):
                try:
                    result = subprocess.run(
                        [tool.path, "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1",
                         "-protocol_whitelist", "file,pipe", "-ss", str(position), "-i", str(path),
                         "-map", "0:v:0", "-frames:v", "1", "-an", "-sn",
                         "-vf", f"scale=w='min({width},iw)':h='min({height},ih)':force_original_aspect_ratio=decrease,setsar=1",
                         "-threads", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "pipe:1"],
                        stdin=subprocess.DEVNULL, capture_output=True, timeout=12,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                except (OSError, subprocess.TimeoutExpired):
                    break
                if result.returncode == 0 and result.stdout.startswith(b"\xff\xd8") and len(result.stdout) <= 2_000_000:
                    image = result.stdout
                    break
            with self._lock:
                self._cache[key] = image
                self._cache.move_to_end(key)
                while len(self._cache) > self.capacity or sum(len(value) for value in self._cache.values() if value) > 24_000_000:
                    self._cache.popitem(last=False)
            if not image:
                raise ThumbnailUnavailable("No video thumbnail is available for this file.")
            return image
