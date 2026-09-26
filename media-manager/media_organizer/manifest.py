"""Manifest (CSV + JSON) and side-report writers, and the manifest loader.

manifest.json is authoritative: 'move' executes exactly what it contains.
manifest.csv holds the same rows for review in Excel (UTF-8 with BOM).
"""
from __future__ import annotations

import csv
import json
import os

from . import constants as C

CSV_COLUMNS = [
    "RecordId", "OriginalPath", "OriginalFilename", "Extension", "FileSize", "SHA256",
    "IntegrityStatus", "IntegrityNotes", "Container",
    "DuplicateStatus", "DuplicateGroup", "DuplicateCount", "DuplicatePrimary", "DuplicateOtherPaths",
    "FilesystemCreated", "FilesystemModified", "EmbeddedCreated", "EmbeddedCreatedField", "EmbeddedModified",
    "FilenameDate", "ResolvedDate", "ResolvedYear", "DateSource", "DateConfidence", "DateNotes", "DateConflict",
    "Width", "Height", "DisplayWidth", "DisplayHeight", "Rotation", "AspectRatio", "Duration", "FrameRate",
    "VariableFrameRate", "VideoCodec", "AudioCodec", "BitRate", "VideoBitRate", "Encoder", "HandlerNames",
    "Make", "Model", "Software", "GPS", "MetadataComment", "MetadataTitle", "OtherSignatureTags",
    "Classification", "ClassificationConfidence", "ClassificationScore", "ClassificationRunnerUp",
    "ClassificationEvidence", "ClassificationConflicts",
    "ProposedDestination", "DestinationFilename", "NameChanged", "NameChangeReason",
    "Approved", "OperationStatus", "Error", "MetadataSources",
    "ReviewerClassification", "ReviewerYear", "ReviewerNotes",
]


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".")
    if isinstance(v, (list, tuple)):
        return " | ".join(str(x) for x in v)
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False)
    return v


def write_csv(path: str, rows: list, columns: list) -> None:
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({c: _cell(r.get(c)) for c in columns})


def write_json(path: str, obj) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, default=str)
    os.replace(tmp, path)


def write_run_outputs(run_dir: str, manifest: dict) -> dict:
    """Write all scan outputs; return {name: path}."""
    records = manifest["records"]
    paths = {k: os.path.join(run_dir, f) for k, f in (
        ("manifest_json", "manifest.json"), ("manifest_csv", "manifest.csv"), ("duplicates", "duplicates.csv"),
        ("invalid", "invalid_files.csv"), ("skipped", "skipped.csv"), ("conflicts", "date_conflicts.csv"),
        ("review", "needs_review.csv"))}
    write_json(paths["manifest_json"], manifest)
    write_csv(paths["manifest_csv"], records, CSV_COLUMNS)

    dup_rows = []
    for g in manifest.get("duplicate_groups", []):
        for p in g["Paths"]:
            dup_rows.append({"DuplicateGroup": g["DuplicateGroup"], "SHA256": g["SHA256"], "Count": g["Count"],
                             "FileSize": g["FileSize"], "Path": p, "Primary": "yes" if p == g["Primary"] else "no"})
    write_csv(paths["duplicates"], dup_rows, ["DuplicateGroup", "SHA256", "Count", "FileSize", "Primary", "Path"])

    invalid = [r for r in records if r.get("IntegrityStatus") not in C.MOVABLE_STATUSES]
    write_csv(paths["invalid"], invalid, ["RecordId", "OriginalPath", "FileSize", "SHA256", "IntegrityStatus",
                                          "IntegrityNotes", "Error", "ProposedDestination"])

    skipped = list(manifest.get("skipped", []))
    skipped += [{"Path": p, "Kind": "name contains '.mp4'",
                 "Reason": "'.mp4' appears in the name but is not the extension - not processed"}
                for p in manifest.get("name_contains_mp4", [])]
    write_csv(paths["skipped"], skipped, ["Kind", "Path", "Reason"])

    conflicts = [r for r in records if r.get("DateConflict")]
    write_csv(paths["conflicts"], conflicts, ["RecordId", "OriginalPath", "ResolvedDate", "ResolvedYear",
                                              "DateSource", "DateConfidence", "DateConflict", "FilenameDate",
                                              "EmbeddedCreated", "FilesystemModified"])

    review = [r for r in records
              if r.get("IntegrityStatus") in C.MOVABLE_STATUSES
              and (r.get("ClassificationConfidence") in (C.LOW, C.UNKNOWN_CONF)
                   or r.get("DateConfidence") in (C.LOW, C.UNKNOWN_CONF) or r.get("DateConflict")
                   or r.get("ClassificationConflicts"))]
    write_csv(paths["review"], review, ["RecordId", "OriginalPath", "ResolvedYear", "DateConfidence",
                                        "Classification", "ClassificationConfidence", "ClassificationConflicts",
                                        "DateConflict", "ProposedDestination", "ReviewerClassification",
                                        "ReviewerYear", "ReviewerNotes"])
    return paths


def resolve_manifest_path(target: str) -> str:
    """Accept a run folder or a manifest.json path."""
    if os.path.isdir(target):
        target = os.path.join(target, "manifest.json")
    if not os.path.isfile(target):
        raise FileNotFoundError(f"manifest not found: {target}")
    return target


def load_manifest(target: str) -> dict:
    path = resolve_manifest_path(target)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if data.get("format") != C.MANIFEST_FORMAT:
        raise ValueError(f"{path} is not a media-organizer manifest")
    if data.get("format_version") != C.MANIFEST_VERSION:
        raise ValueError(f"unsupported manifest version {data.get('format_version')} (expected {C.MANIFEST_VERSION})")
    data["_path"] = path
    return data


def load_approvals(csv_path: str) -> dict:
    """{RecordId: (approved bool, SHA256)} from an edited copy of manifest.csv."""
    out = {}
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            rid = (row.get("RecordId") or "").strip()
            if rid:
                val = (row.get("Approved") or "").strip().lower()
                out[rid] = (val in ("yes", "y", "true", "1", "x"), (row.get("SHA256") or "").strip().upper())
    return out
