"""Verify local LoRA child identity before restart recovery touches ownership."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psutil

from services import lora_store


def worker_identity(command: list[str]) -> tuple[str, str] | None:
    # Match the actual module invocation and project path, not a substring in
    # an unrelated process (or a worker belonging to another data directory).
    if len(command) != 7 or command[1:3] != ["-m", "services.lora_worker"]:
        return None
    if command[3] != "--project" or command[5] != "--run-id":
        return None
    path = Path(command[4])
    if not path.is_absolute() or not command[6]:
        return None
    try:
        project_id = path.parent.name
        if path.resolve() != lora_store._project_path(project_id).resolve():
            return None
    except (ValueError, OSError):
        return None
    return project_id, command[6]


def find_workers() -> tuple[list[tuple[psutil.Process, str, str]], bool]:
    """Return verified workers and whether recorded ownership is unreadable.

    Creation time prevents a reused PID from being mistaken for the old child.
    Command discovery covers legacy locks and a crash between spawn and the
    PID write. No arbitrary process is terminated from the lock's PID alone.
    """
    lock = {}
    try:
        lock = json.loads(lora_store.TRAINING_LOCK_PATH.read_text(encoding="utf-8"))
        if not isinstance(lock, dict):
            lock = {}
    except FileNotFoundError:
        pass
    except ValueError:
        # A damaged legacy record can still be reconciled by complete command
        # discovery. No PID from malformed content is ever trusted.
        lock = {}
    except OSError:
        # An unreadable file cannot establish that its worker is dead.
        return [], True
    workers = {}
    blocked = False
    recorded_pid = lock.get("worker_pid")
    if isinstance(recorded_pid, int) and recorded_pid > 0:
        try:
            process = psutil.Process(recorded_pid)
            if process.create_time() == lock.get("worker_created_at"):
                identity = worker_identity(process.cmdline())
                if identity == (lock.get("project_id"), lock.get("run_id")):
                    workers[process.pid] = (process, *identity)
        except psutil.NoSuchProcess:
            pass
        except (psutil.AccessDenied, OSError):
            blocked = True
    try:
        for process in psutil.process_iter():
            if process.pid == os.getpid():
                continue
            try:
                identity = worker_identity(process.cmdline())
                if identity:
                    workers[process.pid] = (process, *identity)
            except psutil.NoSuchProcess:
                continue
            except psutil.AccessDenied:
                # Old locks have no PID. An inaccessible Python command line
                # could belong to that worker, so retain ownership. Protected
                # system processes with other names are not worker candidates.
                if lora_store.TRAINING_LOCK_PATH.exists():
                    try:
                        if process.name().lower() in {Path(sys.executable).name.lower(), "python.exe", "pythonw.exe"}:
                            blocked = True
                    except (psutil.AccessDenied, OSError):
                        blocked = True
                    except psutil.NoSuchProcess:
                        pass
    except (psutil.Error, OSError):
        blocked = True
    return list(workers.values()), blocked


def stop_worker(process: psutil.Process, project_id: str, run_id: str) -> None:
    """Recheck identity on the same Process object immediately before stopping."""
    try:
        if not process.is_running():
            return
        if worker_identity(process.cmdline()) != (project_id, run_id):
            raise ValueError("The previous worker identity changed; recovery was not performed")
        process.terminate()
        try:
            process.wait(timeout=5)
        except psutil.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    except psutil.NoSuchProcess:
        return
    except (psutil.Error, OSError) as exc:
        raise ValueError("The previous LoRA worker could not be stopped; GPU ownership is retained") from exc
