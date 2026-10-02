"""Static inventory cached on demand; live services are queried separately."""
import importlib.metadata as metadata
import platform
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

import httpx
import psutil
from config import settings, PROJECT_ROOT
from services import system_stats
from services.software_specs import read_json

_lock = threading.Lock()
_static = None
_sampled = 0


def package_version(name):
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def static_snapshot(refresh=False):
    global _static, _sampled
    with _lock:
        if _static is not None and not refresh and time.monotonic() - _sampled < 3600:
            return _static
        warnings = []
        hardware = system_stats.read_hardware()
        gpus, error = system_stats.read_gpus()
        if error:
            warnings.append(error)
        try:
            ram = psutil.virtual_memory().total
        except (OSError, psutil.Error):
            ram = None
            warnings.append("Installed RAM unavailable.")
        torch = {"version": package_version("torch"), "cuda_build": None, "cuda_available": None}
        if torch["version"]:
            # Isolate native imports: no model allocation and bounded runtime.
            try:
                import json
                raw = system_stats.run_command([sys.executable, "-c", "import torch,json; print(json.dumps({'cuda_build':torch.version.cuda,'cuda_available':torch.cuda.is_available()}))"])
                torch.update(json.loads(raw))
            except (OSError, subprocess.SubprocessError, ValueError):
                warnings.append("PyTorch CUDA probe unavailable; installed metadata retained.")
        desktop = {"node": None, "electron": None}
        try:
            desktop["node"] = system_stats.run_command(["node", "--version"]).strip().lstrip("v")
        except (OSError, subprocess.SubprocessError):
            warnings.append("Standalone Node unavailable. Electron's embedded Node is a separate runtime.")
        desktop["electron"] = read_json(PROJECT_ROOT / "node_modules/electron/package.json").get("version")
        from services.dependency_management import voice_runtimes
        _static = {"sampled_at": datetime.now(timezone.utc).isoformat(), "cache_seconds": 3600,
                   "os": hardware.get("system", {}),
                   "cpu": {"name": system_stats.cpu_name(), "logical_cores": psutil.cpu_count(), "physical_cores": psutil.cpu_count(logical=False)},
                   "installed_ram_bytes": ram,
                   "gpus": [{key: gpu.get(key) for key in ("id", "name", "vram_total_bytes", "driver_version")} for gpu in gpus],
                   "python": {"version": platform.python_version(), "implementation": platform.python_implementation()},
                   "desktop_installed": desktop, "pytorch": torch,
                   "desktop_running": {"node": os.environ.get("LAW_DESKTOP_NODE_VERSION"), "electron": os.environ.get("LAW_DESKTOP_ELECTRON_VERSION")},
                   "app_version": read_json(PROJECT_ROOT / "package.json").get("version"),
                   "voice_runtimes": voice_runtimes(),
                   "warnings": warnings + hardware.get("warnings", [])}
        _sampled = time.monotonic()
        return _static


async def live_services():
    result = {"sampled_at": datetime.now(timezone.utc).isoformat(), "backend": {"available": True},
              "ollama": {"available": False, "models": []}}
    try:
        async with httpx.AsyncClient(timeout=3, trust_env=False) as client:
            response = await client.get(f"{settings.ollama_base_url}/api/tags")
            response.raise_for_status()
            result["ollama"] = {"available": True, "models": [item.get("name") for item in response.json().get("models", [])]}
    except (httpx.HTTPError, ValueError, AttributeError):
        result["ollama"]["detail"] = "Local Ollama service unavailable."
    result["capabilities"] = {"chat_backend": result["ollama"]["available"],
                              "diffusers_installed": package_version("diffusers") is not None,
                              "transcription_installed": package_version("faster-whisper") is not None,
                              "knowledge_index_installed": package_version("chromadb") is not None,
                              "note": "Installed runtimes do not certify model presence or successful inference."}
    return result
