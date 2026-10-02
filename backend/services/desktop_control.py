"""Private parent pipe and Windows process containment for desktop launches.

No HTTP shutdown endpoint: only the Electron process that owns stdin can issue
the command. Terminal launches retain Uvicorn's normal Ctrl+C handling.
"""
from __future__ import annotations

import json
import os
import sys
import threading


def contain_desktop_processes():
    """Keep a private job handle open until process exit to reap child workers."""
    if os.environ.get("LAW_DESKTOP_CONTROL") != "1" or sys.platform != "win32":
        return None
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                    ("SchedulingClass", wintypes.DWORD)]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("ReadOperationCount", "WriteOperationCount",
                    "OtherOperationCount", "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BasicLimits), ("IoInfo", IoCounters),
                    ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                    ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.SetInformationJobObject.restype = wintypes.BOOL
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    limits = ExtendedLimits()
    limits.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    try:
        if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
            raise ctypes.WinError(ctypes.get_last_error())
    except BaseException:
        kernel.CloseHandle(job)
        raise
    # Never close explicitly: the backend itself belongs to this job. Windows
    # closes the non-inheritable handle on exit, terminating leftover descendants.
    return job


def watch_parent(server, stream=None):
    """Use the same graceful Uvicorn exit flag as its first interrupt signal."""
    if os.environ.get("LAW_DESKTOP_CONTROL") != "1":
        return None
    stream = stream if stream is not None else sys.stdin

    def watch():
        try:
            while True:
                line = stream.readline()
                if not line:  # The owning desktop died or closed its pipe.
                    break
                try:
                    command = json.loads(line)
                except (ValueError, TypeError):
                    continue
                if isinstance(command, dict) and command.get("command") == "shutdown":
                    break
        except (OSError, ValueError):
            pass
        server.should_exit = True

    thread = threading.Thread(target=watch, name="desktop-parent-control", daemon=True)
    thread.start()
    return thread
