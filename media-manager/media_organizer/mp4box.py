"""Read-only inspector for the ISO base media file format (MP4 / MOV / 3GP).

Two jobs:
  1. Validate the container independently of the file extension: detect files
     that are not MP4 at all (renamed JPEGs, web pages, MKVs, zero-filled
     data), empty files, recordings that were never finalised (no 'moov'),
     truncated copies and damaged box structures.
  2. Provide a dependency-free fallback for key metadata: container dates,
     dimensions, rotation, codecs, handler names, udta/keys/ilst tags.

Only box headers and the 'moov' box are read; media payloads never are.
"""
from __future__ import annotations

import math
import os
import struct
from datetime import datetime, timedelta, timezone

from . import constants as C
from . import winfs

MP4_EPOCH = datetime(1904, 1, 1, tzinfo=timezone.utc)
MAX_MOOV_BYTES = 256 * 1024 * 1024
MAX_TOP_LEVEL_BOXES = 250_000
HEAD_BYTES = 4096

# Box types that may legitimately start an MP4/MOV/3GP file.
FIRST_BOX_TYPES = {b"ftyp", b"styp", b"moov", b"mdat", b"free", b"skip", b"wide",
                   b"pnot", b"uuid", b"sidx", b"junk", b"PICT"}
# ISO-BMFF brands that are still images, not video.
IMAGE_BRANDS = {"mif1", "msf1", "heic", "heix", "heim", "heis", "hevc", "hevx", "hevm",
                "hevs", "avif", "avis", "jp2 ", "jpx ", "crx "}

UDTA_TEXT_KEYS = {
    b"\xa9xyz": "location", b"\xa9mak": "make", b"\xa9mod": "model", b"\xa9swr": "software",
    b"\xa9too": "encoder", b"\xa9day": "date", b"\xa9cmt": "comment", b"\xa9nam": "title",
    b"\xa9des": "description", b"\xa9inf": "information", b"\xa9ART": "artist",
    b"\xa9fmt": "format", b"\xa9enc": "encoded_by", b"\xa9aut": "author",
}
ILST_KEYS = dict(UDTA_TEXT_KEYS)
ILST_KEYS.update({b"desc": "description", b"ldes": "long_description", b"cprt": "copyright",
                  b"\xa9alb": "album", b"\xa9gen": "genre", b"\xa9wrt": "composer", b"keyw": "keywords"})
THREEGPP_TEXT_KEYS = {b"titl": "title", b"dscp": "description", b"cprt": "copyright",
                      b"perf": "performer", b"auth": "author", b"gnre": "genre", b"albm": "album"}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _mp4_time(value: int):
    if not value:
        return None
    try:
        return MP4_EPOCH + timedelta(seconds=int(value))
    except (OverflowError, ValueError):
        return None


def _iso(dt):
    return dt.isoformat() if dt else None


def _valid_type(t: bytes) -> bool:
    return len(t) == 4 and all(0x20 <= c <= 0x7E or c == 0xA9 for c in t)


def _type_name(t: bytes) -> str:
    return t.decode("latin-1")


def _iter_boxes(buf, start: int, end: int):
    """Yield (type, payload_start, payload_end, malformed) for child boxes."""
    pos = start
    while pos + 8 <= end:
        size, btype = struct.unpack_from(">I4s", buf, pos)
        header = 8
        if size == 1:
            if pos + 16 > end:
                yield btype, pos + 8, end, True
                return
            size = struct.unpack_from(">Q", buf, pos + 8)[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            yield btype, min(pos + header, end), end, True
            return
        yield btype, pos + header, pos + size, False
        pos += size


def _decode_text(raw: bytes) -> str:
    raw = raw.split(b"\x00", 1)[0] if b"\x00" in raw.rstrip(b"\x00") else raw.rstrip(b"\x00")
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc).strip()
        except UnicodeDecodeError:
            continue
    return ""


def _qt_text(payload: bytes) -> str:
    """Decode a QuickTime udta text item ([size16][lang16][text]) or an iTunes 'data' box."""
    if len(payload) >= 16 and payload[4:8] == b"data":
        val = _data_value(payload, 0, len(payload))
        return "" if val is None else str(val)
    if len(payload) >= 4:
        size = struct.unpack_from(">H", payload, 0)[0]
        if 0 < size <= len(payload) - 4:
            return _decode_text(payload[4:4 + size])
    return _decode_text(payload)


def _data_value(buf, start: int, end: int):
    """Value of the first 'data' child box of an ilst item."""
    for btype, cs, ce, _bad in _iter_boxes(buf, start, end):
        if btype != b"data" or ce - cs < 8:
            continue
        type_code = struct.unpack_from(">I", buf, cs)[0] & 0xFFFFFF
        raw = bytes(buf[cs + 8:ce])
        if type_code in (1, 4):
            return raw.decode("utf-8", "replace").strip("\x00").strip()
        if type_code in (2, 5):
            return raw.decode("utf-16-be", "replace").strip("\x00").strip()
        if type_code == 23 and len(raw) == 4:
            return round(struct.unpack(">f", raw)[0], 6)
        if type_code == 24 and len(raw) == 8:
            return struct.unpack(">d", raw)[0]
        if type_code in (21, 65, 66, 67, 74) and raw:
            return int.from_bytes(raw, "big", signed=True)
        if type_code in (22, 75, 76, 77, 78) and raw:
            return int.from_bytes(raw, "big", signed=False)
        if type_code in (13, 14, 27):
            return f"<image {len(raw)} bytes>"
        text = raw.decode("utf-8", "replace").strip("\x00")
        if text and sum(ch.isprintable() for ch in text) / len(text) > 0.9:
            return text.strip()
        return f"<binary {len(raw)} bytes>"
    return None


# --------------------------------------------------------------------------
# signature sniffing
# --------------------------------------------------------------------------
def sniff(head: bytes, size: int) -> tuple[str, str]:
    """Identify the real format from the first bytes. Returns (kind, description)."""
    if size == 0 or not head:
        return "empty", "the file is empty (0 bytes)"
    if len(head) >= 8 and head[4:8] in FIRST_BOX_TYPES:
        return "isobmff", "ISO base media file (MP4/MOV family)"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        kind = "WebM" if b"webm" in head[:64] else "Matroska (MKV)"
        return "matroska", f"{kind} video saved with a .mp4 name - a video, but not an MP4 container"
    if head[:4] == b"RIFF":
        sub = head[8:12]
        if sub == b"AVI ":
            return "avi", "AVI video saved with a .mp4 name - not an MP4 container"
        if sub == b"WAVE":
            return "wav", "WAV audio file, not a video"
        if sub == b"WEBP":
            return "webp", "WebP image, not a video"
        return "riff", "RIFF file, not an MP4 container"
    if head[:3] == b"FLV":
        return "flv", "Flash video (FLV) saved with a .mp4 name - not an MP4 container"
    if head[:4] == b"\x30\x26\xb2\x75":
        return "asf", "Windows Media (WMV/ASF) file, not an MP4 container"
    if head[:4] == b"\x00\x00\x01\xba":
        return "mpeg-ps", "MPEG program stream, not an MP4 container"
    if head[:1] == b"\x47" and len(head) > 376 and head[188:189] == b"\x47" and head[376:377] == b"\x47":
        return "mpeg-ts", "MPEG transport stream (.ts), not an MP4 container"
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg", "JPEG image renamed to .mp4"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png", "PNG image renamed to .mp4"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif", "GIF image renamed to .mp4"
    if head[:4] == b"PK\x03\x04":
        return "zip", "ZIP archive renamed to .mp4"
    if head[:5] == b"%PDF-":
        return "pdf", "PDF document renamed to .mp4"
    if head[:3] == b"ID3" or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "mp3", "MP3 audio renamed to .mp4"
    sample = head[:1024]
    if not sample.strip(b"\x00"):
        return "zeros", "the file starts with only zero bytes - its data was probably lost or never written"
    lowered = sample.lower()
    if lowered.lstrip().startswith(b"#extm3u"):
        return "m3u8", "streaming playlist (text), not a video"
    if b"<html" in lowered or b"<!doctype" in lowered:
        return "html", "HTML web page saved with a .mp4 name (for example a failed download)"
    printable = sum(1 for c in sample if c in (9, 10, 13) or 32 <= c < 127)
    if printable / len(sample) > 0.95:
        return "text", "plain text file renamed to .mp4"
    return "unknown", "unrecognised content - not an MP4/MOV container"


def container_label(major: str | None) -> str:
    m = (major or "").lower()
    if m == "qt  ":
        return "QuickTime MOV"
    if m.startswith("3g2"):
        return "3GPP2"
    if m.startswith("3g"):
        return "3GPP"
    if m in ("m4a ", "m4b ", "m4p "):
        return "MP4 audio (M4A)"
    if m.startswith("m4v"):
        return "MP4 (M4V)"
    if m in ("dash", "iso5", "iso6", "msdh", "msix", "cmfc", "cmf2"):
        return "MP4 (fragmented / DASH)"
    if m in IMAGE_BRANDS:
        return f"HEIF/AVIF image ({(major or '').strip()})"
    return "MP4"


# --------------------------------------------------------------------------
# moov parsing
# --------------------------------------------------------------------------
def _parse_mvhd(buf, s, e):
    version = buf[s]
    if version == 1:
        ct, mt, ts, dur = struct.unpack_from(">QQIQ", buf, s + 4)
    else:
        ct, mt, ts, dur = struct.unpack_from(">IIII", buf, s + 4)
    return {"creation_time": _iso(_mp4_time(ct)), "modification_time": _iso(_mp4_time(mt)),
            "creation_raw": ct, "timescale": ts, "duration": (dur / ts) if ts else None}


def _parse_tkhd(buf, s, e):
    version = buf[s]
    flags = int.from_bytes(buf[s + 1:s + 4], "big")
    p = s + 4
    if version == 1:
        ct, mt, track_id, _r, dur = struct.unpack_from(">QQIIQ", buf, p)
        p += 32
    else:
        ct, mt, track_id, _r, dur = struct.unpack_from(">IIIII", buf, p)
        p += 20
    p += 8 + 8  # reserved(8), layer/alternate_group/volume/reserved(8)
    a, b, _u, _c, _d, _v, _x, _y, _w = struct.unpack_from(">9i", buf, p)
    p += 36
    width, height = struct.unpack_from(">II", buf, p)
    rotation = round(math.degrees(math.atan2(b / 65536.0, a / 65536.0))) % 360 if (a or b) else 0
    return {"track_id": track_id, "enabled": bool(flags & 1), "tkhd_creation_time": _iso(_mp4_time(ct)),
            "tkhd_width": width / 65536.0, "tkhd_height": height / 65536.0, "rotation": rotation}


def _parse_mdhd(buf, s, e):
    version = buf[s]
    if version == 1:
        ct, mt, ts, dur = struct.unpack_from(">QQIQ", buf, s + 4)
        p = s + 32
    else:
        ct, mt, ts, dur = struct.unpack_from(">IIII", buf, s + 4)
        p = s + 20
    lang = struct.unpack_from(">H", buf, p)[0] if p + 2 <= e else 0
    language = "".join(chr(((lang >> sh) & 0x1F) + 0x60) for sh in (10, 5, 0)) if lang else ""
    return {"mdhd_creation_time": _iso(_mp4_time(ct)), "timescale": ts,
            "duration": (dur / ts) if ts else None, "language": language}


def _parse_hdlr(buf, s, e):
    handler = bytes(buf[s + 8:s + 12]).decode("latin-1")
    raw = bytes(buf[s + 24:e])
    name = ""
    if raw:
        n = raw[0]
        tail = raw[1 + n:] if n <= len(raw) - 1 else b""
        if 0 < n <= len(raw) - 1 and all(ch >= 0x20 for ch in raw[1:1 + n]) and not tail.strip(b"\x00"):
            name = _decode_text(raw[1:1 + n])  # QuickTime Pascal string
        else:
            name = _decode_text(raw)  # ISO C string
    return handler, name


def _parse_stsd(buf, s, e, handler):
    count = struct.unpack_from(">I", buf, s + 4)[0]
    p = s + 8
    if count < 1 or p + 16 > e:
        return {}
    size, fourcc = struct.unpack_from(">I4s", buf, p)
    entry_end = min(p + size, e)
    out = {"codec": fourcc.decode("latin-1")}
    body = p + 16  # size, format, reserved(6), data_reference_index(2)
    if handler == "vide" and body + 70 <= entry_end:
        w, h = struct.unpack_from(">HH", buf, body + 16)
        cn = bytes(buf[body + 34:body + 66])
        out.update(sample_width=w, sample_height=h,
                   compressor_name=_decode_text(cn[1:1 + min(cn[0], 31)]) if cn else "")
    elif handler == "soun" and body + 20 <= entry_end:
        _ver, _rev, _vendor, channels, _bits, _cid, _pk, rate = struct.unpack_from(">HHIHHhHI", buf, body)
        out.update(channels=channels, sample_rate=rate >> 16)
    return out


def _parse_stts(buf, s, e):
    n = struct.unpack_from(">I", buf, s + 4)[0]
    n = min(n, max(0, (e - s - 8) // 8))
    total, deltas = 0, set()
    for count, delta in struct.iter_unpack(">II", bytes(buf[s + 8:s + 8 + 8 * n])):
        total += count
        if len(deltas) < 64:
            deltas.add(delta)
    return {"sample_count": total, "distinct_sample_durations": len(deltas)}


def _parse_stsz(buf, s, e):
    sample_size, count = struct.unpack_from(">II", buf, s + 4)
    if sample_size:
        return {"sample_bytes": sample_size * count}
    n = min(count, max(0, (e - s - 12) // 4))
    total = sum(v[0] for v in struct.iter_unpack(">I", bytes(buf[s + 12:s + 12 + 4 * n])))
    return {"sample_bytes": total}


def _max_chunk_offset(buf, s, e, wide):
    n = struct.unpack_from(">I", buf, s + 4)[0]
    width = 8 if wide else 4
    n = min(n, max(0, (e - s - 8) // width))
    if not n:
        return 0
    fmt = ">Q" if wide else ">I"
    return max(v[0] for v in struct.iter_unpack(fmt, bytes(buf[s + 8:s + 8 + width * n])))


def _parse_trak(buf, s, e, info):
    track = {}
    handler = None
    for btype, cs, ce, bad in _iter_boxes(buf, s, e):
        if bad:
            info["warnings"].append(f"malformed '{_type_name(btype)}' box inside a track")
        try:
            if btype == b"tkhd":
                track.update(_parse_tkhd(buf, cs, ce))
            elif btype == b"mdia":
                for mt, ms, me, _b in _iter_boxes(buf, cs, ce):
                    if mt == b"mdhd":
                        track.update(_parse_mdhd(buf, ms, me))
                    elif mt == b"hdlr":
                        handler, track["handler_name"] = _parse_hdlr(buf, ms, me)
                        track["handler"] = handler
                    elif mt == b"minf":
                        for nt, ns, ne, _b2 in _iter_boxes(buf, ms, me):
                            if nt != b"stbl":
                                continue
                            for tt, ts_, te, _b3 in _iter_boxes(buf, ns, ne):
                                if tt == b"stsd":
                                    track.update(_parse_stsd(buf, ts_, te, handler))
                                elif tt == b"stts":
                                    track.update(_parse_stts(buf, ts_, te))
                                elif tt == b"stsz":
                                    track.update(_parse_stsz(buf, ts_, te))
                                elif tt in (b"stco", b"co64"):
                                    track["max_chunk_offset"] = _max_chunk_offset(buf, ts_, te, tt == b"co64")
        except (struct.error, IndexError) as exc:
            info["warnings"].append(f"could not fully parse track box '{_type_name(btype)}': {exc}")
    dur = track.get("duration")
    if dur and track.get("sample_count") and track.get("handler") == "vide":
        track["fps"] = track["sample_count"] / dur
    if dur and track.get("sample_bytes"):
        track["bit_rate"] = int(track["sample_bytes"] * 8 / dur)
    return track


def _parse_loci(buf, s, e):
    p = s + 6  # version/flags(4), language(2)
    end_name = bytes(buf[p:e]).find(b"\x00")
    if end_name < 0:
        return None
    p += end_name + 1 + 1  # name terminator, role byte
    if p + 12 > e:
        return None
    lon, lat, alt = struct.unpack_from(">iii", buf, p)
    return f"{lat / 65536.0:+.5f}{lon / 65536.0:+.5f}{alt / 65536.0:+.1f}/"


def _parse_meta(buf, s, e, tags):
    # ISO 'meta' is a FullBox (4 bytes version/flags); QuickTime 'meta' is not.
    start = s if bytes(buf[s + 4:s + 8]) in (b"hdlr", b"keys", b"ilst") else s + 4
    keys, ilst = {}, None
    for btype, cs, ce, _bad in _iter_boxes(buf, start, e):
        if btype == b"keys":
            count = struct.unpack_from(">I", buf, cs + 4)[0]
            p = cs + 8
            for i in range(1, count + 1):
                if p + 8 > ce:
                    break
                ksize = struct.unpack_from(">I", buf, p)[0]
                if ksize < 8 or p + ksize > ce:
                    break
                keys[i] = bytes(buf[p + 8:p + ksize]).decode("utf-8", "replace")
                p += ksize
        elif btype == b"ilst":
            ilst = (cs, ce)
    if ilst is None:
        return
    for itype, is_, ie, _bad in _iter_boxes(buf, ilst[0], ilst[1]):
        idx = int.from_bytes(itype, "big")
        name = keys.get(idx) if keys else None
        if name is None:
            name = ILST_KEYS.get(itype, "ilst." + _type_name(itype))
        value = _data_value(buf, is_, ie)
        if value is not None and value != "":
            tags.setdefault(name, value)


def _parse_udta(buf, s, e, info):
    tags = info["tags"]
    for btype, cs, ce, bad in _iter_boxes(buf, s, e):
        info["udta_boxes"].append(_type_name(btype))
        if bad:
            info["warnings"].append(f"malformed '{_type_name(btype)}' box in user data")
            continue
        try:
            if btype == b"meta":
                _parse_meta(buf, cs, ce, tags)
            elif btype == b"loci":
                loc = _parse_loci(buf, cs, ce)
                if loc:
                    tags.setdefault("location", loc)
            elif btype in THREEGPP_TEXT_KEYS and ce - cs > 6:
                tags.setdefault(THREEGPP_TEXT_KEYS[btype], _decode_text(bytes(buf[cs + 6:ce])))
            elif btype == b"yrrc" and ce - cs >= 6:
                tags.setdefault("recording_year", struct.unpack_from(">H", buf, cs + 4)[0])
            elif btype in UDTA_TEXT_KEYS or btype[:1] == b"\xa9":
                key = UDTA_TEXT_KEYS.get(btype, "udta." + _type_name(btype))
                text = _qt_text(bytes(buf[cs:ce]))
                if text:
                    tags.setdefault(key, text)
        except (struct.error, IndexError) as exc:
            info["warnings"].append(f"could not parse user-data box '{_type_name(btype)}': {exc}")


def _parse_moov(buf, info):
    for btype, cs, ce, bad in _iter_boxes(buf, 0, len(buf)):
        info["moov_children"].append(_type_name(btype))
        if bad:
            info["warnings"].append(f"malformed '{_type_name(btype)}' box inside 'moov'")
        try:
            if btype == b"mvhd":
                info["mvhd"] = _parse_mvhd(buf, cs, ce)
            elif btype == b"trak":
                info["tracks"].append(_parse_trak(buf, cs, ce, info))
            elif btype == b"udta":
                _parse_udta(buf, cs, ce, info)
            elif btype == b"meta":
                _parse_meta(buf, cs, ce, info["tags"])
            elif btype == b"mvex":
                info["fragmented"] = True
        except (struct.error, IndexError) as exc:
            info["warnings"].append(f"could not parse '{_type_name(btype)}': {exc}")


# --------------------------------------------------------------------------
# top level
# --------------------------------------------------------------------------
def _new_info() -> dict:
    return {
        "status": None, "format": None, "format_description": "", "container": "",
        "major_brand": None, "minor_version": None, "compatible_brands": [],
        "top_level_boxes": [], "moov_children": [], "udta_boxes": [],
        "has_moov": False, "has_mdat": False, "fragmented": False, "moov_before_mdat": None,
        "truncated_box": None, "truncated_bytes": 0, "trailing_bytes": 0, "corrupt": False,
        "problems": [], "warnings": [], "mvhd": None, "tracks": [], "tags": {},
    }


def inspect_file(path: str, size: int | None = None) -> dict:
    """Inspect a file's container structure. Never modifies the file."""
    info = _new_info()
    try:
        with open(winfs.long_path(path), "rb") as f:
            if size is None or size < 0:
                size = os.fstat(f.fileno()).st_size
            head = f.read(HEAD_BYTES)
            kind, desc = sniff(head, size)
            info["format"], info["format_description"] = kind, desc
            if kind == "empty":
                info["status"] = C.EMPTY
                info["problems"].append(desc)
                return info
            if kind != "isobmff":
                info["status"] = C.NOT_MP4
                info["problems"].append(desc)
                return info
            _walk_top_level(f, size, info)
    except OSError as exc:
        info["status"] = C.UNREADABLE
        info["problems"].append(f"could not read the file: {winfs.describe_error(exc)}")
        return info
    _decide_status(info, size)
    return info


def _walk_top_level(f, size: int, info: dict):
    offset = 0
    boxes = info["top_level_boxes"]
    moov = None
    while offset < size:
        if len(boxes) >= MAX_TOP_LEVEL_BOXES:
            info["warnings"].append(f"stopped after {MAX_TOP_LEVEL_BOXES:,} top-level boxes")
            break
        remaining = size - offset
        f.seek(offset)
        hdr = f.read(16 if remaining >= 16 else remaining)
        if remaining < 8:
            if hdr.strip(b"\x00"):
                info["trailing_bytes"] = remaining
                info["warnings"].append(f"{remaining} stray byte(s) after the last box")
            break
        box_size, btype = struct.unpack_from(">I4s", hdr, 0)
        header = 8
        if box_size == 1:
            if len(hdr) < 16:
                info["problems"].append(f"incomplete box header at byte {offset:,}")
                info["truncated_box"] = _type_name(btype)
                break
            box_size = struct.unpack_from(">Q", hdr, 8)[0]
            header = 16
        elif box_size == 0:
            box_size = remaining
        if not _valid_type(btype) or box_size < header:
            if info["has_moov"] and (info["has_mdat"] or info["fragmented"]):
                info["trailing_bytes"] = remaining
                info["warnings"].append(
                    f"{remaining:,} bytes of non-box data after the last valid box "
                    "(for example a Samsung metadata trailer); the video structure itself is complete")
            else:
                info["corrupt"] = True
                info["problems"].append(
                    f"invalid box header at byte {offset:,} (type {btype!r}, size {box_size}) - the file structure is damaged")
            break
        name = _type_name(btype)
        if offset + box_size > size:
            missing = offset + box_size - size
            boxes.append({"type": name, "offset": offset, "size": box_size, "truncated": True})
            info["truncated_box"] = name
            info["truncated_bytes"] = missing
            info["problems"].append(
                f"the '{name}' box declares {box_size:,} bytes but the file ends {missing:,} bytes early "
                "- the file is truncated (incomplete copy or interrupted write)")
            if btype == b"mdat":
                info["has_mdat"] = True
            break
        boxes.append({"type": name, "offset": offset, "size": box_size})
        if btype == b"ftyp" and info["major_brand"] is None:
            f.seek(offset + header)
            payload = f.read(min(box_size - header, 1024))
            if len(payload) >= 8:
                info["major_brand"] = payload[0:4].decode("latin-1")
                info["minor_version"] = struct.unpack_from(">I", payload, 4)[0]
                info["compatible_brands"] = [payload[i:i + 4].decode("latin-1")
                                             for i in range(8, len(payload) - 3, 4)]
        elif btype == b"moov" and moov is None:
            moov = (offset, header, box_size)
            info["has_moov"] = True
        elif btype == b"mdat":
            if not info["has_mdat"]:
                info["moov_before_mdat"] = moov is not None
            info["has_mdat"] = True
        elif btype == b"moof":
            info["fragmented"] = True
        offset += box_size

    if moov is not None:
        m_off, m_hdr, m_size = moov
        body = m_size - m_hdr
        if body > MAX_MOOV_BYTES:
            info["warnings"].append(f"'moov' box is {body:,} bytes - too large to parse in detail")
        else:
            f.seek(m_off + m_hdr)
            buf = f.read(body)
            _parse_moov(buf, info)
        for t in info["tracks"]:
            if t.get("max_chunk_offset", 0) >= size and not info["truncated_box"]:
                info["truncated_box"] = "mdat"
                info["problems"].append(
                    "sample data is referenced beyond the end of the file - the file is truncated")
                break


def _decide_status(info: dict, size: int):
    brand = info["major_brand"]
    # ISO MP4 requires an 'ftyp' box; classic QuickTime files may not have one.
    info["container"] = container_label(brand) if brand else "QuickTime MOV (no 'ftyp' box)"
    if brand and brand.lower() in IMAGE_BRANDS:
        info["status"] = C.NOT_MP4
        info["problems"].append(f"this is a still image ({info['container']}), not a video")
        return
    if info["corrupt"]:
        info["status"] = C.CORRUPT
        return
    if info["truncated_box"] == "moov" or (info["truncated_box"] and info["has_moov"]):
        info["status"] = C.TRUNCATED
        return
    if not info["has_moov"]:
        info["status"] = C.NO_MOOV
        detail = "no 'moov' (movie header) box - typical of a recording that was interrupted " \
                 "before the phone finalised it; not playable without repair"
        if info["truncated_box"]:
            detail += " (the file is also truncated)"
        info["problems"].append(detail)
        return
    tracks = info["tracks"]
    video = [t for t in tracks if t.get("handler") == "vide"]
    audio = [t for t in tracks if t.get("handler") == "soun"]
    if not tracks:
        info["status"] = C.CORRUPT
        info["problems"].append("the movie header contains no tracks")
        return
    if not video:
        info["status"] = C.AUDIO_ONLY if audio else C.CORRUPT
        info["problems"].append("no video track" + (" (audio only)" if audio else " and no audio track"))
        return
    if not info["fragmented"] and all(not t.get("sample_count") for t in video):
        info["status"] = C.CORRUPT
        info["problems"].append("the video track contains no frames")
        return
    label = info["container"]
    if label.startswith("QuickTime"):
        info["warnings"].append("QuickTime (MOV) content with a .mp4 extension - common for iPhone exports; plays normally")
    elif label.startswith("3GPP"):
        info["warnings"].append(f"{label} container (older phone format) with a .mp4 extension")
    info["status"] = C.OK_WARNINGS if info["warnings"] else C.OK
