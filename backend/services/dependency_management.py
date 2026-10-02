"""Manifest/metadata compatibility and one-package offline maintenance.

Only recorded low-risk package targets are automated. No resolver-driven
transitive updates, source builds, AI/runtime upgrades or shell commands.
"""
from datetime import datetime, timezone
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import zipfile
from email.parser import BytesParser

from packaging.requirements import Requirement, InvalidRequirement
from packaging.version import Version
from packaging.utils import canonicalize_name
from config import PROJECT_ROOT
from services.software_specs import read_json

PROFILES = ("requirements.txt", "requirements-core.txt", "requirements-knowledge.txt",
            "requirements-faces.txt", "requirements-audio.txt", "requirements-sdxl-cuda.txt", "requirements-ernie.txt")
SAFE_PACKAGES = {"psutil", "python-docx", "pypdfium2", "sqlalchemy"}
HIGH_RISK = {"torch", "torchvision", "torchaudio", "diffusers", "transformers", "accelerate", "peft", "bitsandbytes", "onnxruntime", "ctranslate2"}
OBSERVED_PACKAGES = {"pillow": "image/video", "numpy": "AI/media", "av": "audio/video codecs",
                     "soundfile": "voice", "ctranslate2": "transcription", "sentencepiece": "model tokenizers",
                     "opencv-python": "image/video", "onnxruntime": "faces", "insightface": "faces"}


def installed_versions():
    return {canonicalize_name(item.metadata["Name"]): item.version for item in metadata.distributions() if item.metadata.get("Name")}


def declarations(root, filename, seen=None):
    seen = set() if seen is None else seen
    if filename in seen:
        return []
    seen.add(filename)
    path = root / filename
    if not path.is_file():
        return []
    result = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.partition(" #")[0].strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-r "):
            included = line[3:].strip()
            if included in PROFILES:
                result.extend(declarations(root, included, seen))
        elif not line.startswith("-"):
            try:
                result.append(Requirement(line))
            except InvalidRequirement:
                raise ValueError(f"Unsupported declaration in {filename}")
    return result


def locked_targets(root):
    targets = {}
    path = root / "requirements.lock.txt"
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                req = Requirement(line)
                pins = [part.version for part in req.specifier if part.operator == "==" and "*" not in part.version]
                if len(pins) == 1:
                    targets[canonicalize_name(req.name)] = pins[0]
            except InvalidRequirement:
                pass
    return targets


def compatible(req, version):
    if req.marker and not req.marker.evaluate():
        return "not_applicable"
    if not version:
        return "missing"
    try:
        return "compatible" if not req.specifier or req.specifier.contains(version, prereleases=True) else "conflict"
    except ValueError:
        return "unknown"


def run(args, timeout=120):
    completed = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if completed.returncode:
        raise RuntimeError("Package operation failed. Check connectivity, wheel availability, permissions and package compatibility.")
    return completed.stdout


def pip_args(*args):
    # Ignore user config/environment indexes and never execute source build hooks.
    return [sys.executable, "-m", "pip", "--isolated", "--disable-pip-version-check", *args]


def transitive_conflicts(versions=None):
    versions = installed_versions() if versions is None else versions
    conflicts = []
    for dist in metadata.distributions():
        for declaration in dist.requires or []:
            try:
                req = Requirement(declaration)
                if req.marker and not req.marker.evaluate({"extra": ""}):
                    continue
                state = compatible(req, versions.get(canonicalize_name(req.name)))
                if state in {"missing", "conflict"}:
                    conflicts.append(f"{dist.metadata.get('Name')} requires {req}; installed {versions.get(canonicalize_name(req.name)) or 'missing'}")
            except (InvalidRequirement, ValueError):
                conflicts.append(f"Unparsed metadata requirement for {dist.metadata.get('Name')}")
    return sorted(set(conflicts))


def check_compatibility(root=PROJECT_ROOT, versions=None, profile="requirements.txt"):
    if profile not in PROFILES:
        raise ValueError("Unknown dependency profile")
    versions = installed_versions() if versions is None else versions
    pins = locked_targets(root)
    rows = []
    for filename in PROFILES:
        for req in declarations(root, filename):
            name = canonicalize_name(req.name)
            version = versions.get(name)
            rows.append({"ecosystem": "python", "name": name, "profile": filename, "installed": version,
                         "declared": str(req), "status": compatible(req, version), "recorded_target": pins.get(name),
                         "recorded_version_matches": version == pins.get(name) if name in pins else None,
                         "upgrade_risk": "manual_review" if name in HIGH_RISK or name not in SAFE_PACKAGES else "scoped_recorded_target",
                         "updatable": name in SAFE_PACKAGES and name in pins and version != pins[name]})
    package = read_json(root / "package.json")
    node_lock = read_json(root / "package-lock.json").get("packages", {})
    active_names = {row["name"] for row in rows if row["profile"] == profile}
    for name, feature in OBSERVED_PACKAGES.items():
        if name not in active_names:
            rows.append({"ecosystem": "python", "name": name, "profile": profile,
                         "installed": versions.get(name), "declared": f"No direct declaration ({feature})",
                         "status": "installed_unconstrained" if name in versions else "optional_missing",
                         "recorded_target": pins.get(name), "upgrade_risk": "manual_review", "updatable": False})
    node_rows = []
    for group in ("dependencies", "devDependencies"):
        for name, declared in package.get(group, {}).items():
            manifest = read_json(root / "node_modules" / name / "package.json")
            installed = manifest.get("version")
            node_rows.append({"ecosystem": "javascript", "name": name, "installed": installed, "declared": declared,
                              "recorded_target": node_lock.get(f"node_modules/{name}", {}).get("version"),
                              "node_engine": manifest.get("engines", {}).get("node"), "node_engine_status": "unknown",
                              "status": "missing" if installed is None else "unknown", "upgrade_risk": "manual_review", "updatable": False})
    node_version = None
    try:
        node_version = run(["node", "--version"], 5).strip().lstrip("v")
    except (OSError, subprocess.SubprocessError, RuntimeError):
        pass
    if node_rows:
        try:
            # Use the installed npm semver implementation, not a Python approximation.
            script = "const s=require(process.argv[1]);const r=JSON.parse(process.argv[2]);const v=process.argv[3];const check=(v,r)=>s.valid(v)&&s.validRange(r)?(s.satisfies(v,r)?'compatible':'conflict'):'unknown';process.stdout.write(JSON.stringify(r.map(x=>({status:x.installed?check(x.installed,x.declared):'missing',node_engine_status:check(v,x.node_engine)}))));"
            states = json.loads(run(["node", "-e", script, str(root / "node_modules/semver"), json.dumps(node_rows), node_version or ""], 10))
            for row, status in zip(node_rows, states):
                row.update(status)
        except (OSError, subprocess.SubprocessError, RuntimeError, ValueError):
            pass
    return {"sampled_at": datetime.now(timezone.utc).isoformat(), "selected_profile": profile,
            "profiles": list(PROFILES), "python": {"installed": platform.python_version(), "declared": None, "recorded_baseline": "3.13", "status": "unknown"},
            "node": {"installed": node_version, "declared": package.get("engines", {}).get("node"), "recorded_baseline": "22", "status": "unknown"},
            "dependencies": rows + node_rows, "voice_runtimes": voice_runtimes(root), "installed_metadata_conflicts": transitive_conflicts(versions),
            "limitations": "Profiles are alternatives, not one combined environment. Unpinned declarations are not proof that future upgrades are safe. CUDA/PyTorch versions and availability are in Environment; binary ABI and GPU execution require runtime testing."}


def voice_runtimes(root=PROJECT_ROOT):
    """Inspect the separate voice interpreters using the existing install script's pins."""
    from config import settings
    script = root / "scripts/install-voice-models.ps1"
    if not script.is_file():
        return []
    rows = []
    for line in script.read_text(encoding="utf-8").splitlines():
        spec = re.search(r"Id='([^']+)'; Runtime='([^']+)'.*Torch='([^']+)'; Cuda='([^']+)'", line)
        if not spec:
            continue
        engine, runtime, torch, cuda = spec.groups()
        folder = settings.models_dir / "audio/voice-cloning/runtimes" / runtime
        interpreter = folder / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        row = {"engine": engine, "available": interpreter.is_file(), "installed": {},
               "declared_torch": torch, "declared_cuda_build": cuda,
               "source": "scripts/install-voice-models.ps1", "upgrade_risk": "manual_review", "status": "missing"}
        if row["available"]:
            code = "import importlib.metadata as m,json,platform; names=['torch','torchaudio','transformers','omnivoice','chatterbox-tts','qwen-tts']; d={};\nfor n in names:\n try: d[n]=m.version(n)\n except m.PackageNotFoundError: d[n]=None\nprint(json.dumps({'python':platform.python_version(),'packages':d}))"
            try:
                inventory = json.loads(run([str(interpreter), "-c", code], 5))
                row["python"] = inventory["python"]
                row["installed"] = inventory["packages"]
                expected = f"{torch}+{cuda}"
                row["status"] = "compatible" if row["installed"].get("torch") == expected and row["installed"].get("torchaudio") == expected else "conflict"
            except (OSError, subprocess.SubprocessError, RuntimeError, ValueError, KeyError):
                row["status"] = "unknown"
        rows.append(row)
    return rows


def fingerprint(root, versions):
    data = {name: (root / name).read_text(encoding="utf-8") for name in (*PROFILES, "requirements.lock.txt") if (root / name).is_file()}
    return hashlib.sha256(json.dumps([data, versions], sort_keys=True).encode()).hexdigest()


def validate_target(root, name, target, profile):
    if name not in SAFE_PACKAGES or locked_targets(root).get(name) != target or profile not in PROFILES:
        raise ValueError("Only allowlisted packages at recorded compatible targets can be installed automatically.")
    requirements = [req for req in declarations(root, profile) if canonicalize_name(req.name) == name]
    if not requirements or any(compatible(req, target) not in {"compatible", "not_applicable"} for req in requirements):
        raise ValueError("Recorded target conflicts with the selected profile.")


def wheel_record(folder, name, version):
    wheels = list(folder.glob("*.whl"))
    if len(wheels) != 1:
        raise ValueError("Expected exactly one binary wheel.")
    path = wheels[0]
    with zipfile.ZipFile(path) as archive:
        records = [member for member in archive.namelist() if member.endswith(".dist-info/METADATA")]
        if len(records) != 1:
            raise ValueError("Wheel metadata unavailable")
        info = BytesParser().parsebytes(archive.read(records[0]))
    if canonicalize_name(info["Name"]) != name or Version(info["Version"]) != Version(version):
        raise ValueError("Downloaded package does not match the proposal.")
    return {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "requires": info.get_all("Requires-Dist", []), "requires_python": info.get("Requires-Python")}


def prepare_update(name, profile="requirements.txt", root=PROJECT_ROOT):
    name = canonicalize_name(name)
    versions = installed_versions()
    target = locked_targets(root).get(name)
    validate_target(root, name, target, profile)
    current = versions.get(name)
    if current == target:
        return {"status": "up_to_date", "name": name, "current": current, "target": target}
    folder = Path(tempfile.mkdtemp(prefix="law-dependency-"))
    try:
        proposed = folder / "proposed"
        proposed.mkdir()
        run(pip_args("download", "--index-url", "https://pypi.org/simple", "--only-binary=:all:", "--no-deps", "--dest", str(proposed), f"{name}=={target}"))
        wheel = wheel_record(proposed, name, target)
        from packaging.specifiers import SpecifierSet
        if wheel["requires_python"] and not SpecifierSet(wheel["requires_python"]).contains(platform.python_version()):
            raise ValueError("Target does not support this Python interpreter.")
        next_versions = {**versions, name: target}
        if transitive_conflicts(next_versions):
            raise ValueError("Target conflicts with installed dependents.")
        for declaration in wheel["requires"]:
            req = Requirement(declaration)
            if req.marker and not req.marker.evaluate({"extra": ""}):
                continue
            if compatible(req, next_versions.get(canonicalize_name(req.name))) != "compatible":
                raise ValueError("Target needs other package changes. Review manually.")
        rollback = None
        if current:
            previous = folder / "previous"
            previous.mkdir()
            run(pip_args("download", "--index-url", "https://pypi.org/simple", "--only-binary=:all:", "--no-deps", "--dest", str(previous), f"{name}=={current}"))
            rollback = wheel_record(previous, name, current)
        return {"status": "approval_required", "name": name, "current": current, "target": target,
                "profile": profile, "expires_at": __import__('time').time() + 600,
                "fingerprint": fingerprint(root, versions), "wheel": wheel, "rollback": rollback, "folder": str(folder),
                "scope": "One recorded package; no transitive installs. Backend pauses during installation.",
                "risk": "Version declarations and metadata checked. Feature behavior still needs a manual smoke test."}
    except BaseException:
        import shutil
        shutil.rmtree(folder)
        raise


def apply_update(plan, approved=False, root=PROJECT_ROOT):
    if approved is not True:
        raise ValueError("Explicit approval required.")
    import time
    name, target, profile = plan["name"], plan["target"], plan["profile"]
    validate_target(root, name, target, profile)
    if time.time() > plan["expires_at"] or fingerprint(root, installed_versions()) != plan["fingerprint"]:
        raise ValueError("Proposal expired or environment changed. Inspect again.")
    for record in (plan["wheel"], plan.get("rollback")):
        if record and hashlib.sha256(Path(record["path"]).read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError("Staged wheel changed; update refused.")
    attempted = False
    try:
        attempted = True
        run(pip_args("install", "--no-index", "--no-deps", "--only-binary=:all:", plan["wheel"]["path"]))
        if installed_versions().get(name) != target or transitive_conflicts():
            raise RuntimeError("Installed version or dependency verification failed.")
        return {"status": "success", "name": name, "previous": plan["current"], "installed": target, "detail": "Installed version and package metadata verified. Test the affected feature."}
    except (OSError, subprocess.SubprocessError, RuntimeError) as error:
        recovered = False
        try:
            if attempted and plan.get("rollback"):
                run(pip_args("install", "--no-index", "--no-deps", "--force-reinstall", plan["rollback"]["path"]))
                recovered = installed_versions().get(name) == plan["current"] and not transitive_conflicts()
            elif attempted:
                run(pip_args("uninstall", "--yes", name))
                recovered = name not in installed_versions()
        except (OSError, subprocess.SubprocessError, RuntimeError):
            pass
        return {"status": "failed", "name": name, "detail": str(error), "rollback_verified": recovered,
                "recovery": "Previous version restored." if recovered else "Rollback could not be verified. Inspect the environment manually before using affected features."}


def discard(plan):
    import shutil
    folder = Path(plan.get("folder", "")).resolve()
    if folder.parent == Path(tempfile.gettempdir()).resolve() and folder.name.startswith("law-dependency-"):
        shutil.rmtree(folder, ignore_errors=True)


if __name__ == "__main__":
    # Input comes only from Electron main, never a renderer-supplied command/path.
    try:
        request = json.load(sys.stdin)
        if request["action"] == "prepare":
            result = prepare_update(request["name"], request.get("profile", "requirements.txt"))
        elif request["action"] == "apply":
            result = apply_update(request["plan"], request.get("approved") is True)
        elif request["action"] == "discard":
            discard(request["plan"])
            result = {"status": "discarded"}
        else:
            raise ValueError("Unknown dependency action")
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
