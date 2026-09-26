"""Duplicate grouping and destination planning.

* Files with the same SHA-256 are byte-for-byte duplicates.  Nothing is ever
  deleted; each group gets a 'primary' copy (the best-evidenced one) and all
  copies share the primary's date and classification, because identical bytes
  cannot be two different videos.
* Destination = <dest>\\<year or 'Unknown Year'>\\<category folder>\\<original name>.
* Name collisions (inside the plan or with files already in the destination)
  never overwrite anything: the new name gets '__<first 8 hex of SHA-256>'.
"""
from __future__ import annotations

import os
from collections import defaultdict

from . import constants as C
from . import winfs

DUPLICATE_POLICIES = ("all", "separate", "leave")
MAX_NAME = 250


def _rank(level: str) -> int:
    return C.CONFIDENCE_RANK.get(level or C.UNKNOWN_CONF, 0)


def _primary_key(r: dict):
    return (r.get("IntegrityStatus") not in C.MOVABLE_STATUSES,
            -_rank(r.get("ClassificationConfidence")),
            -int(r.get("ClassificationScore") or 0),
            -_rank(r.get("DateConfidence")),
            len(r["OriginalPath"]), r["OriginalPath"].lower())


INHERITED = ("Classification", "ClassificationConfidence", "ClassificationScore", "ClassificationRunnerUp",
             "ResolvedDate", "ResolvedYear", "DateSource", "DateConfidence")


def assign_duplicates(records: list) -> list:
    by_hash = defaultdict(list)
    for r in records:
        if r.get("SHA256"):
            by_hash[r["SHA256"]].append(r)
        else:
            r.update(DuplicateStatus="Not checked (no hash)", DuplicateGroup="", DuplicateCount="",
                     DuplicatePrimary="", DuplicateOtherPaths="")
    groups = []
    ordered = sorted(by_hash.items(), key=lambda kv: min(m["OriginalPath"].lower() for m in kv[1]))
    for sha, members in ordered:
        if len(members) == 1:
            members[0].update(DuplicateStatus="Unique", DuplicateGroup="", DuplicateCount=1,
                              DuplicatePrimary="", DuplicateOtherPaths="")
            continue
        gid = f"DUP{len(groups) + 1:05d}"
        primary = min(members, key=_primary_key)
        for m in members:
            m.update(DuplicateStatus="Duplicate", DuplicateGroup=gid, DuplicateCount=len(members),
                     DuplicatePrimary="yes" if m is primary else "no",
                     DuplicateOtherPaths=" | ".join(o["OriginalPath"] for o in members if o is not m))
            if m is primary:
                continue
            own = {k: m.get(k) for k in INHERITED}
            m["OwnAnalysis"] = own
            changed = [k for k in INHERITED if own.get(k) != primary.get(k)]
            for k in INHERITED:
                m[k] = primary.get(k)
            if changed:
                note = (f"[duplicate] identical to {primary['OriginalPath']}; using that copy's result. This copy on "
                        f"its own: {own.get('Classification')} ({own.get('ClassificationConfidence')}), "
                        f"year {own.get('ResolvedYear')} ({own.get('DateConfidence')}).")
                m["ClassificationEvidence"] = note + " | " + (m.get("ClassificationEvidence") or "")
                m["DateNotes"] = note + " " + (m.get("DateNotes") or "")
        groups.append({"DuplicateGroup": gid, "SHA256": sha, "Count": len(members),
                       "FileSize": members[0].get("FileSize"), "Primary": primary["OriginalPath"],
                       "Paths": [m["OriginalPath"] for m in sorted(members, key=lambda x: x["OriginalPath"].lower())]})
    return groups


def _target(r: dict, dest_root: str, policy: str, min_conf: str):
    """(folder or None, approved, operation-status text)."""
    status = r.get("IntegrityStatus")
    if status in C.UNHASHABLE_STATUSES or not r.get("SHA256"):
        return None, "no", "DRY RUN: cannot be moved - the file could not be read/hashed"
    year = r.get("ResolvedYear") or "Unknown"
    year_folder = year if year.isdigit() else C.UNKNOWN_YEAR_FOLDER
    cls = r.get("Classification") or C.UNKNOWN
    if cls != C.UNKNOWN and _rank(r.get("ClassificationConfidence")) < _rank(min_conf):
        cls = C.UNKNOWN
        r["PlanNote"] = f"classification confidence below --min-class-confidence {min_conf}; filed under Unknown"
    class_folder = C.CATEGORY_FOLDERS.get(cls, C.CATEGORY_FOLDERS[C.UNKNOWN])
    if status not in C.MOVABLE_STATUSES:
        folder = os.path.join(dest_root, C.INVALID_FOLDER, C.STATUS_FOLDERS.get(status, status))
        return folder, "no", f"DRY RUN: not moved - {status}; moved only with 'move --include-invalid'"
    if r.get("DuplicatePrimary") == "no":
        if policy == "leave":
            return None, "no", "DRY RUN: duplicate copy - left in place (--duplicates leave)"
        if policy == "separate":
            return (os.path.join(dest_root, C.DUPLICATES_FOLDER, year_folder, class_folder), "yes",
                    "DRY RUN: would move (duplicate copy -> _Duplicates)")
    return os.path.join(dest_root, year_folder, class_folder), "yes", "DRY RUN: would move"


def _alt_names(name: str, sha: str):
    base, ext = os.path.splitext(name)
    tag = (sha or "")[:8].upper()
    yield f"{base}__{tag}{ext}"
    n = 2
    while True:
        yield f"{base}__{tag}__{n}{ext}"
        n += 1


def _fit(name: str) -> str:
    if len(name) <= MAX_NAME:
        return name
    base, ext = os.path.splitext(name)
    return base[:MAX_NAME - len(ext)] + ext


def plan_destinations(records: list, dest_root: str, policy: str = "all", min_conf: str = C.LOW) -> dict:
    taken: dict = {}
    owners: dict = {}
    stats = {"collisions": 0, "existing_conflicts": 0}

    def names_in(folder: str) -> set:
        key = folder.lower()
        if key not in taken:
            existing = set()
            try:
                with os.scandir(winfs.long_path(folder)) as it:
                    existing = {e.name.lower() for e in it}
            except OSError:
                pass
            taken[key] = existing
            for n in existing:
                owners[(key, n)] = "a file that already exists in the destination"
        return taken[key]

    ordered = sorted(records, key=lambda r: (r.get("DuplicatePrimary") == "no", r["OriginalPath"].lower()))
    for r in ordered:
        folder, approved, op = _target(r, dest_root, policy, min_conf)
        r["Approved"], r["OperationStatus"] = approved, op
        r["NameChanged"], r["NameChangeReason"] = "no", ""
        if folder is None:
            r["ProposedDestination"], r["DestinationFilename"] = "", ""
            continue
        name = _fit(r["OriginalFilename"])
        names = names_in(folder)
        key = folder.lower()
        final = name
        if final.lower() in names:
            clash_with = owners.get((key, final.lower()), "another file")
            for alt in _alt_names(name, r.get("SHA256")):
                alt = _fit(alt)
                if alt.lower() not in names:
                    final = alt
                    break
            stats["collisions"] += 1
            if clash_with.startswith("a file that already exists"):
                stats["existing_conflicts"] += 1
            r["NameChanged"] = "yes"
            r["NameChangeReason"] = f"'{name}' is already used in that folder by {clash_with}; renamed to avoid overwriting"
        names.add(final.lower())
        owners[(key, final.lower())] = r["OriginalPath"]
        r["ProposedDestination"] = os.path.join(folder, final)
        r["DestinationFilename"] = final
    return stats
