"""Windows-aware filesystem helpers.

All filesystem access in the tool goes through long_path() so that folders
nested deeper than the classic 260-character MAX_PATH limit keep working even
when Windows long-path support is disabled.  Paths shown to the user and stored
in manifests never carry the \\\\?\\ prefix (see display_path()).
"""
from __future__ import annotations

import ctypes
import os
from datetime import datetime

IS_WINDOWS = os.name == "nt"

FILE_ATTRIBUTE_REPARSE_POINT = 0x400
FILE_ATTRIBUTE_OFFLINE = 0x1000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000
CLOUD_ATTRIBUTES = (FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN
                    | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS)
# Reparse tags with this bit redirect to another path (symlinks, junctions,
# mount points).  Other reparse points (e.g. OneDrive folders) are safe to walk.
REPARSE_TAG_NAME_SURROGATE = 0x20000000
IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003

_PREFIX = "\\\\?\\"
_UNC_PREFIX = "\\\\?\\UNC\\"


def long_path(path: str) -> str:
    """Return the extended-length (\\\\?\\) form of a path on Windows."""
    if not IS_WINDOWS or path.startswith(_PREFIX):
        return path
    p = path.replace("/", "\\")
    if p.startswith("\\\\"):
        return _UNC_PREFIX + os.path.normpath(p)[2:]
    if not (len(p) >= 3 and p[1] == ":" and p[2] == "\\"):
        p = os.path.abspath(p)
        if p.startswith("\\\\"):
            return _UNC_PREFIX + p[2:]
        return _PREFIX + p
    return _PREFIX + os.path.normpath(p)


def display_path(path: str) -> str:
    """Strip the extended-length prefix for display and manifests."""
    if path.startswith(_UNC_PREFIX):
        return "\\\\" + path[len(_UNC_PREFIX):]
    if path.startswith(_PREFIX):
        return path[len(_PREFIX):]
    return path


def tool_path(path: str) -> str:
    """Path form to hand to external tools (extended form only when needed)."""
    if not IS_WINDOWS:
        return path
    name = os.path.basename(path)
    if len(path) >= 240 or name != name.rstrip(" ."):
        return long_path(path)
    return path


def norm_key(path: str) -> str:
    """Case-insensitive comparison key for an absolute path."""
    return os.path.normcase(os.path.abspath(display_path(path))).rstrip("\\/")


def is_within(child: str, parent: str) -> bool:
    """True if child is parent or lies somewhere below it."""
    c, p = norm_key(child), norm_key(parent)
    return c == p or c.startswith(p + os.sep)


def describe_error(exc: BaseException) -> str:
    if isinstance(exc, OSError):
        code = getattr(exc, "winerror", None) or exc.errno
        msg = exc.strerror or str(exc)
        return f"{msg} (code {code})" if code else msg
    return f"{type(exc).__name__}: {exc}"


def file_times(st) -> tuple[float, float | None]:
    """(modified, created) timestamps from a stat result."""
    created = getattr(st, "st_birthtime", None)
    if created is None and IS_WINDOWS:
        created = st.st_ctime  # on Windows before Python 3.12 st_ctime is creation time
    return st.st_mtime, created


def link_kind(entry) -> str | None:
    """Describe a directory entry that must not be followed, else None."""
    try:
        if entry.is_symlink():
            return "symbolic link"
    except OSError:
        pass
    if IS_WINDOWS:
        try:
            st = entry.stat(follow_symlinks=False)
        except OSError:
            return None
        if getattr(st, "st_file_attributes", 0) & FILE_ATTRIBUTE_REPARSE_POINT:
            tag = getattr(st, "st_reparse_tag", 0)
            if tag == IO_REPARSE_TAG_MOUNT_POINT:
                return "directory junction / mount point"
            if tag & REPARSE_TAG_NAME_SURROGATE:
                return f"reparse point (tag 0x{tag:08X})"
    return None


def is_cloud_placeholder(attributes: int) -> bool:
    """Online-only cloud files (OneDrive etc.): reading them triggers a download."""
    return bool(attributes & CLOUD_ATTRIBUTES)


def format_local(ts: float | None) -> str:
    if ts is None:
        return ""
    try:
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
    except (OverflowError, OSError, ValueError):
        return ""


_kernel32 = None


def _k32():
    global _kernel32
    if _kernel32 is None:
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID,
                                  wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        k.CreateFileW.restype = wintypes.HANDLE
        k.SetFileTime.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.FILETIME),
                                  ctypes.POINTER(wintypes.FILETIME), ctypes.POINTER(wintypes.FILETIME)]
        k.SetFileTime.restype = wintypes.BOOL
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        _kernel32 = k
    return _kernel32


def set_creation_time(path: str, timestamp: float) -> bool:
    """Set a file's Windows creation time.  Returns False where unsupported."""
    if not IS_WINDOWS:
        return False
    from ctypes import wintypes
    k = _k32()
    file_write_attributes, open_existing, backup_semantics = 0x100, 3, 0x02000000
    handle = k.CreateFileW(long_path(path), file_write_attributes, 0x7, None,
                           open_existing, backup_semantics, None)
    if handle in (None, wintypes.HANDLE(-1).value):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        ticks = int(round(timestamp * 10_000_000)) + 116_444_736_000_000_000
        ft = wintypes.FILETIME(ticks & 0xFFFFFFFF, ticks >> 32)
        if not k.SetFileTime(handle, ctypes.byref(ft), None, None):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        k.CloseHandle(handle)
    return True
