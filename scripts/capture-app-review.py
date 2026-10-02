"""Capture source/dependency metadata and regenerate the local audit/history reader.

No app imports, user-data reads, model calls, Git mutations, or network requests.
Run with the repo venv to record its installed Python packages. Source snapshots
are observations, not claims about when an uncommitted feature was created.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "application-review"
EXTENSIONS = {".py", ".js", ".jsx", ".cjs", ".mjs", ".css", ".html", ".json", ".ps1", ".txt", ".md", ".ini", ".toml", ".svg"}
ROOT_FILES = {"package.json", "package-lock.json", "vite.config.mjs", "vitest.config.mjs", "pytest.ini", "README.md", "PROJECT_STATUS.md", "ARCHITECTURE.md", "docs/application-review/README.md", "docs/application-review/review.json", "docs/application-review/reader-template.html"}
ROOT_FILES.update({"docs/application-review/benchmarks/session-metadata.json",
                   "docs/application-review/changes/R02-session-metadata.md",
                   "docs/application-review/changes/R01-build-identity.md",
                   "docs/application-review/changes/R03-session-revisions.md", ".gitignore"})
PY_PACKAGES = ["fastapi", "uvicorn", "torch", "torchvision", "diffusers", "transformers", "accelerate", "compel", "onnxruntime", "onnxruntime-gpu", "chromadb", "faster-whisper", "ctranslate2", "sherpa-onnx", "numpy", "huggingface-hub", "peft", "pillow", "cryptography"]


def command(args, *, binary=False, input=None):
    text_options = {} if binary else {"encoding": "utf-8", "errors": "replace"}
    result = subprocess.run(args, cwd=ROOT, input=input, capture_output=True,
                            text=not binary, timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), **text_options)
    if result.returncode:
        raise RuntimeError(f"{args[0]} command failed with exit {result.returncode}")
    return result.stdout


def included(name):
    path = Path(name)
    if any(part in {"data", "models", "venv", ".venv", "node_modules", "dist", "__pycache__", ".pytest_cache", "captures", ".git"} for part in path.parts):
        return False
    if path.suffix.lower() not in EXTENSIONS and name not in ROOT_FILES:
        return False
    return (name in ROOT_FILES or (len(path.parts) == 1 and (name.startswith("requirements") or path.suffix == ".md"))
            or name.startswith(("src/", "backend/", "electron/", "tests/", "scripts/", "media-manager/frontend/", "media-manager/tests/", "media-manager/media_organizer/"))
            or name in {"media-manager/package.json", "media-manager/README.md"})


def metadata(raw):
    return {"sha256": hashlib.sha256(raw).hexdigest(),
            "comparison_sha256": hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest(),
            "bytes": len(raw), "lines": len(raw.splitlines())}


def node_dependencies(package_raw, lock_raw, installed):
    package = json.loads(package_raw)
    lock = json.loads(lock_raw)
    entries = []
    for name, declared in sorted({**package.get("dependencies", {}), **package.get("devDependencies", {})}.items()):
        value = {"name": name, "declared": declared, "locked": lock.get("packages", {}).get("node_modules/" + name, {}).get("version")}
        if installed:
            target = ROOT / "node_modules" / name / "package.json"
            current = json.loads(target.read_text(encoding="utf-8")) if target.is_file() else {}
            value.update(installed=current.get("version"), engines=current.get("engines", {}))
        entries.append(value)
    return package.get("version"), entries


def lock_versions(raw):
    return {name: value["version"] for name, value in json.loads(raw).get("packages", {}).items()
            if name and value.get("version")}


def git_baseline(head):
    objects = []
    for entry in command(["git", "ls-tree", "-r", "-z", head], binary=True).split(b"\0"):
        if not entry:
            continue
        header, name = entry.split(b"\t", 1)
        mode, kind, oid = header.split()
        name = name.decode("utf-8")
        if kind == b"blob" and included(name):
            objects.append((name, oid.decode("ascii")))
    output = command(["git", "cat-file", "--batch"], binary=True,
                     input="".join(oid + "\n" for _, oid in objects).encode("ascii"))
    offset, files, required = 0, {}, {}
    for name, oid in objects:
        end = output.index(b"\n", offset)
        header = output[offset:end].split()
        size = int(header[2])
        raw = output[end + 1:end + 1 + size]
        offset = end + size + 2
        files[name] = metadata(raw)
        if name in {"package.json", "package-lock.json"}:
            required[name] = raw
    version, deps = node_dependencies(required["package.json"], required["package-lock.json"], False)
    return {"id": "committed-" + head, "label": "Committed source at " + head[:7], "kind": "committed",
            "files": files, "app_version": version, "node_dependencies": deps,
            "git": {"head": head}, "python_packages": {}, "node_lock_versions": lock_versions(required["package-lock.json"])}


def capture(note):
    utc = datetime.now(timezone.utc)
    try:
        local = utc.astimezone(ZoneInfo("America/Denver"))
    except Exception:
        raise RuntimeError("America/Denver timezone data is unavailable; run with the repository Python environment")
    head = command(["git", "rev-parse", "HEAD"]).strip()
    names = command(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], binary=True)
    files, unstable = {}, []
    for name in sorted(set(item.decode("utf-8") for item in names.split(b"\0") if item)):
        path = ROOT / name
        if not included(name) or not path.is_file() or path.is_symlink():
            continue
        before = path.stat()
        raw = path.read_bytes()
        after = path.stat()
        if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
            unstable.append(name)
        files[name] = metadata(raw)
    if unstable:
        raise RuntimeError("Source changed during capture: " + ", ".join(unstable))
    status = command(["git", "status", "--porcelain=v1", "--untracked-files=all", "-z"], binary=True).split(b"\0")
    changes = []
    worktree_entry_count = 0
    index = 0
    while index < len(status):
        item = status[index]
        index += 1
        if not item:
            continue
        worktree_entry_count += 1
        code, name = item[:2].decode("ascii"), item[3:].decode("utf-8")
        source = None
        if "R" in code or "C" in code:
            source = status[index].decode("utf-8")
            index += 1
        if included(name):
            changes.append({"status": code, "path": name, **({"from": source} if source else {})})
    history = []
    for record in command(["git", "log", "--reverse", "--format=%H%x1f%aI%x1f%cI%x1f%s"]).splitlines():
        oid, author_at, committed_at, subject = record.split("\x1f", 3)
        paths = command(["git", "diff-tree", "--no-commit-id", "--root", "-r", "-m", "--name-only", "-z", oid], binary=True)
        history.append({"hash": oid, "author_at": author_at, "committed_at": committed_at,
                        "subject": subject, "paths": sorted({p.decode("utf-8") for p in paths.split(b"\0") if p and included(p.decode("utf-8"))})})
    version, deps = node_dependencies((ROOT / "package.json").read_bytes(), (ROOT / "package-lock.json").read_bytes(), True)
    packages = {}
    for name in PY_PACKAGES:
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    versions = {}
    for name in ("node", "npm"):
        try:
            # No shell expansion; npm.cmd is unnecessary for reading npm's version.
            args = [name, "--version"] if name == "node" else ["node", str(Path(command(["where.exe", "npm"]).splitlines()[0]).parent / "node_modules" / "npm" / "bin" / "npm-cli.js"), "--version"]
            versions[name] = command(args).strip()
        except (RuntimeError, OSError):
            versions[name] = "unavailable"
    baseline = git_baseline(head)
    if command(["git", "rev-parse", "HEAD"]).strip() != head:
        raise RuntimeError("Git HEAD changed during capture; run again after source changes finish")
    baseline["captured_at"] = local.isoformat()
    baseline["committed_at"] = history[-1]["committed_at"] if history else None
    ident = utc.strftime("%Y-%m-%dT%H%M%S") + f"-{utc.microsecond:06d}Z"
    return {"schema_version": 1, "id": ident, "label": note or "Source observation", "kind": "observed",
            "captured_at": local.isoformat(), "captured_at_utc": utc.isoformat(), "timezone": "America/Denver",
            "app_version": version, "git": {"head": head, "branch": command(["git", "branch", "--show-current"]).strip(),
            "worktree": changes, "dirty": bool(worktree_entry_count), "worktree_entry_count": worktree_entry_count}, "environment": {"python": platform.python_version(), "system": platform.system(),
            "release": platform.release(), **versions}, "node_dependencies": deps, "python_packages": packages,
            "files": files, "commits": history, "committed_baseline": baseline,
            "node_lock_versions": lock_versions((ROOT / "package-lock.json").read_bytes()),
            "limitations": ["File hashes record source, not behavior or test results.", "First observation does not establish original creation time.", "Python packages describe the interpreter running this command.", "Runtime data, models, logs, environment variables, credentials and Git remotes are excluded.", "Comparison hashes normalize CRLF to LF; raw SHA-256 is also retained.", "Capture is not a global lock on concurrent editors; run after edits finish."]}


def difference(old, new):
    a, b = old["files"], new["files"]
    return {"added": sorted(b.keys() - a.keys()), "removed": sorted(a.keys() - b.keys()),
            "changed": sorted(name for name in a.keys() & b.keys() if a[name]["comparison_sha256"] != b[name]["comparison_sha256"])}


def atomic_write(path, text):
    pending = path.with_suffix(path.suffix + ".pending")
    pending.write_text(text, encoding="utf-8")
    os.replace(pending, path)


def build_record(snapshot):
    """One portable identity shared by desktop, renderer and backend.

    Generated build-info.json and rendered reports are excluded from source
    hashes, avoiding recursive identities. No Git remote or private file bodies.
    """
    sources = {name: value["comparison_sha256"] for name, value in sorted(snapshot["files"].items())}
    fingerprint = hashlib.sha256(json.dumps(sorted(sources.items()), ensure_ascii=False,
                                           separators=(",", ":")).encode("utf-8")).hexdigest()
    dirty = snapshot["git"].get("dirty", bool(snapshot["git"]["worktree"]))
    stamp = datetime.fromisoformat(snapshot["captured_at_utc"]).strftime("%Y%m%dT%H%M%S")
    stamp += "-" + snapshot["id"].split("-")[-1]
    head = snapshot["git"]["head"]
    commit = next((item for item in snapshot["commits"] if item["hash"] == head), {})
    return {"schema_version": 1, "app_version": snapshot["app_version"],
            "build_id": f"{snapshot['app_version']}+{stamp}.{head[:8]}.{fingerprint[:12]}" + (".dirty" if dirty else ""),
            "release_status": "development" if "-" in snapshot["app_version"].split("+")[0] else "source-capture",
            "source_commit": head, "source_commit_author_at": commit.get("author_at"),
            "source_commit_at": commit.get("committed_at"), "source_dirty": dirty,
            "source_change_count": len(snapshot["git"]["worktree"]),
            "worktree_entry_count": snapshot["git"].get("worktree_entry_count", len(snapshot["git"]["worktree"])),
            "source_fingerprint": fingerprint,
            "source_snapshot_id": snapshot["id"], "captured_at": snapshot["captured_at"],
            "captured_at_utc": snapshot["captured_at_utc"], "timezone": snapshot["timezone"],
            "environment": snapshot["environment"],
            "dependencies": {"node": snapshot["node_dependencies"], "python": snapshot["python_packages"],
                             "node_lock": snapshot["node_lock_versions"]},
            "source_files": sources,
            "date_basis": "Commit dates are Git metadata. Capture time proves source observation, not feature creation or deployment. Reported and first-observed feature dates remain in the dated feature ledger.",
            "validation": "Source capture only; a build record does not certify tests, GPU execution, or a published release."}


def render(destination):
    review = json.loads((DOCS / "review.json").read_text(encoding="utf-8"))
    snapshots = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((destination / "snapshots").glob("*.json"))]
    if not snapshots:
        raise RuntimeError("No snapshots found; capture a baseline first")
    latest = snapshots[-1]
    first = snapshots[0]
    report = [f"# {review['title']}", "", f"Reviewed {review['reviewed_on']} ({review['timezone']}).", "", review["scope"], "", review["summary"], "", "[Open the local reader](index.html) · [Read history](HISTORY.md) · [Workflow](README.md)", "", "## Validation at this review", ""]
    for entry in review["validation"]:
        report.extend([f"- **{entry['check']}** — {entry['result']} ({entry['kind']}).", f"  Command: `{entry['command']}`"])
    report.extend(["", "These results belong to the dated audit, not to every later snapshot. Future captures do not rerun tests.", "", "## Validation limits", ""])
    report += ["- " + item for item in review["not_validated"]]
    report.extend(["", "## Findings and change status", "", "P1 = prioritize correctness, recovery or growing-library impact. P2 = measure or plan next. Findings remain proposed unless explicitly marked implemented with dated verification.", ""])
    for f in review["findings"]:
        report.extend([f"### {f['id']} · {f['priority']} · {f['title']}", "", f"**Evidence:** {f['evidence']}.", "", f["observation"], "", "**Proposed next step:** " + f["recommendation"], "", "**Acceptance check:** " + f["verify"], "", "**Preserve:** " + f["risk"], "", "Source: " + ", ".join(f"[{name}](../../{name})" for name in f["files"]) + ".", ""])
        if f.get("status"):
            report.extend([f"**Status:** {f['status']} · {f.get('implemented_at', 'Date not recorded')}", "", "**Completed change:** " + f.get("implementation", ""), "", "**Verification result:** " + f.get("verification_result", ""), ""])
        if f.get("result_document"):
            report.extend([f"[Before/after measurements and preservation checks]({f['result_document']})", ""])
        for url in f.get("sources", []):
            report.extend([f"Official guidance: [{url}]({url}).", ""])
    report.extend(["## Already implemented", ""])
    report += ["- " + item for item in review["already_present"]]
    report.extend(["", "## Suggested order", ""])
    report += [f"{i}. {item}" for i, item in enumerate(review["next_sequence"], 1)]
    report.extend(["", "## Metrics for before/after comparisons", ""])
    report += ["- " + item for item in review["benchmark_metrics"]]
    atomic_write(destination / "AUDIT.md", "\n".join(report) + "\n")
    history = ["# Application history", "", "[Open searchable reader and comparison](index.html#history)", "", "## How dates should be read", "", "Git author and commit dates are recorded metadata, not proof of deployment or original implementation time. A first-observed snapshot establishes that source was present by that timestamp. File modification times are not used as introduction dates. Commit subjects describe intent; changed paths provide supporting scope. No historical user data is copied into this record.", "", f"First source observation: **{first['captured_at']}** ({first['timezone']}).", f"Latest source observation: **{latest['captured_at']}**.", f"App version: **{latest['app_version']}**. Branch: `{latest['git']['branch']}`. HEAD: `{latest['git']['head']}`.", "", "## Uncommitted feature observations", ""]
    if latest.get("build_identity"):
        history.insert(history.index("## Uncommitted feature observations"),
                       f"Latest captured build: `{latest['build_identity']['build_id']}`. Dirty at capture: {latest['build_identity']['source_dirty']}.\n")
    for feature in review["feature_observations"]:
        history.extend([f"### {feature['feature']}", "", feature["date_basis"], "", f"First recorded observation: {feature.get('observed_at', 'Not recorded; do not infer from the first audit date')}.", "", "Source: " + ", ".join(f"[{p}](../../{p})" for p in feature["paths"]) + ".", ""])
    history.extend(["## Dated source observations", ""])
    for i, item in enumerate(snapshots):
        changes = difference(snapshots[i - 1] if i else item["committed_baseline"], item)
        basis = "previous observation" if i else "committed HEAD"
        history.extend([f"### {item['captured_at']} · {item['label']}", "", f"Source version {item['app_version']}; HEAD `{item['git']['head'][:7]}`. Compared with {basis}: {len(changes['added'])} added, {len(changes['changed'])} changed, {len(changes['removed'])} removed source/document files.", "", f"Snapshot: [metadata JSON](snapshots/{item['id']}.json). Hashes prove source differences, not feature correctness or measured speed improvements.", ""])
        if item.get("build_identity"):
            history.extend([f"Build identifier: `{item['build_identity']['build_id']}`. Dirty at capture: {item['build_identity']['source_dirty']}. Capture UTC: {item['build_identity']['captured_at_utc']}.", ""])
    history.extend(["## Committed local source history", ""])
    for entry in latest["commits"]:
        history.extend([f"### {entry['committed_at']} · {entry['hash'][:7]} · {entry['subject']}", "", f"Author date: {entry['author_at']}. Commit date: {entry['committed_at']}. {len(entry['paths'])} in-scope changed paths.", "", "<details><summary>Changed source/document paths</summary>", ""])
        history += [f"- `{p}`" for p in entry["paths"]]
        history.extend(["", "</details>", ""])
    atomic_write(destination / "HISTORY.md", "\n".join(history) + "\n")
    payload = json.dumps({"review": review, "snapshots": snapshots}, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    template = (DOCS / "reader-template.html").read_text(encoding="utf-8")
    atomic_write(destination / "index.html", template.replace("__REVIEW_DATA__", payload))
    return latest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--note", default="Source observation", help="Short description of this observation (not a feature introduction date)")
    parser.add_argument("--render-only", action="store_true", help="Refresh reader/docs from saved snapshots without making a new observation")
    parser.add_argument("--output-dir", type=Path, default=DOCS, help="Optional separate output folder for validation")
    parser.add_argument("--build", action="store_true", help="Also create the shared portable build-info.json identity")
    parser.add_argument("--build-info-output", type=Path, default=ROOT / "build-info.json", help="Alternate identity output for isolated validation")
    args = parser.parse_args()
    if args.build and args.render_only:
        parser.error("--build requires a fresh source capture; it cannot be used with --render-only")
    destination = args.output_dir.resolve()
    (destination / "snapshots").mkdir(parents=True, exist_ok=True)
    if not args.render_only:
        value = capture(args.note)
        if args.build:
            record = build_record(value)
            value["build_identity"] = {key: item for key, item in record.items()
                                       if key not in {"source_files", "dependencies", "environment"}}
        with (destination / "snapshots" / (value["id"] + ".json")).open("x", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        if args.build:
            args.build_info_output.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(args.build_info_output, json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    latest = render(destination)
    print(json.dumps({"snapshot": latest["id"], "source_files": len(latest["files"]),
                      "source_changes": len(latest["git"]["worktree"]), "reader": str(destination / "index.html")}, indent=2))


if __name__ == "__main__":
    main()
