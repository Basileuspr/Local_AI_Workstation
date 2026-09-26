"""Human-readable summary of a dry-run scan."""
from __future__ import annotations

from collections import Counter

from . import constants as C
from .progress import human_bytes, human_duration


def build_summary(records: list, walk, groups: list, plan_stats: dict, elapsed: float) -> dict:
    valid = [r for r in records if r.get("IntegrityStatus") in C.MOVABLE_STATUSES]
    years = Counter(r.get("ResolvedYear") or "Unknown" for r in valid)
    year_order = sorted((y for y in years if y.isdigit()), key=int) + [y for y in years if not y.isdigit()]
    classes = {}
    for cat in list(C.CATEGORIES) + [C.UNKNOWN]:
        rows = [r for r in valid if r.get("Classification") == cat]
        conf = Counter(r.get("ClassificationConfidence") for r in rows)
        classes[cat] = {"total": len(rows), C.HIGH: conf.get(C.HIGH, 0), C.MEDIUM: conf.get(C.MEDIUM, 0),
                        C.LOW: conf.get(C.LOW, 0)}
    dup_files = [r for r in records if r.get("DuplicateStatus") == "Duplicate"]
    redundant = [r for r in dup_files if r.get("DuplicatePrimary") == "no"]
    other_ext = Counter({k: v for k, v in walk.ext_counts.items() if k != ".mp4"})
    return {
        "directories_scanned": walk.dirs_scanned,
        "files_examined": walk.files_examined,
        "deepest_folder_level": walk.max_depth,
        "mp4_found": len(records),
        "mp4_bytes": sum(r.get("FileSize") or 0 for r in records),
        "valid_videos": len(valid),
        "invalid_or_unreadable": len(records) - len(valid),
        "invalid_by_status": dict(Counter(r.get("IntegrityStatus") for r in records
                                          if r.get("IntegrityStatus") not in C.MOVABLE_STATUSES)),
        "valid_with_warnings": sum(1 for r in valid if r.get("IntegrityStatus") == C.OK_WARNINGS),
        "years": {y: years[y] for y in year_order},
        "date_sources": dict(Counter(r.get("DateSource") for r in valid).most_common()),
        "date_confidence": dict(Counter(r.get("DateConfidence") for r in valid)),
        "classification": classes,
        "duplicates": {"groups": len(groups), "files_in_groups": len(dup_files),
                       "redundant_copies": len(redundant),
                       "redundant_bytes": sum(r.get("FileSize") or 0 for r in redundant)},
        "plan": {"would_move": sum(1 for r in records if r.get("Approved") == "yes"),
                 "excluded_invalid": sum(1 for r in records if r.get("IntegrityStatus") not in C.MOVABLE_STATUSES
                                         and r.get("ProposedDestination")),
                 "cannot_move": sum(1 for r in records if not r.get("ProposedDestination")
                                    and r.get("IntegrityStatus") not in C.MOVABLE_STATUSES),
                 "duplicates_left_in_place": sum(1 for r in records if "left in place" in (r.get("OperationStatus") or "")),
                 "renamed_to_avoid_collision": plan_stats.get("collisions", 0),
                 "collisions_with_existing_files": plan_stats.get("existing_conflicts", 0)},
        "review": {"date_conflicts": sum(1 for r in valid if r.get("DateConflict")),
                   "low_or_unknown_date_confidence": sum(1 for r in valid if r.get("DateConfidence") in (C.LOW, C.UNKNOWN_CONF)),
                   "low_confidence_classification": sum(1 for r in valid if r.get("ClassificationConfidence") == C.LOW),
                   "unknown_classification": sum(1 for r in valid if r.get("Classification") == C.UNKNOWN),
                   "classification_conflicts": sum(1 for r in valid if r.get("ClassificationConflicts")
                                                   and r.get("Classification") != C.UNKNOWN)},
        "skipped": dict(Counter(s.get("Kind") for s in walk.skipped)),
        "name_contains_mp4_not_processed": len(walk.name_contains_mp4),
        "processing_errors": sum(1 for r in records if r.get("Error")),
        "other_extensions_top": dict(other_ext.most_common(15)),
        "elapsed_seconds": round(elapsed, 1),
    }


def _n(v) -> str:
    return f"{v:,}"


def format_summary(s: dict, run: dict) -> str:
    L = []
    bar = "=" * 72
    L += [bar, " SCAN COMPLETE - DRY RUN (no media files were moved, renamed or modified)", bar]
    L.append(f"Source:        {run['source_root']}")
    L.append(f"Destination:   {run['destination_root']}   (nothing is created there during a dry run)")
    L.append(f"Run folder:    {run['reports_dir']}")
    L.append(f"Elapsed:       {human_duration(s['elapsed_seconds'])}")
    tools = run.get("tools", {})
    L.append("Tools:         " + " | ".join(
        f"{name} {t.get('version') or ''} ({t.get('status')})".replace("  ", " ") for name, t in tools.items())
        + " | built-in MP4 parser")
    L.append("")
    L.append(f"Directories scanned:          {_n(s['directories_scanned']):>12}")
    L.append(f"Files examined:               {_n(s['files_examined']):>12}")
    L.append(f"Deepest folder level:         {_n(s['deepest_folder_level']):>12}")
    for kind, count in sorted(s["skipped"].items()):
        L.append(f"Skipped ({kind}):".ljust(30) + f"{_n(count):>12}")
    L.append("")
    L.append(f"MP4 videos found:             {_n(s['mp4_found']):>12}   ({human_bytes(s['mp4_bytes'])})")
    L.append(f"  valid videos:               {_n(s['valid_videos']):>12}   (of which with notes: {s['valid_with_warnings']})")
    L.append(f"  invalid / unreadable MP4:   {_n(s['invalid_or_unreadable']):>12}   -> invalid_files.csv")
    for status, count in sorted(s["invalid_by_status"].items()):
        L.append(f"      {status:<24}{_n(count):>12}   {C.STATUS_DESCRIPTIONS.get(status, '')}")
    if s["name_contains_mp4_not_processed"]:
        L.append(f"  names containing '.mp4' with another extension (not processed): {s['name_contains_mp4_not_processed']}")
    L.append("")
    L.append("Resolved years (valid videos):")
    for year, count in s["years"].items():
        L.append(f"  {year + ':':<10}{_n(count):>10}")
    L.append("")
    L.append("Date sources:")
    for src, count in s["date_sources"].items():
        L.append(f"  {_n(count):>8}  {src}")
    conf = s["date_confidence"]
    L.append("Date confidence:  " + ", ".join(f"{k} {conf.get(k, 0)}" for k in (C.HIGH, C.MEDIUM, C.LOW, C.UNKNOWN_CONF)))
    L.append("")
    L.append("Classification:                  total      High  Medium     Low")
    for cat, c in s["classification"].items():
        L.append(f"  {cat + ':':<28}{_n(c['total']):>8}  {c[C.HIGH]:>8}{c[C.MEDIUM]:>8}{c[C.LOW]:>8}")
    L.append("")
    d = s["duplicates"]
    L.append(f"Exact duplicate files:        {_n(d['files_in_groups']):>12}   in {d['groups']} groups "
             f"({d['redundant_copies']} redundant copies, {human_bytes(d['redundant_bytes'])}) -> duplicates.csv")
    L.append("  (duplicates are only reported - nothing is ever deleted)")
    L.append("")
    p = s["plan"]
    L.append("Proposed operation (dry run):")
    L.append(f"  would move:                 {_n(p['would_move']):>12}   (duplicates policy: {run['options']['duplicates']})")
    L.append(f"  excluded (invalid):         {_n(p['excluded_invalid']):>12}   (only with 'move --include-invalid')")
    L.append(f"  cannot move (unreadable):   {_n(p['cannot_move']):>12}")
    if p["duplicates_left_in_place"]:
        L.append(f"  duplicates left in place:   {_n(p['duplicates_left_in_place']):>12}")
    L.append(f"  renamed to avoid overwrite: {_n(p['renamed_to_avoid_collision']):>12}   "
             f"({p['collisions_with_existing_files']} clash with files already in the destination)")
    L.append("")
    r = s["review"]
    L.append("Needs review (-> needs_review.csv, date_conflicts.csv):")
    L.append(f"  date conflicts between sources:     {_n(r['date_conflicts']):>8}")
    L.append(f"  low/unknown date confidence:        {_n(r['low_or_unknown_date_confidence']):>8}")
    L.append(f"  low-confidence classification:      {_n(r['low_confidence_classification']):>8}")
    L.append(f"  unknown classification:             {_n(r['unknown_classification']):>8}")
    L.append(f"  classification with conflicting evidence: {_n(r['classification_conflicts']):>2}")
    if s["processing_errors"]:
        L.append(f"  processing errors (see Error column): {_n(s['processing_errors'])}")
    if s["other_extensions_top"]:
        L.append("")
        L.append("Other file types seen (not processed in this prototype):")
        L.append("  " + ", ".join(f"{ext} {_n(n)}" for ext, n in s["other_extensions_top"].items()))
    L.append("")
    L.append("Next steps:")
    L.append("  1. Review manifest.csv (every file, with date/classification evidence and proposed destination).")
    L.append("  2. Preview the move (still changes nothing) - run from the Media Organizer folder:")
    L.append(f"       .\\media-organizer move \"{run['reports_dir']}\"")
    L.append("  3. Execute only when satisfied:")
    L.append(f"       .\\media-organizer move \"{run['reports_dir']}\" --execute")
    L.append(bar)
    return "\n".join(L)
