"""Read-only software inventory and bounded diagnostic log exports."""
from datetime import datetime, timezone
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import tempfile
import zipfile

from config import PROJECT_ROOT
from services.app_logging import resolve_log_dir


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def folder_inventory(root, suffixes):
    return [{"folder": str(folder.relative_to(root)).replace("\\", "/"), "files": sorted(file.name for file in folder.iterdir() if file.is_file() and file.suffix in suffixes)}
            for folder in sorted([root, *[item for item in root.rglob("*") if item.is_dir() and "__pycache__" not in item.parts]])
            if folder.is_dir() and any(file.is_file() and file.suffix in suffixes for file in folder.iterdir())]


def snapshot(routes, root=PROJECT_ROOT):
    package = read_json(root / "package.json")
    dependencies = []
    for group in ("dependencies", "devDependencies"):
        for name, declared in sorted(package.get(group, {}).items()):
            installed = read_json(root / "node_modules" / name / "package.json").get("version")
            dependencies.append({"name": name, "declared": declared, "installed": installed or "unavailable", "group": group})
    python_packages = sorted([{"name": item.metadata.get("Name", "unknown"), "version": item.version} for item in importlib.metadata.distributions()], key=lambda item: item["name"].casefold())
    tools = sorted([{"module": route.endpoint.__module__, "path": route.path, "methods": sorted(route.methods), "name": route.name}
                    for route in routes if getattr(route, "methods", None) and hasattr(route, "endpoint") and not route.path.startswith(("/docs", "/redoc", "/openapi"))], key=lambda item: (item["module"], item["path"]))
    requirements = root / "requirements.txt"
    return {"sampled_at": datetime.now(timezone.utc).isoformat(),
        "frontend": {"app": package.get("name"), "version": package.get("version"), "folders": folder_inventory(root / "src", {".js", ".jsx", ".css", ".html"}),
                     "desktop_folders": folder_inventory(root / "electron", {".js"}), "production_build_present": (root / "dist" / "index.html").is_file()},
        "backend": {"python": platform.python_version(), "implementation": platform.python_implementation(), "platform": platform.system(), "folders": folder_inventory(root / "backend", {".py"})},
        "dependencies": {"javascript": dependencies, "python_installed": python_packages, "python_declared": requirements.read_text(encoding="utf-8").splitlines() if requirements.is_file() else []},
        "tool_calls": {"kind": "Registered application API calls; not model-granted tools", "operations": tools}}


def redact_logs(text):
    for name in ("LAW_SESSION_TOKEN", "LAW_DESKTOP_MAINTENANCE_TOKEN"):
        value = os.environ.get(name)
        if value:
            text = text.replace(value, "REDACTED")
    text = re.sub(r'(?i)((?:law_token|apiToken|X-LAW-Session|session_token|sessionToken|LAW_DESKTOP_MAINTENANCE_TOKEN|X-Desktop-Maintenance|api_key|password|access_token)[\"\x27]?\s*[:=]\s*[\"\x27]?)[^\s&\"\x27,}]+', r'\1REDACTED', text)
    return re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._~+/=-]+', r'\1REDACTED', text)


def log_archive(log_dir=None):
    root = Path(log_dir or resolve_log_dir()).resolve()
    archive = tempfile.TemporaryFile()
    records = []
    try:
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            # Exact app log names only: never recurse into media or data folders.
            for base, count in (("backend.log", 5), ("electron.log", 3)):
                for name in [base, *[f"{base}.{i}" for i in range(1, count + 1)]]:
                    path = root / name
                    if not path.is_file() or path.is_symlink() or path.resolve().parent != root:
                        continue
                    try:
                        with path.open("rb") as file:
                            size = os.fstat(file.fileno()).st_size
                            offset = max(0, size - 2_000_000)
                            file.seek(offset)
                            raw = file.read(2_000_000)
                        if offset:
                            raw = raw.partition(b"\n")[2]
                        output.writestr(name, redact_logs(raw.decode("utf-8", errors="replace")))
                        records.append({"file": name, "source_bytes": size, "tail_only": bool(offset)})
                    except OSError:
                        records.append({"file": name, "error": "Unavailable during export"})
            output.writestr("manifest.json", json.dumps({"exported_at": datetime.now(timezone.utc).isoformat(), "files": records, "note": "App logs only, up to 2 MB per file. Session credentials redacted. Local paths and logged error/context text may remain."}, indent=2))
        archive.seek(0)
        return archive
    except BaseException:
        archive.close()
        raise
