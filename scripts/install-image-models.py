"""Install reviewed image checkpoints locally; never download weights during setup.

Downloads are pinned, resumable and hash checked. A child process releases Hub
and SafeTensors file handles before the parent publishes a folder on Windows.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CATALOG = {
    "dreamshaper-xl-1-0": ("Lykon/dreamshaper-xl-1-0", "41e6644752a8c9aa63930e6043c4fd83c7708420"),
    "animagine-xl-4.0": ("cagliostrolab/animagine-xl-4.0", "2b7c1b397761bf5bd3cc42e5b39ec99314a75a96"),
    "illustrious-xl10-improved-uncensored-v30": (
        "John6666/illustrious-xl10-improved-uncensored-v30-sdxl",
        "b4bd48fd96fd843bfe2f27c1098a50dee0d7470b",
    ),
    "verboa-image-1.0-nf4": ("verboa/Verboa-Image-1.0-nf4", "62be2ada81a223c96fa32465620ba5d1dc248dd0"),
}
COMPONENTS = {"scheduler", "text_encoder", "text_encoder_2", "tokenizer", "tokenizer_2", "unet", "vae", "transformer"}
ROOT_FILES = {"model_index.json", "README.md", "LICENSE.md", "NOTICE.md", "SHA256SUMS"}
PIPELINES = {"StableDiffusionXLPipeline", "ErnieImagePipeline"}


class InstallerError(ValueError):
    """A local diagnostic safe to show without remote response data."""


def emit(**values):
    print(json.dumps(values), flush=True)


def select_files(siblings):
    """Prefer one FP16 SafeTensors copy; omit monolithic and alternate runtimes."""
    fp16 = {item.rfilename.replace(".fp16.safetensors", ".safetensors")
            for item in siblings if item.rfilename.endswith(".fp16.safetensors")}
    selected = []
    for item in siblings:
        path = PurePosixPath(item.rfilename)
        if path.is_absolute() or ".." in path.parts or "\\" in item.rfilename or ":" in item.rfilename:
            raise InstallerError("Unsafe remote filename")
        if len(path.parts) == 1:
            if path.name not in ROOT_FILES:
                continue
        elif path.parts[0] not in COMPONENTS or path.suffix not in {".json", ".txt", ".safetensors"}:
            continue
        if item.rfilename not in fp16:
            selected.append(item)
    if not any(item.rfilename == "model_index.json" for item in selected):
        raise InstallerError("Checkpoint is missing model_index.json")
    return sorted(selected, key=lambda item: (item.rfilename == "model_index.json", item.rfilename))


def verify_file(path, size, expected_sha256=None):
    if path.stat().st_size != size:
        raise InstallerError(f"Size mismatch: {path.name}")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if expected_sha256 and digest != expected_sha256:
        raise InstallerError(f"SHA-256 mismatch: {path.name}")
    return digest


def paths(models_root, name):
    root = models_root.resolve()
    staging, target = root / ".installing" / name, root / "diffusers" / name
    for path in (staging, target):
        if path.is_symlink() or path.resolve() != path:
            raise InstallerError("Model folders must not traverse links or junctions")
        if not path.resolve().is_relative_to(root):
            raise InstallerError("Model folder escapes the selected root")
    return staging, target


def check_existing(target, name):
    """Never replace an existing folder, even if it is incomplete or unrecognized."""
    if not target.exists():
        return False
    manifest = json.loads((target / "installation-manifest.json").read_text(encoding="utf-8"))
    repo, revision = CATALOG[name]
    if manifest.get("repo") != repo or manifest.get("revision") != revision:
        raise InstallerError(f"Preserving existing model with different provenance: {target}")
    if not manifest.get("verified_files"):
        raise InstallerError("Existing model has no verified file inventory")
    for item in manifest["verified_files"]:
        relative = PurePosixPath(item["file"])
        if relative.is_absolute() or ".." in relative.parts or "\\" in item["file"] or ":" in item["file"]:
            raise InstallerError("Unsafe filename in local manifest")
        file = target.joinpath(*relative.parts)
        if file.resolve() != file or file.stat().st_size != item["size"]:
            raise InstallerError(f"Existing model is incomplete or linked: {target}")
        verify_file(file, item["size"], item["sha256"])
        if ".fp16.safetensors" in file.name:
            canonical = file.with_name(file.name.replace(".fp16.safetensors", ".safetensors"))
            verify_file(canonical, item["size"], item["sha256"])
    if not (target / "model_index.json").is_file():
        raise InstallerError(f"Existing model is incomplete: {target}")
    return True


def download(name, models_root):
    from huggingface_hub import HfApi, get_token, hf_hub_download
    from safetensors import safe_open

    staging, target = paths(models_root, name)
    if check_existing(target, name):
        emit(model=name, status="already_present")
        return
    repo, revision = CATALOG[name]
    info = HfApi().model_info(repo, revision=revision, files_metadata=True)
    if info.gated and not get_token():
        raise InstallerError(f"Accept access at https://huggingface.co/{repo}, then run venv\\Scripts\\hf.exe auth login locally")
    files = select_files(info.siblings)
    staging.mkdir(parents=True, exist_ok=True)
    remaining = sum(item.size for item in files if not (staging / item.rfilename).is_file())
    if shutil.disk_usage(staging).free < remaining + 1024 ** 3:
        raise InstallerError("Insufficient disk space for the selected model plus 1 GiB headroom")
    emit(model=name, status="downloading", repo=repo, revision=revision, bytes=sum(item.size for item in files))
    verified = []
    for item in files:
        emit(model=name, file=item.rfilename, status="fetching", bytes=item.size)
        path = Path(hf_hub_download(repo, item.rfilename, revision=revision, local_dir=staging))
        digest = verify_file(path, item.size, item.lfs.sha256 if item.lfs else None)
        if path.suffix == ".safetensors":
            with safe_open(path, framework="pt", device="cpu") as handle:
                if not handle.keys():
                    raise InstallerError(f"Empty SafeTensors file: {path.name}")
            del handle
        verified.append({"file": item.rfilename, "size": item.size, "sha256": digest})
        if ".fp16.safetensors" in path.name:
            # The application's local loader uses canonical names, not variant=fp16.
            canonical = path.with_name(path.name.replace(".fp16.safetensors", ".safetensors"))
            if canonical.exists():
                verify_file(canonical, item.size, digest)
            else:
                os.link(path, canonical)
        emit(model=name, file=item.rfilename, status="verified")
    index = json.loads((staging / "model_index.json").read_text(encoding="utf-8"))
    if index.get("_class_name") not in PIPELINES:
        raise InstallerError("Unsupported pipeline; leaving the download outside the model catalog")
    manifest = {"repo": repo, "revision": revision, "verified_files": verified,
                "fp16_default_names_are_hardlinks": True}
    (staging / "installation-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    emit(model=name, status="verified_staging")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("models", nargs="*", metavar="MODEL", help="Model IDs: " + ", ".join(CATALOG))
    parser.add_argument("--all", action="store_true", help="Install all four catalog entries; Verboa requires approved access")
    parser.add_argument("--models-dir", type=Path, default=Path(os.environ.get("LAW_MODELS_DIR") or ROOT / "models"))
    parser.add_argument("--download-only", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    names = list(CATALOG) if args.all else args.models
    if any(name not in CATALOG for name in names):
        parser.error("Unknown model ID; choose one of: " + ", ".join(CATALOG))
    if not names:
        parser.print_help()
        return 0
    failures = []
    for name in names:
        try:
            if args.download_only:
                download(name, args.models_dir)
                continue
            subprocess.run([sys.executable, "-u", str(Path(__file__).resolve()), name,
                            "--models-dir", str(args.models_dir.resolve()), "--download-only"], check=True)
            staging, target = paths(args.models_dir, name)
            if not target.exists():
                if not (staging / "installation-manifest.json").is_file():
                    raise InstallerError("Verified download manifest is missing")
                target.parent.mkdir(parents=True, exist_ok=True)
                staging.rename(target)
                emit(model=name, status="installed", path=str(target))
        except Exception as exc:
            failures.append(name)
            # Hub exceptions may contain signed URLs. Keep remote error text out of logs.
            message = str(exc) if isinstance(exc, InstallerError) else type(exc).__name__
            emit(model=name, status="failed", error=message)
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
