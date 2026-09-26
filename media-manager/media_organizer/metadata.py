"""Merge built-in parser, ffprobe and ExifTool output into one normalised record.

The result is plain JSON-serialisable data, stored in the manifest, so the
date and classification logic can be re-run later without re-reading files.
"""
from __future__ import annotations

import re

ANDROID_HANDLERS = {"videohandle", "soundhandle"}          # Android MPEG4Writer (camera / screen recorder)
FFMPEG_HANDLERS = {"videohandler", "soundhandler"}         # FFmpeg default handler names
SIGNATURE_WORDS = ("aigc", "vid_md5", "bytedance", "tiktok", "douyin", "capcut", "instagram", "snapchat",
                   "whatsapp", "telegram", "inshot", "kinemaster", "com.samsung", "com.xiaomi", "com.huawei",
                   "com.oppo", "com.oneplus", "com.sony", "com.motorola", "com.google", "com.lge")
MAX_TAG_LEN = 300


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def _fraction(text):
    if not text or text in ("0/0", "0"):
        return None
    if isinstance(text, str) and "/" in text:
        n, d = (_num(x) for x in text.split("/", 1))
        return n / d if n and d else None
    return _num(text)


def _short(v):
    s = str(v)
    return s if len(s) <= MAX_TAG_LEN else s[:MAX_TAG_LEN] + "..."


def parse_iso6709(text: str):
    """'+40.7128-074.0060+010.000/' -> (lat, lon) or None."""
    if not text:
        return None
    m = re.match(r"^\s*([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)", str(text))
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (abs(lat) < 1e-6 and abs(lon) < 1e-6):
        return None
    return lat, lon


def _exif_index(exif: dict | None) -> dict:
    """{lower tag name: [(group, value), ...]} from ExifTool -G1 -s JSON."""
    out: dict = {}
    for key, val in (exif or {}).items():
        if ":" in key:
            group, tag = key.split(":", 1)
        else:
            group, tag = "", key
        out.setdefault(tag.lower(), []).append((group, val))
    return out


def _first(*values):
    for v in values:
        if v not in (None, "", [], {}):
            return v
    return None


def _exif_get(ex: dict, tag: str, groups_skip=("System", "File", "ExifTool", "Composite")):
    for group, val in ex.get(tag.lower(), []):
        if group not in groups_skip and val not in (None, ""):
            return val
    return None


def normalize(box: dict, probe: dict | None, exif: dict | None) -> dict:
    md = {
        "sources": ["mp4-parser"] + (["ffprobe"] if probe else []) + (["exiftool"] if exif else []),
        "container": {"label": box.get("container") or "", "major_brand": box.get("major_brand"),
                      "compatible_brands": box.get("compatible_brands") or [],
                      "fragmented": bool(box.get("fragmented")), "ffprobe_format": None},
        "duration": None, "bit_rate": None, "video": None, "audio": None,
        "handler_video": None, "handler_audio": None, "vendor_id": None,
        "encoder": None, "make": None, "model": None, "software": None,
        "gps": None, "comment": None, "title": None, "description": None,
        "android_version": None, "android_capture_fps": None,
        "signature_tags": {}, "embedded_dates": [], "embedded_modified": None,
        "exif_groups": [], "raw_tags": {},
    }
    tags: dict = {}                    # merged lower-case tag view (ffprobe > parser > exiftool)
    ex = _exif_index(exif)

    # ---------------- ffprobe ----------------
    vstream = astream = None
    if probe:
        fmt = probe.get("format") or {}
        for k, v in (fmt.get("tags") or {}).items():
            tags.setdefault(k.lower(), v)
            md["raw_tags"][f"ffprobe.{k}"] = _short(v)
        md["duration"] = _num(fmt.get("duration"))
        md["bit_rate"] = _int(fmt.get("bit_rate"))
        md["container"]["ffprobe_format"] = fmt.get("format_name")
        for s in probe.get("streams") or []:
            ctype = s.get("codec_type")
            if ctype == "video" and not (s.get("disposition") or {}).get("attached_pic") and vstream is None:
                vstream = s
            elif ctype == "audio" and astream is None:
                astream = s

    # ---------------- built-in parser ----------------
    for k, v in (box.get("tags") or {}).items():
        tags.setdefault(k.lower(), v)
        md["raw_tags"][f"mp4.{k}"] = _short(v)
    btracks = box.get("tracks") or []
    bvideo = next((t for t in btracks if t.get("handler") == "vide"), None)
    baudio = next((t for t in btracks if t.get("handler") == "soun"), None)

    # ---------------- video ----------------
    video = {}
    if vstream:
        st = {k.lower(): v for k, v in (vstream.get("tags") or {}).items()}
        rotation = None
        for sd in vstream.get("side_data_list") or []:
            if "rotation" in sd:
                r = _num(sd.get("rotation"))
                if r is not None:
                    rotation = -r  # FFmpeg reports counter-clockwise degrees
        if rotation is None and st.get("rotate") is not None:
            rotation = _num(st.get("rotate"))
        video = {"codec": vstream.get("codec_name"), "codec_tag": vstream.get("codec_tag_string"),
                 "profile": vstream.get("profile"), "width": _int(vstream.get("width")),
                 "height": _int(vstream.get("height")), "pix_fmt": vstream.get("pix_fmt"),
                 "fps": _fraction(vstream.get("avg_frame_rate")) or _fraction(vstream.get("r_frame_rate")),
                 "r_fps": _fraction(vstream.get("r_frame_rate")), "bit_rate": _int(vstream.get("bit_rate")),
                 "frames": _int(vstream.get("nb_frames")), "rotation": rotation}
        md["handler_video"] = st.get("handler_name")
        md["vendor_id"] = st.get("vendor_id")
        for k in ("handler_name", "vendor_id", "encoder", "creation_time"):
            if st.get(k):
                md["raw_tags"][f"ffprobe.video.{k}"] = _short(st[k])
    if bvideo:
        video.setdefault("codec", None)
        if not video.get("codec"):
            video["codec"] = bvideo.get("codec")
        video["codec_tag"] = video.get("codec_tag") or bvideo.get("codec")
        video["width"] = video.get("width") or bvideo.get("sample_width") or _int(bvideo.get("tkhd_width"))
        video["height"] = video.get("height") or bvideo.get("sample_height") or _int(bvideo.get("tkhd_height"))
        if video.get("rotation") is None:
            video["rotation"] = bvideo.get("rotation")
        video["fps"] = video.get("fps") or bvideo.get("fps")
        video["bit_rate"] = video.get("bit_rate") or bvideo.get("bit_rate")
        video["frames"] = video.get("frames") or bvideo.get("sample_count")
        video["compressor"] = bvideo.get("compressor_name") or None
        video["distinct_sample_durations"] = bvideo.get("distinct_sample_durations")
        md["handler_video"] = md["handler_video"] or bvideo.get("handler_name")
    if video:
        rot = int(round(video.get("rotation") or 0)) % 360
        video["rotation"] = rot
        w, h = video.get("width"), video.get("height")
        if w and h:
            video["display_width"], video["display_height"] = (h, w) if rot in (90, 270) else (w, h)
        r_fps, fps = video.get("r_fps"), video.get("fps")
        vfr = None
        if r_fps and fps:
            vfr = abs(r_fps - fps) / r_fps > 0.02
        if video.get("distinct_sample_durations") is not None and video["distinct_sample_durations"] > 2:
            vfr = True
        video["vfr"] = vfr
        md["video"] = video
    if md["duration"] is None:
        md["duration"] = (box.get("mvhd") or {}).get("duration") or (bvideo or {}).get("duration")

    # ---------------- audio ----------------
    if astream:
        md["audio"] = {"codec": astream.get("codec_name"), "sample_rate": _int(astream.get("sample_rate")),
                       "channels": _int(astream.get("channels")), "bit_rate": _int(astream.get("bit_rate"))}
        md["handler_audio"] = {k.lower(): v for k, v in (astream.get("tags") or {}).items()}.get("handler_name")
    elif baudio:
        md["audio"] = {"codec": baudio.get("codec"), "sample_rate": baudio.get("sample_rate"),
                       "channels": baudio.get("channels"), "bit_rate": baudio.get("bit_rate")}
    if baudio and not md["handler_audio"]:
        md["handler_audio"] = baudio.get("handler_name")

    # ---------------- ExifTool ----------------
    if exif:
        md["exif_groups"] = sorted({k.split(":", 1)[0] for k in exif if ":" in k})
        interesting = re.compile(r"(date|make|model|software|encoder|handler|gps|location|comment|title|"
                                 r"description|android|compressor|vendor|author|creator|warning|error|samsung)", re.I)
        for key, val in exif.items():
            if interesting.search(key) and not key.startswith(("System:", "File:")):
                md["raw_tags"][f"exif.{key}"] = _short(val)

    # ---------------- named fields ----------------
    md["make"] = _first(tags.get("com.apple.quicktime.make"), tags.get("make"), tags.get("com.android.manufacturer"),
                        _exif_get(ex, "Make"), _exif_get(ex, "AndroidMake"))
    md["model"] = _first(tags.get("com.apple.quicktime.model"), tags.get("model"), tags.get("com.android.model"),
                         _exif_get(ex, "Model"), _exif_get(ex, "AndroidModel"))
    md["software"] = _first(tags.get("com.apple.quicktime.software"), tags.get("software"),
                            _exif_get(ex, "Software"))
    md["encoder"] = _first(tags.get("encoder"), tags.get("encoded_by"), tags.get("encoding_tool"),
                           _exif_get(ex, "Encoder"), _exif_get(ex, "EncodedBy"))
    md["comment"] = _first(tags.get("comment"), _exif_get(ex, "Comment"))
    md["title"] = _first(tags.get("title"), _exif_get(ex, "Title"))
    md["description"] = _first(tags.get("description"), tags.get("synopsis"), _exif_get(ex, "Description"))
    md["android_version"] = _first(tags.get("com.android.version"), _exif_get(ex, "AndroidVersion"))
    md["android_capture_fps"] = _first(tags.get("com.android.capture.fps"), _exif_get(ex, "AndroidCaptureFPS"))

    gps_text = _first(tags.get("com.apple.quicktime.location.iso6709"), tags.get("location"),
                      tags.get("location-eng"))
    coords = parse_iso6709(gps_text) if gps_text else None
    if coords is None:
        gc = _exif_get(ex, "GPSCoordinates")
        if isinstance(gc, str):
            nums = re.findall(r"[-+]?\d+(?:\.\d+)?", gc)
            if len(nums) >= 2:
                lat, lon = float(nums[0]), float(nums[1])
                if (abs(lat) > 1e-6 or abs(lon) > 1e-6) and -90 <= lat <= 90 and -180 <= lon <= 180:
                    coords, gps_text = (lat, lon), gc
        if coords is None:
            lat, lon = _num(_exif_get(ex, "GPSLatitude")), _num(_exif_get(ex, "GPSLongitude"))
            if lat is not None and lon is not None and (abs(lat) > 1e-6 or abs(lon) > 1e-6):
                coords, gps_text = (lat, lon), f"{lat} {lon}"
    if coords:
        md["gps"] = {"text": str(gps_text), "lat": round(coords[0], 6), "lon": round(coords[1], 6)}

    for k, v in tags.items():
        if any(w in k for w in SIGNATURE_WORDS) or k in ("vid", "aigc_info"):
            md["signature_tags"][k] = _short(v)

    # ---------------- embedded dates ----------------
    dates = md["embedded_dates"]
    seen = set()

    def add(field, label, tier, raw, source):
        if raw in (None, "", 0):
            return
        key = (field, str(raw))
        if key in seen:
            return
        seen.add(key)
        dates.append({"field": field, "label": label, "tier": tier, "raw": str(raw), "source": source})

    mvhd = box.get("mvhd") or {}
    add("apple.creationdate", "Apple QuickTime CreationDate (capture time incl. time zone)", 1,
        tags.get("com.apple.quicktime.creationdate"), "container tags")
    for group, val in ex.get("datetimeoriginal", []):
        add(f"exif.{group}.DateTimeOriginal", f"{group} DateTimeOriginal", 1, val, "exiftool")
    for group, val in ex.get("creationdate", []):
        add(f"exif.{group}.CreationDate", f"{group} CreationDate", 1, val, "exiftool")
    for group, val in ex.get("createdate", []):
        if group.startswith("XMP"):
            add(f"exif.{group}.CreateDate", f"{group} CreateDate", 1, val, "exiftool")
    add("udta.date", "embedded 'date' tag (©day)", 1, tags.get("date"), "container tags")
    for group, val in ex.get("contentcreatedate", []):
        add(f"exif.{group}.ContentCreateDate", f"{group} ContentCreateDate (©day)", 1, val, "exiftool")

    if mvhd.get("creation_time"):
        add("mvhd.creation_time", "MP4 movie header creation_time (mvhd)", 2, mvhd["creation_time"], "mp4-parser")
    elif tags.get("creation_time"):
        add("mvhd.creation_time", "MP4 movie header creation_time (mvhd)", 2, tags["creation_time"], "ffprobe")
    else:
        for group, val in ex.get("createdate", []):
            if group == "QuickTime":
                add("mvhd.creation_time", "MP4 movie header creation_time (mvhd)", 2, val, "exiftool")
    track_date = (bvideo or {}).get("mdhd_creation_time") or (bvideo or {}).get("tkhd_creation_time")
    if not track_date and vstream:
        track_date = {k.lower(): v for k, v in (vstream.get("tags") or {}).items()}.get("creation_time")
    add("track.creation_time", "video track creation_time (tkhd/mdhd)", 2, track_date, "container")

    md["embedded_modified"] = mvhd.get("modification_time") or _exif_get(ex, "ModifyDate")
    return md


def device_signature(md: dict) -> list:
    """Evidence that the file was written by the recording device itself."""
    reasons = []
    if md.get("make") or md.get("model"):
        reasons.append(f"device make/model recorded ({md.get('make') or '?'} {md.get('model') or ''})".strip())
    if md.get("android_capture_fps") is not None:
        reasons.append("Android camera capture-fps tag present")
    if md.get("android_version") is not None:
        reasons.append("Android recorder version tag present")
    hv = (md.get("handler_video") or "").strip().lower()
    if hv in ANDROID_HANDLERS:
        reasons.append("Android recorder track handler ('VideoHandle')")
    if "gopro" in hv:
        reasons.append("GoPro track handler")
    return reasons


def processing_signature(md: dict) -> str | None:
    """Name of the software that re-encoded/re-muxed the file, if identifiable."""
    enc = str(md.get("encoder") or "")
    if re.match(r"^\s*lav[fc]", enc, re.I):
        return f"FFmpeg ({enc})"
    for word in ("HandBrake", "Google", "Premiere", "After Effects", "Final Cut", "iMovie", "CapCut",
                 "InShot", "KineMaster", "Shotcut", "OpenShot", "DaVinci", "Movie Maker", "Clipchamp"):
        if word.lower() in enc.lower():
            return enc
    hv = (md.get("handler_video") or "").strip().lower()
    if hv in FFMPEG_HANDLERS and not md.get("make"):
        return "FFmpeg (default 'VideoHandler' track name)"
    if "produced by google" in hv:
        return "Google/YouTube"
    return None
