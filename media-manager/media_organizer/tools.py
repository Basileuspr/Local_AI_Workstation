"""Discovery of, and wrappers around, the external tools.

* ffprobe  (part of FFmpeg) - required by default: stream-level validation,
  codecs, frame rate, bit rate, container tags.
* exiftool - recommended: deeper maker/QuickTime/XMP metadata.
* ffmpeg   - on-demand UI thumbnails and the test-data generator.

Every lookup reports *why* a tool is unusable (missing, blocked by Windows
permissions, wrong file name...) instead of failing silently.
"""
from __future__ import annotations

import collections
import glob
import json
import os
import queue
import re
import subprocess
import threading
import time
from dataclasses import dataclass

from . import winfs

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS_DIR = os.path.join(PROJECT_ROOT, "tools")
ENV_VARS = {"ffprobe": "MEDIA_ORGANIZER_FFPROBE", "ffmpeg": "MEDIA_ORGANIZER_FFMPEG",
            "exiftool": "MEDIA_ORGANIZER_EXIFTOOL"}

INSTALL_HELP = {
    "ffprobe": [
        "Install FFmpeg (includes ffprobe):  winget install -e --id Gyan.FFmpeg   (then open a NEW terminal)",
        "  or download a build from https://www.gyan.dev/ffmpeg/builds/ and copy ffprobe.exe into:",
        f"  {TOOLS_DIR}",
        "  or pass --ffprobe \"C:\\path\\to\\ffprobe.exe\"",
    ],
    "exiftool": [
        "Install ExifTool:  winget install -e --id OliverBetz.ExifTool   (then open a NEW terminal)",
        "  or download the Windows package from https://exiftool.org, rename 'exiftool(-k).exe' to",
        f"  'exiftool.exe' and copy it (with its exiftool_files folder) into: {TOOLS_DIR}",
        "  or pass --exiftool \"C:\\path\\to\\exiftool.exe\"",
    ],
}
INSTALL_HELP["ffmpeg"] = INSTALL_HELP["ffprobe"]


@dataclass
class ToolInfo:
    name: str
    path: str | None = None
    version: str | None = None
    status: str = "missing"       # ok | missing | not-runnable | broken | disabled
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    def describe(self) -> str:
        if self.ok:
            return f"{self.name}: OK (version {self.version}) at {self.path}"
        if self.status == "disabled":
            return f"{self.name}: disabled by command-line option"
        where = f" at {self.path}" if self.path else ""
        return f"{self.name}: {self.status.upper()}{where} - {self.detail}"

    def as_dict(self) -> dict:
        return {"name": self.name, "path": self.path, "version": self.version,
                "status": self.status, "detail": self.detail}


def _exe(name: str) -> str:
    return name + ".exe" if winfs.IS_WINDOWS else name


def _path_search(name: str):
    exe = _exe(name)
    for d in os.environ.get("PATH", "").split(os.pathsep):
        d = d.strip().strip('"')
        if d:
            p = os.path.join(d, exe)
            if os.path.lexists(p):  # lexists: also report links whose target is blocked
                yield p


def _well_known(name: str) -> list:
    local = os.environ.get("LOCALAPPDATA", "")
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    home = os.path.expanduser("~")
    exe = _exe(name)
    if name in ("ffprobe", "ffmpeg"):
        paths = [os.path.join(local, "Microsoft", "WinGet", "Links", exe),
                 os.path.join(pf, "WinGet", "Links", exe)]
        for base in (os.path.join(local, "Microsoft", "WinGet", "Packages"), os.path.join(pf, "WinGet", "Packages")):
            for pattern in ("Gyan.FFmpeg*", "BtbN.FFmpeg*"):
                paths += sorted(glob.glob(os.path.join(base, pattern, "*", "bin", exe)))
        paths += [os.path.join(r"C:\ProgramData\chocolatey\bin", exe), os.path.join(home, "scoop", "shims", exe),
                  os.path.join(r"C:\ffmpeg\bin", exe), os.path.join(pf, "ffmpeg", "bin", exe)]
        return paths
    return [os.path.join(pf, "ExifTool", exe), os.path.join(pf86, "ExifTool", exe),
            os.path.join(local, "Programs", "ExifTool", "ExifTool.exe"),
            os.path.join(r"C:\ProgramData\chocolatey\bin", exe), os.path.join(home, "scoop", "shims", exe),
            os.path.join(r"C:\Windows", exe)]


def _candidates(name: str, explicit: str | None) -> list:
    out = []

    def add(p):
        if p and p not in out:
            out.append(p)

    if explicit:
        return [explicit]
    add(os.environ.get(ENV_VARS[name]))
    exe = _exe(name)
    add(os.path.join(TOOLS_DIR, exe))
    for p in sorted(glob.glob(os.path.join(TOOLS_DIR, "*", exe)) + glob.glob(os.path.join(TOOLS_DIR, "*", "bin", exe))):
        add(p)
    for p in _path_search(name):
        add(p)
    for p in _well_known(name):
        add(p)
    if name == "exiftool":
        for d in [TOOLS_DIR] + glob.glob(os.path.join(TOOLS_DIR, "*")):
            add(os.path.join(d, "exiftool(-k).exe"))
    return out


def _permission_help(path: str, exc: BaseException) -> str:
    try:
        real = os.path.realpath(path)
    except OSError:
        real = path
    parts = [f"Windows refused to run it ({winfs.describe_error(exc)})."]
    m = re.search(r"^(.*\\WinGet\\Packages\\[^\\]+)", real, re.IGNORECASE)
    if m:
        parts.append("It was installed by winget from an administrator prompt, and its folder only grants "
                     "access to administrators. Fix (once, in PowerShell opened with 'Run as administrator'):  "
                     f"icacls \"{m.group(1)}\" /grant \"*S-1-5-32-545:(OI)(CI)RX\" /T /C   "
                     "- or reinstall per-user: winget uninstall Gyan.FFmpeg ; winget install -e --id Gyan.FFmpeg --scope user")
    else:
        parts.append("Check the file's permissions, or copy the tool into the project's tools\\ folder.")
    return " ".join(parts)


def _check_runnable(name: str, path: str) -> tuple[str, str | None, str]:
    if name == "exiftool" and path.lower().endswith("(-k).exe"):
        return ("broken", None, "this is 'exiftool(-k).exe' from the ExifTool zip - rename it to "
                                "'exiftool.exe' (the '-k' version waits for a key press)")
    args = [path, "-ver"] if name == "exiftool" else [path, "-hide_banner", "-version"]
    try:
        cp = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
    except PermissionError as exc:
        return "not-runnable", None, _permission_help(path, exc)
    except OSError as exc:
        if getattr(exc, "winerror", None) == 5:
            return "not-runnable", None, _permission_help(path, exc)
        return "broken", None, f"could not start it: {winfs.describe_error(exc)}"
    except subprocess.TimeoutExpired:
        return "broken", None, "it did not respond within 60 seconds"
    out = (cp.stdout or b"").decode("utf-8", "replace").strip()
    if cp.returncode != 0 or not out:
        err = (cp.stderr or b"").decode("utf-8", "replace").strip()[:300]
        return "broken", None, f"exit code {cp.returncode}: {err or 'no output'}"
    first = out.splitlines()[0].strip()
    if name == "exiftool":
        return "ok", first, ""
    m = re.search(r"version\s+(\S+)", first)
    return "ok", (m.group(1) if m else first[:80]), ""


def find_tool(name: str, explicit: str | None = None) -> ToolInfo:
    """Locate a working copy of a tool, or explain precisely why none is usable."""
    failure = None
    for path in _candidates(name, explicit):
        if not os.path.lexists(path):
            if explicit:
                return ToolInfo(name, path, None, "missing", "the path given does not exist")
            continue
        status, version, detail = _check_runnable(name, path)
        if status == "ok":
            return ToolInfo(name, path, version, "ok", "")
        if failure is None:
            failure = ToolInfo(name, path, None, status, detail)
    return failure or ToolInfo(name, None, None, "missing",
                               "not found on PATH, in the tools\\ folder or in the usual install locations")


# --------------------------------------------------------------------------
# ffprobe
# --------------------------------------------------------------------------
def run_ffprobe(ffprobe: str, path: str, timeout: int = 180) -> tuple[dict | None, str | None]:
    """Return (parsed JSON, error-or-warning text).  Never raises for tool failures."""
    target = "file:" + winfs.tool_path(path)  # 'file:' stops FFmpeg treating ':' as a protocol
    args = [ffprobe, "-v", "error", "-hide_banner", "-show_error", "-show_format", "-show_streams",
            "-of", "json", target]
    try:
        cp = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None, f"ffprobe timed out after {timeout}s"
    except OSError as exc:
        return None, f"could not run ffprobe: {winfs.describe_error(exc)}"
    err = (cp.stderr or b"").decode("utf-8", "replace").strip()
    text = (cp.stdout or b"").decode("utf-8", "replace")
    try:
        data = json.loads(text) if text.strip() else {}
    except json.JSONDecodeError as exc:
        return None, f"unreadable ffprobe output ({exc}); stderr: {err[:300]}"
    if "error" in data:
        msg = (data.get("error") or {}).get("string") or err or "unknown error"
        return data, f"ffprobe error: {msg}"
    if cp.returncode != 0:
        return data or None, f"ffprobe exit code {cp.returncode}: {err[:300]}"
    return data, (err[:500] or None)


# --------------------------------------------------------------------------
# exiftool (-stay_open session)
# --------------------------------------------------------------------------
class ExifToolSession:
    """One long-running exiftool process shared by all worker threads.

    Requests are serialised with a lock.  If the process hangs or dies it is
    killed and restarted, and only the affected file is reported as failed.
    """

    COMMON_ARGS = ["-j", "-G1", "-a", "-s", "-n", "-api", "largefilesupport=1", "-charset", "filename=utf8"]

    def __init__(self, path: str, timeout: int = 120):
        self.path = path
        self.timeout = timeout
        self._lock = threading.Lock()
        self._proc = None
        self._out = None
        self._counter = 0
        self._stderr_tail = collections.deque(maxlen=40)

    def _start(self):
        args = [self.path, "-stay_open", "True", "-@", "-", "-common_args"] + self.COMMON_ARGS
        self._proc = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE)
        self._out = queue.Queue()
        threading.Thread(target=self._pump_out, args=(self._proc.stdout, self._out), daemon=True).start()
        threading.Thread(target=self._pump_err, args=(self._proc.stderr,), daemon=True).start()

    @staticmethod
    def _pump_out(stream, q):
        for line in iter(stream.readline, b""):
            q.put(line)
        q.put(None)

    def _pump_err(self, stream):
        for line in iter(stream.readline, b""):
            self._stderr_tail.append(line.decode("utf-8", "replace").rstrip())

    def _kill(self):
        if self._proc is not None:
            try:
                self._proc.kill()
                self._proc.wait(timeout=10)
            except Exception:
                pass
        self._proc = None

    def read(self, path: str) -> tuple[dict | None, str | None]:
        with self._lock:
            for attempt in (1, 2):
                if self._proc is None or self._proc.poll() is not None:
                    try:
                        self._start()
                    except OSError as exc:
                        return None, f"could not start exiftool: {winfs.describe_error(exc)}"
                self._counter += 1
                ready = f"{{ready{self._counter}}}".encode()
                self._stderr_tail.clear()
                try:
                    self._proc.stdin.write((winfs.tool_path(path) + "\n" + f"-execute{self._counter}\n").encode("utf-8"))
                    self._proc.stdin.flush()
                except OSError:
                    self._kill()
                    continue
                lines = []
                deadline = time.monotonic() + self.timeout
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        self._kill()
                        return None, f"exiftool timed out after {self.timeout}s"
                    try:
                        line = self._out.get(timeout=remaining)
                    except queue.Empty:
                        continue
                    if line is None:  # process exited
                        self._kill()
                        break
                    if line.strip() == ready:
                        text = b"".join(lines).decode("utf-8", "replace").strip()
                        if not text:
                            time.sleep(0.05)
                            err = " | ".join(self._stderr_tail) or "no output"
                            return None, f"exiftool: {err}"
                        try:
                            data = json.loads(text)
                        except json.JSONDecodeError as exc:
                            return None, f"unreadable exiftool output: {exc}"
                        return (data[0] if data else None), None
                    lines.append(line)
                if attempt == 2:
                    break
            return None, "exiftool stopped unexpectedly: " + (" | ".join(self._stderr_tail) or "no details")

    def close(self):
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                try:
                    self._proc.stdin.write(b"-stay_open\nFalse\n")
                    self._proc.stdin.flush()
                    self._proc.wait(timeout=15)
                except Exception:
                    self._kill()
            self._proc = None
