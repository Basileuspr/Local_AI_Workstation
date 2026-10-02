"""Portable captured build identity. No Git/runtime-data/network access."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_FIELDS = ("schema_version", "app_version", "build_id", "release_status", "source_commit",
                 "source_commit_author_at", "source_commit_at", "source_dirty", "source_change_count",
                 "worktree_entry_count",
                 "source_fingerprint", "source_snapshot_id", "captured_at", "captured_at_utc", "timezone",
                 "environment", "dependencies", "date_basis", "validation")


def read_build_info(root=ROOT, *, verify_sources=True):
    root = Path(root).resolve()
    try:
        version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
        if not isinstance(version, str) or not version:
            version = "unavailable"
    except (OSError, ValueError, KeyError, TypeError):
        version = "unavailable"
    fallback = {"app_version": version, "package_version": version, "build_id": None, "source_status": "unrecorded",
                "status_detail": "No valid build record. Run a production build to capture an identity."}
    try:
        record = json.loads((root / "build-info.json").read_text(encoding="utf-8"))
        if (record.get("schema_version") != 1 or not isinstance(record.get("build_id"), str)
                or not record["build_id"] or not isinstance(record.get("app_version"), str)
                or not re.fullmatch(r"[0-9a-f]{40}", record.get("source_commit", ""))
                or not re.fullmatch(r"[0-9a-f]{64}", record.get("source_fingerprint", ""))
                or not isinstance(record.get("source_dirty"), bool)
                or not isinstance(record.get("source_files"), dict) or not record["source_files"]
                or not record.get("captured_at_utc") or not record.get("source_snapshot_id")):
            return fallback
        result = {key: record[key] for key in PUBLIC_FIELDS if key in record}
        result["package_version"] = version
        result["source_status"] = "captured"
        if record["app_version"] != version:
            result.update(source_status="version_mismatch", status_detail="Package version differs from the captured build; rebuild before identifying this checkout as that build.")
        elif verify_sources:
            for name, digest in record["source_files"].items():
                try:
                    target = (root / name).resolve()
                    matches = (target.is_relative_to(root) and bool(re.fullmatch(r"[0-9a-f]{64}", digest))
                               and hashlib.sha256(target.read_bytes().replace(b"\r\n", b"\n")).hexdigest() == digest)
                except (OSError, TypeError):
                    matches = False
                if not matches:
                    result.update(source_status="changed_since_capture", status_detail="Recorded source files differ or are unavailable. The identifier describes the saved capture; rebuild to capture current source.")
                    break
            else:
                result["source_status"] = "recorded_files_match"
        return result
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return fallback
