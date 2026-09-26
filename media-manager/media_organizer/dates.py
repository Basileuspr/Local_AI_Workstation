"""Best-available-date resolution with provenance and confidence.

Priority (as specified):
  1. embedded original/capture date      (Apple CreationDate, XMP DateTimeOriginal, (c)day)
  2. container creation timestamp         (mvhd / track creation_time)
  3. date encoded in a recognisable file name
  4. filesystem modified time
  5. filesystem created time
  6. unknown

No single field is trusted blindly: every candidate is checked for
plausibility (unset-clock defaults, epoch values, future dates) and the chosen
date is cross-checked against the independent sources (file name, file
modified time).  Agreement raises confidence; disagreement lowers it and is
reported in DateNotes / DateConflict.

Time zones: MP4 container times are UTC by specification and are converted to
this computer's local time zone.  Apple's CreationDate carries its own offset
and is used as the local wall-clock time directly.  When a file-name time
(local clock) matches the embedded instant up to a whole time-zone offset, the
file-name clock time is used, which fixes New-Year's-Eve edge cases.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from . import constants as C
from .names import split_sequence_prefix

EARLIEST_PLAUSIBLE = datetime(1995, 1, 1)
EARLIEST_TIKTOK = datetime(2016, 9, 1)

LEVELS = [C.UNKNOWN_CONF, C.LOW, C.MEDIUM, C.HIGH]


@dataclass
class DateCandidate:
    tier: int
    field: str
    label: str
    raw: str
    local: datetime | None = None      # local wall-clock time (naive)
    utc: datetime | None = None        # aware UTC instant, when known
    has_offset: bool = False           # value carried its own time-zone offset
    date_only: bool = False
    weak: bool = False                 # e.g. a bare numeric id that merely looks like a timestamp
    rank: int = 0
    usable: bool = True
    suspicious: bool = False
    issues: list = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"tier": self.tier, "field": self.field, "label": self.label, "raw": self.raw,
                "local": fmt(self.local, self.date_only), "utc": self.utc.isoformat() if self.utc else None,
                "has_offset": self.has_offset, "weak": self.weak, "usable": self.usable,
                "suspicious": self.suspicious, "issues": self.issues}


def fmt(dt: datetime | None, date_only: bool = False) -> str:
    if dt is None:
        return ""
    return dt.strftime("%Y-%m-%d") if date_only else dt.strftime("%Y-%m-%d %H:%M:%S")


def _to_local(aware: datetime) -> datetime | None:
    try:
        return aware.astimezone().replace(tzinfo=None)
    except (OverflowError, OSError, ValueError):
        return None


# ---------------------------------------------------------------------------
# embedded values
# ---------------------------------------------------------------------------
_EMB_RE = re.compile(r"^\s*(\d{4})[-:](\d{2})[-:](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?"
                     r"\s*(Z|[+-]\d{2}:?\d{2})?\s*$")


def parse_embedded(c: DateCandidate) -> DateCandidate:
    raw = c.raw.strip()
    m = _EMB_RE.match(raw)
    if not m:
        ym = re.match(r"^\s*(\d{4})\s*$", raw)
        if ym and int(ym.group(1)) > 0:
            c.local = datetime(int(ym.group(1)), 1, 1)
            c.date_only = True
            c.issues.append("year only")
            return c
        c.usable = False
        c.issues.append("unrecognised date format")
        return c
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y == 0 or mo == 0 or d == 0:
        c.usable = False
        c.issues.append("empty (zero) date value")
        return c
    try:
        naive = datetime(y, mo, d, int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0))
    except ValueError:
        c.usable = False
        c.issues.append("invalid calendar date")
        return c
    if m.group(4) is None:
        c.date_only = True
        c.local = naive
        return c
    tz = m.group(7)
    if tz and tz != "Z":
        sign = 1 if tz[0] == "+" else -1
        digits = tz[1:].replace(":", "")
        offset = timedelta(hours=int(digits[:2]), minutes=int(digits[2:]))
        c.utc = naive.replace(tzinfo=timezone(sign * offset)).astimezone(timezone.utc)
        if c.tier == 1:
            # a capture-date tag with its own offset: the value IS the local clock where it was recorded
            c.has_offset = True
            c.local = naive
            return c
    else:
        c.utc = naive.replace(tzinfo=timezone.utc)
    # container timestamps are UTC instants: show them in this computer's time zone
    c.local = _to_local(c.utc) or c.utc.replace(tzinfo=None)
    return c


# ---------------------------------------------------------------------------
# file-name dates
# ---------------------------------------------------------------------------
_SEP_RE = re.compile(
    r"(?<!\d)(?P<y>(?:19|20)\d\d)(?P<s>[-_.])(?P<m>\d\d)(?P=s)(?P<d>\d\d)"
    r"(?:(?:[-_T. ]|\s+at\s+)(?P<H>\d\d)[-_.:h]?(?P<M>\d\d)[-_.:m]?(?P<S>\d\d)\d{0,3})?(?!\d)", re.I)
_COMPACT_RE = re.compile(
    r"(?<![0-9A-Za-z])(?:(?:VID|IMG|PXL|MVIMG|MOV|VIDEO|REC|RDT|LV_0|INSHOT|CAPCUT)[_-]?)?"
    r"(?P<y>(?:19|20)\d\d)(?P<m>\d\d)(?P<d>\d\d)"
    r"(?:[-_T. ]?(?P<H>\d\d)(?P<M>\d\d)(?P<S>\d\d)(?P<ms>\d{1,3})?)?(?!\d)", re.I)
_UNIX_PREFIX_RE = re.compile(r"^(?P<p>mmexport|wx_camera_|RPReplay_Final|ssstik\.io_|snaptik_|video_)"
                             r"(?P<n>\d{13}|\d{10})(?!\d)", re.I)
_BARE_UNIX_RE = re.compile(r"^(?P<n>\d{13}|\d{10})$")
_TIKTOK_ID_RE = re.compile(r"(?<!\d)(?P<n>[67]\d{18})(?!\d)")
_HEX_ID_RE = re.compile(r"^[0-9a-f]{16,}$", re.I)


def _mk(y, mo, d, H=None, M=None, S=None):
    try:
        if H is None:
            return datetime(int(y), int(mo), int(d)), True
        return datetime(int(y), int(mo), int(d), int(H), int(M), int(S)), False
    except ValueError:
        return None, False


def filename_candidates(stem: str, now: datetime | None = None) -> list:
    """Date candidates encoded in a file name (without extension)."""
    now = now or datetime.now()
    out = []
    stem, _prefix = split_sequence_prefix(stem)
    if not _HEX_ID_RE.match(stem):
        best = None
        for rx, kind in ((_SEP_RE, "separated"), (_COMPACT_RE, "compact")):
            for m in rx.finditer(stem):
                dt, date_only = _mk(m.group("y"), m.group("m"), m.group("d"),
                                    m.group("H"), m.group("M"), m.group("S"))
                if dt is None and m.group("H") is not None:
                    dt, date_only = _mk(m.group("y"), m.group("m"), m.group("d"))
                if dt is None or not (EARLIEST_PLAUSIBLE.year <= dt.year <= now.year):
                    continue
                if best is None or m.start() < best[0]:
                    best = (m.start(), dt, date_only, m.group(0))
                break
        if best:
            _, dt, date_only, text = best
            label = "file name date" + ("" if date_only else " and time") + f" ('{text.strip('_- ')}')"
            out.append(DateCandidate(3, "filename", label, text, local=dt, date_only=date_only))
    m = _UNIX_PREFIX_RE.match(stem) or _BARE_UNIX_RE.match(stem)
    if m:
        n = int(m.group("n"))
        ts = n / 1000 if len(m.group("n")) == 13 else n
        try:
            dt = datetime.fromtimestamp(ts)
        except (OverflowError, OSError, ValueError):
            dt = None
        if dt and datetime(2005, 1, 1) <= dt <= now:
            prefixed = "p" in m.groupdict() and m.groupdict().get("p")
            label = f"Unix timestamp in file name ('{m.group(0)}')"
            out.append(DateCandidate(3, "filename.unix", label, m.group(0), local=dt, weak=not prefixed))
    m = _TIKTOK_ID_RE.search(stem)
    if m:
        try:
            dt = datetime.fromtimestamp(int(m.group("n")) >> 32)
        except (OverflowError, OSError, ValueError):
            dt = None
        if dt and EARLIEST_TIKTOK <= dt <= now:
            out.append(DateCandidate(3, "filename.tiktok_id",
                                     "TikTok video ID in file name (encodes when the video was posted)",
                                     m.group("n"), local=dt, weak=True))
    return out


# ---------------------------------------------------------------------------
# plausibility
# ---------------------------------------------------------------------------
def assess(c: DateCandidate, now: datetime) -> None:
    if not c.usable:
        return
    if c.local is None:
        c.usable = False
        c.issues.append("could not be converted to local time")
        return
    if c.local < EARLIEST_PLAUSIBLE:
        c.usable = False
        c.issues.append(f"{fmt(c.local, c.date_only)} is before {EARLIEST_PLAUSIBLE.year} - an unset clock or "
                        "epoch default (1904/1970/1980), ignored")
        return
    if c.local > now + timedelta(days=1):
        c.usable = False
        c.issues.append(f"{fmt(c.local, c.date_only)} is in the future - ignored")
        return
    if not c.date_only:
        for dt in (c.local, c.utc.replace(tzinfo=None) if c.utc else None):
            if dt is not None and (dt.month, dt.day, dt.hour, dt.minute, dt.second) == (1, 1, 0, 0, 0):
                c.suspicious = True
                c.issues.append("exactly midnight on 1 January - a typical default of a device whose clock was never set")
                break


# ---------------------------------------------------------------------------
# comparison helpers
# ---------------------------------------------------------------------------
def _is_tz_offset(diff: float, duration: float) -> bool:
    for d in (diff, diff - duration, diff + duration):
        a = abs(d)
        if 780 <= a <= 14 * 3600 + 120:
            rem = a % 900
            if min(rem, 900 - rem) <= 120:
                return True
    return False


def relation(chosen: DateCandidate, other: DateCandidate, duration: float) -> tuple[str, float]:
    """'agree', 'tz-offset', 'near' or 'conflict' plus the difference in seconds."""
    if chosen.date_only or other.date_only:
        days = abs((chosen.local.date() - other.local.date()).days)
        return ("agree" if days <= 1 else "conflict"), days * 86400.0
    diff = (chosen.local - other.local).total_seconds()
    tolerance = max(300.0, duration + 120.0)  # Android writes the stop time; names hold the start time
    if abs(diff) <= tolerance:
        return "agree", diff
    if _is_tz_offset(diff, duration):
        return "tz-offset", diff
    if abs(diff) <= 36 * 3600:
        return "near", diff
    return "conflict", diff


def _span(seconds: float) -> str:
    s = abs(seconds)
    if s >= 2 * 86400:
        return f"{s / 86400:.0f} days"
    if s >= 3600:
        return f"{s / 3600:.1f} h"
    return f"{s / 60:.0f} min"


# ---------------------------------------------------------------------------
# resolution
# ---------------------------------------------------------------------------
def build_candidates(embedded: list, stem: str, mtime: float | None, created: float | None,
                     now: datetime | None = None) -> list:
    now = now or datetime.now()
    cands = []
    for i, e in enumerate(embedded or []):
        c = DateCandidate(int(e.get("tier", 2)), e.get("field", "embedded"), e.get("label", "embedded date"),
                          str(e.get("raw", "")), rank=i)
        cands.append(parse_embedded(c))
    cands.extend(filename_candidates(stem, now))
    for tier, field_name, label, ts in ((4, "fs.modified", "filesystem modified time", mtime),
                                        (5, "fs.created", "filesystem created time", created)):
        if ts is None:
            continue
        try:
            local = datetime.fromtimestamp(ts)
        except (OverflowError, OSError, ValueError):
            local = None
        c = DateCandidate(tier, field_name, label, fmt(local) or str(ts), local=local)
        if local is None:
            c.usable = False
            c.issues.append("invalid timestamp")
        cands.append(c)
    for c in cands:
        assess(c, now)
    return cands


def resolve(cands: list, duration: float | None = None, device_written: list | None = None,
            processed_by: str | None = None) -> dict:
    duration = float(duration or 0.0)
    usable = [c for c in cands if c.usable]
    notes, conflicts = [], []
    for c in cands:
        if not c.usable and c.tier <= 3:
            notes.append(f"Ignored {c.label} '{c.raw}': {'; '.join(c.issues)}.")

    embedded = sorted((c for c in usable if c.tier in (1, 2)), key=lambda c: (c.tier, c.rank))
    names = [c for c in usable if c.tier == 3]
    name = next((c for c in names if not c.weak), None) or (names[0] if names else None)
    fs_mod = next((c for c in usable if c.tier == 4), None)
    fs_created = next((c for c in usable if c.tier == 5), None)

    result = {"ResolvedDate": "", "ResolvedYear": "Unknown", "DateSource": "none",
              "DateConfidence": C.UNKNOWN_CONF, "DateNotes": "", "DateConflict": "",
              "FilenameDate": fmt(name.local, name.date_only) if name else "",
              "EmbeddedCreated": "", "EmbeddedCreatedField": ""}
    shown = sorted((c for c in cands if c.tier in (1, 2)), key=lambda c: (not c.usable, c.tier, c.rank))
    if shown:
        result["EmbeddedCreated"] = _describe_embedded(shown[0]) + ("" if shown[0].usable else " (ignored)")
        result["EmbeddedCreatedField"] = shown[0].label

    if embedded:
        chosen = embedded[0]
        resolved, resolved_date_only = chosen.local, chosen.date_only
        corroborated, contradicted_year, contradicted = [], False, False
        if name:
            rel, diff = relation(chosen, name, duration)
            if rel == "agree":
                corroborated.append("file name")
                notes.append(f"Corroborated by the file name ({name.raw}).")
            elif rel == "tz-offset":
                corroborated.append("file name")
                if not chosen.has_offset and not name.date_only:
                    resolved, resolved_date_only = name.local, False
                    notes.append(f"The embedded time and the file-name time are the same moment {_span(diff)} "
                                 "apart (a time-zone difference); the file name's local clock time is used.")
                else:
                    notes.append("File-name time matches the embedded time up to a time-zone offset.")
            elif rel == "near":
                notes.append(f"File-name time is {_span(diff)} away from the embedded time (same period).")
            else:
                contradicted = True
                msg = (f"File name suggests {fmt(name.local, name.date_only)} but {chosen.label} says "
                       f"{fmt(chosen.local, chosen.date_only)} ({_span(diff)} apart).")
                if name.local.year != chosen.local.year:
                    contradicted_year = True
                    conflicts.append(msg + f" Years differ ({name.local.year} vs {chosen.local.year}).")
                else:
                    notes.append(msg)
        if fs_mod:
            gap = (fs_mod.local - chosen.local).total_seconds()
            if abs(gap) <= 2 * 86400 + duration:
                corroborated.append("file modified time")
                notes.append("File modified time is consistent with the embedded date.")
            elif gap < 0:
                contradicted = True
                msg = (f"File modified time ({fmt(fs_mod.local)}) is {_span(gap)} EARLIER than the embedded "
                       f"date - unusual; the recording device's clock may have been wrong.")
                if fs_mod.local.year != chosen.local.year:
                    conflicts.append(msg)
                else:
                    notes.append(msg)
        if chosen.tier == 1 and chosen.has_offset:
            level = C.HIGH
            notes.insert(0, "Capture date with time-zone offset embedded by the device.")
        elif device_written or corroborated:
            level = C.HIGH
            if device_written and not corroborated:
                notes.insert(0, "Container timestamp written by the recording device ("
                                + "; ".join(device_written[:2]) + ").")
        else:
            level = C.MEDIUM
        if chosen.suspicious:
            level = C.LOW
            notes.append(f"The chosen value looks like a default clock setting: {'; '.join(chosen.issues)}.")
        if contradicted_year:
            level = C.LOW
        elif contradicted:
            level = _cap(level, C.MEDIUM)
        if processed_by and not corroborated and not device_written:
            level = _cap(level, C.MEDIUM)
            notes.append(f"File was processed by {processed_by}; its embedded date may be the "
                         "processing/download time rather than the original recording time.")
        for other in embedded[1:]:
            if other.local and abs((other.local - chosen.local).total_seconds()) > 2 * 86400:
                notes.append(f"Other embedded field {other.label} = {fmt(other.local, other.date_only)} "
                             "(differs; kept for reference).")
                break
        _set(result, resolved, resolved_date_only, chosen.label, level)
    elif name:
        level = C.LOW if name.weak else C.MEDIUM
        notes.insert(0, "No usable embedded date; the date comes from the file-name pattern.")
        if fs_mod and relation(name, fs_mod, duration)[0] in ("agree", "near") \
                and abs((fs_mod.local - name.local).total_seconds()) <= 2 * 86400:
            level = C.MEDIUM if name.weak else C.HIGH
            notes.append("File modified time agrees with the file-name date.")
        if name.weak:
            notes.append("The file-name number only looks like a timestamp, so confidence is limited.")
        _set(result, name.local, name.date_only, name.label, level)
    elif fs_mod:
        notes.insert(0, "No embedded or file-name date. The file modified time is used - it may reflect when "
                        "the file was copied or edited rather than when it was recorded.")
        _set(result, fs_mod.local, False, fs_mod.label, C.LOW)
    elif fs_created:
        notes.insert(0, "Only the filesystem created time was usable. On copied files this is usually the "
                        "copy date, so it is a weak indicator.")
        _set(result, fs_created.local, False, fs_created.label, C.LOW)
    else:
        notes.insert(0, "No usable date found in metadata, file name or filesystem.")

    result["DateNotes"] = " ".join(notes)
    result["DateConflict"] = " ".join(conflicts)
    result["DateCandidates"] = [c.as_dict() for c in cands]
    return result


def _describe_embedded(c: DateCandidate) -> str:
    if c.has_offset or (c.local is None and c.utc is None):
        return c.raw
    if c.utc is not None:
        return c.utc.strftime("%Y-%m-%d %H:%M:%S UTC")
    return fmt(c.local, c.date_only)


def _cap(level: str, maximum: str) -> str:
    return level if C.CONFIDENCE_RANK[level] <= C.CONFIDENCE_RANK[maximum] else maximum


def _set(result: dict, dt: datetime, date_only: bool, source: str, level: str) -> None:
    result["ResolvedDate"] = fmt(dt, date_only)
    result["ResolvedYear"] = str(dt.year)
    result["DateSource"] = source
    result["DateConfidence"] = level
