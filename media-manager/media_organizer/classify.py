"""Broad media-origin classification from weighted, explainable evidence.

Each rule adds (or subtracts) points for a category and records a sentence
explaining why.  The folder path is deliberately only one input among many:
embedded metadata can outweigh a misleading folder or file name.

Confidence is derived from the winning score, its margin over the runner-up,
and how much evidence pointed elsewhere, so conflicting evidence can never
produce a "High" result.  Weights are heuristic; see TESTING.md for how to
record misclassifications so they can be tuned.
"""
from __future__ import annotations

import re
from datetime import datetime

from . import constants as C
from .metadata import ANDROID_HANDLERS, FFMPEG_HANDLERS
from .names import split_sequence_prefix

CAMERA, SOCIAL, SCREEN, DOWNLOAD, MESSAGING = C.CAMERA, C.SOCIAL, C.SCREEN, C.DOWNLOAD, C.MESSAGING
SHORT = {CAMERA: "Camera", SOCIAL: "Social", SCREEN: "Screen", DOWNLOAD: "Download", MESSAGING: "Messaging/App"}

MIN_SCORE = 25           # below this the result is Unknown
HIGH_SCORE, HIGH_MARGIN = 70, 35
MEDIUM_SCORE, MEDIUM_MARGIN = 40, 20
CONFLICT_CAP_MEDIUM = 40  # other category with >= this much positive evidence -> at most Medium
CONFLICT_CAP_LOW = 60     # ... and >= this much with a small margin -> Low

# ---------------------------------------------------------------------------
# folder rules: (regex on a normalised folder name, category, weight, reason)
# ---------------------------------------------------------------------------
_PATH_RULES = [
    (r"screen ?recordings?|screen ?recorder|screenrecord(er|ings?)?|screen ?captures?|screencasts?|screen ?record",
     SCREEN, 35, "screen-recording folder"),
    (r"screenshots?", SCREEN, 12, "Screenshots folder (some phones save screen recordings there)"),
    (r"tiktok|tik tok|musically|musical\.ly|douyin|com\.zhiliaoapp\.musically|com\.ss\.android\.ugc\.(trill|aweme)",
     SOCIAL, 35, "TikTok folder"),
    (r"instagram|com\.instagram\.android|igtv|reels", SOCIAL, 30, "Instagram folder"),
    (r"snapchat|com\.snapchat\.android", MESSAGING, 30, "Snapchat folder (camera-messaging app)"),
    (r"facebook|com\.facebook\.katana|twitter|reddit|tumblr|pinterest|likee|triller|vine|kwai|snack video|lemon8",
     SOCIAL, 25, "social-media app folder"),
    (r"whatsapp( video| animated gifs| business| documents)?|com\.whatsapp(\.w4b)?", MESSAGING, 40, "WhatsApp media folder"),
    (r"telegram( video| x)?|org\.telegram\.messenger", MESSAGING, 40, "Telegram media folder"),
    (r"messenger|com\.facebook\.orca|signal|viber( videos)?|wechat|weixin|com\.tencent\.mm|line|kakaotalk|kik|"
     r"groupme|discord|skype|imo|hangouts|textra|textnow|mms|imessage|zalo|botim|threema",
     MESSAGING, 30, "messaging-app folder"),
    (r"inshot|capcut|kinemaster|vivavideo|quik|splice|vn|vn video editor|powerdirector|filmorago|youcut|videoshow|"
     r"funimate|videoleap|imovie|magisto|vllo|alight motion", MESSAGING, 25, "video-editing app output folder"),
    (r"downloads?|download manager|bluetooth|shareit|xender|snaptube|vidmate|videoder|tubemate|ytd|y2mate|savefrom|"
     r"keepvid|4k video downloader|uc ?downloads|browser|chrome|firefox|opera|samsung internet",
     DOWNLOAD, 25, "download / file-transfer folder"),
]
_PATH_RULES = [(re.compile(rf"^(?:{rx})$", re.I), cat, w, why) for rx, cat, w, why in _PATH_RULES]
_DCF_RE = re.compile(r"^\d{3}[a-z0-9_]{5}$", re.I)   # DCIM\100APPLE, DCIM\100ANDRO, DCIM\101MEDIA

# ---------------------------------------------------------------------------
# file-name rules (matched against the name without extension)
# ---------------------------------------------------------------------------
_NAME_RULES = [
    (r"^VID-\d{8}-WA\d{3,}", MESSAGING, 45, "WhatsApp file name (VID-YYYYMMDD-WA####)"),
    (r"^WhatsApp Video \d{4}-\d{2}-\d{2} at ", MESSAGING, 45, "WhatsApp export file name"),
    (r"^received_\d{9,}", MESSAGING, 40, "Facebook Messenger saved-video name (received_<id>)"),
    (r"^mmexport\d{13}", MESSAGING, 40, "WeChat export name (mmexport<timestamp>)"),
    (r"^wx_camera_\d{13}", MESSAGING, 35, "WeChat in-app camera name"),
    (r"^signal-\d{4}-\d{2}-\d{2}-\d{6}", MESSAGING, 40, "Signal attachment name"),
    (r"^(InShot|YouCut|CapCut|KineMaster|VivaVideo|Quik|Splice|PowerDirector|FilmoraGo|VN|lv_0)_", MESSAGING, 35,
     "video-editor export name"),
    (r"^(Screen[_ ]?Recording|Screenrecorder|Screenrecord|screen-\d{8}|Screencast|RPReplay_Final|XRecorder|"
     r"AZ_?Recorder|Record_\d{4}-\d{2}-\d{2}|screenrecording)", SCREEN, 45, "screen-recorder file name"),
    (r"^(snaptik|ssstik|musicallydown|tikmate|savetik|ttdownloader|tiktok|tik_tok|douyin)", SOCIAL, 40,
     "TikTok / TikTok-downloader file name"),
    (r"tiktok", SOCIAL, 25, "file name mentions TikTok"),
    (r"^Snapchat-\d+", MESSAGING, 40, "Snapchat saved-snap name (Snapchat-<number>)"),
    (r"^RDT_\d{8}_\d{6}", SOCIAL, 35, "Reddit app saved-video name (RDT_...)"),
    (r"^\d{6,}_\d{6,}_\d{6,}_[no]$", SOCIAL, 30, "Facebook/Instagram CDN file name (<id>_<id>_<id>_n)"),
    (r"^(insta|instagram|igtv|reel)[_\- ]", SOCIAL, 25, "file name mentions Instagram"),
    (r"^(twitter|tweet)[_\- ]", SOCIAL, 25, "file name mentions Twitter"),
    (r"^(VID_\d{8}_\d{6}|\d{8}_\d{6}(_\d{1,3})?$|PXL_\d{8}_\d{6,9}|VID\d{14}|video_\d{8}_\d{6})", CAMERA, 25,
     "phone-camera file name pattern"),
    (r"^(GH|GX|GL)\d{6}$|^GOPR\d{4}$|^GP\d{6}$", CAMERA, 35, "GoPro file name"),
    (r"^DJI_\d{4}|^DJI_\d{14}", CAMERA, 30, "DJI camera/drone file name"),
    (r"^(IMG|MVI|MOV|DSC|DSCF|CLIP|MAH|PRIV|MVIMG)_?\d{3,5}$", CAMERA, 15,
     "camera sequence-number name (IMG_1234 / MVI_0001 / MOV_0001)"),
    (r"^(y2mate|ytmp3|savefrom|videoplayback|yt1s|9xbuddy|keepvid|ssyoutube)", DOWNLOAD, 40,
     "web-downloader or browser-saved stream name"),
    (r"\[[A-Za-z0-9_-]{11}\]$", DOWNLOAD, 35, "yt-dlp style name ending in [video id]"),
    (r"\(\d{1,3}\)$", DOWNLOAD, 10, "browser-style duplicate suffix ' (1)'"),
]
_NAME_RULES = [(re.compile(rx, re.I), cat, w, why) for rx, cat, w, why in _NAME_RULES]
_HEX32_RE = re.compile(r"^[0-9a-f]{32}$", re.I)
_HEXLONG_RE = re.compile(r"^[0-9a-f]{16,}$", re.I)
_TIKTOK_ID_RE = re.compile(r"^[67]\d{18}$")
_YT_ID_TAIL_RE = re.compile(r" .*-([A-Za-z0-9_-]{11})$")

# phone screens (short side x long side) that are not camera video modes
_SCREEN_SIZES = {(1080, 2340), (1080, 2400), (1440, 3200), (1440, 3040), (1080, 2280), (1080, 2220),
                 (720, 1520), (720, 1600), (1080, 2160), (1440, 2960), (1440, 2880), (1125, 2436),
                 (1242, 2688), (828, 1792), (1170, 2532), (1284, 2778), (1179, 2556), (1290, 2796),
                 (886, 1920), (888, 1920), (720, 1440), (1080, 2310), (1080, 2408), (1440, 3088),
                 (1080, 2316)}
# app names that screen recorders append to their file names (the app on screen, not the file's origin)
_APP_MENTION_RULES = {"file name mentions TikTok", "TikTok / TikTok-downloader file name",
                      "file name mentions Instagram", "file name mentions Twitter"}


class _Evidence:
    def __init__(self):
        self.items = []
        self.notes = []

    def add(self, category, weight, reason, kind):
        self.items.append({"category": category, "weight": int(weight), "reason": reason, "kind": kind})


def _norm_folder(name: str) -> str:
    return re.sub(r"[\s_\-]+", " ", name.strip().lower())


def _path_evidence(parts, ev: _Evidence):
    low = [p.lower() for p in parts]
    added = set()
    camera_path = False
    for i, raw in enumerate(parts):
        n = _norm_folder(raw)
        prev = low[i - 1] if i else ""
        shown = "\\".join(parts[max(0, i - 1):i + 1])
        if prev == "dcim" and n in ("camera", "camera roll"):
            ev.add(CAMERA, 25, f"folder '{shown}' is the phone camera's default save location", "folder")
            camera_path = True
        elif prev == "dcim" and _DCF_RE.match(raw):
            ev.add(CAMERA, 20, f"folder '{shown}' is a standard camera (DCF) folder", "folder")
            camera_path = True
        elif n in ("camera", "camera roll") and not camera_path:
            ev.add(CAMERA, 12, f"folder '{raw}' suggests camera footage", "folder")
            camera_path = True
        for rx, cat, weight, why in _PATH_RULES:
            if (rx.pattern, cat) in added:
                continue
            if rx.match(n) or rx.match(raw.lower()):
                ev.add(cat, weight, f"{why}: '{raw}'", "folder")
                added.add((rx.pattern, cat))
    if "dcim" in low and not camera_path:
        ev.add(CAMERA, 10, "stored under a DCIM (camera roll) folder", "folder")


def _name_evidence(stem: str, ev: _Evidence):
    stem, prefix = split_sequence_prefix(stem)
    if prefix:
        ev.notes.append(f"leading sequence number '{prefix}' ignored when matching file-name patterns")
    matched_social = False
    screen_name = any(cat == SCREEN and rx.search(stem) for rx, cat, _w, _y in _NAME_RULES)
    for rx, cat, weight, why in _NAME_RULES:
        if cat == SOCIAL and why == "file name mentions TikTok" and matched_social:
            continue
        if screen_name and why in _APP_MENTION_RULES:
            if rx.search(stem):
                ev.notes.append("app name in a screen-recording file name identifies what was on screen, "
                                "not where the file came from - not counted")
            continue
        if rx.search(stem):
            ev.add(cat, weight, f"{why}: '{stem}'", "file name")
            if cat == SOCIAL:
                matched_social = True
    if _TIKTOK_ID_RE.match(stem):
        try:
            posted = datetime.fromtimestamp(int(stem) >> 32)
        except (OverflowError, OSError, ValueError):
            posted = None
        if posted and datetime(2016, 9, 1) <= posted <= datetime.now():
            ev.add(SOCIAL, 30, f"file name is a TikTok video ID (posted {posted:%Y-%m-%d})", "file name")
    elif _HEX32_RE.match(stem):
        ev.add(SOCIAL, 10, "random 32-character hex name (app-generated; TikTok saves use this form)", "file name")
        ev.add(DOWNLOAD, 5, "random hex name (app/web generated, not a camera name)", "file name")
        ev.add(MESSAGING, 5, "random hex name (app generated)", "file name")
    elif _HEXLONG_RE.match(stem):
        ev.add(DOWNLOAD, 5, "random hex name (app/web generated)", "file name")
        ev.add(MESSAGING, 5, "random hex name (app generated)", "file name")
    m = _YT_ID_TAIL_RE.search(stem)
    if m and re.search(r"[A-Z]", m.group(1)) and re.search(r"[a-z]", m.group(1)):
        ev.add(DOWNLOAD, 25, "title followed by an 11-character video id (youtube-dl naming)", "file name")
    words = re.findall(r"[A-Za-zÀ-ɏ]{2,}", stem)
    if len(words) >= 3 and " " in stem and not any(i["kind"] == "file name" and i["weight"] >= 25 for i in ev.items):
        ev.add(DOWNLOAD, 8, "descriptive, title-like file name (typical of downloads)", "file name")


def _meta_evidence(md: dict, ev: _Evidence):
    make, model = md.get("make"), md.get("model")
    if make or model:
        ev.add(CAMERA, 35, f"device make/model recorded in metadata: {make or ''} {model or ''}".strip(), "metadata")
    if md.get("gps"):
        ev.add(CAMERA, 30, f"GPS location embedded ({md['gps'].get('text')}) - social and messaging apps "
                           "normally strip location", "metadata")
    if md.get("android_capture_fps") is not None:
        ev.add(CAMERA, 30, f"Android camera capture-fps tag ({md['android_capture_fps']}) - written only by "
                           "the camera app", "metadata")
    hv = (md.get("handler_video") or "").strip()
    hv_low = hv.lower()
    if md.get("android_version") is not None or hv_low in ANDROID_HANDLERS:
        what = "com.android.version tag" if md.get("android_version") is not None else f"track handler '{hv}'"
        ev.add(CAMERA, 12, f"written by Android's built-in recorder ({what}) - recorded on the phone, "
                           "not downloaded", "metadata")
        ev.add(SCREEN, 8, "Android built-in recorder is also used by screen recorders", "metadata")
        ev.add(DOWNLOAD, -5, "made on the device rather than downloaded", "metadata")
    if "core media" in hv_low:
        ev.add(CAMERA, 10, f"written by Apple Core Media ('{hv}') - iPhone camera or Apple app", "metadata")
    if "gopro" in hv_low:
        ev.add(CAMERA, 40, f"GoPro track handler ('{hv}')", "metadata")
    if hv_low in ("snap video", "snap audio") or (md.get("handler_audio") or "").strip().lower() in ("snap video", "snap audio"):
        ev.add(MESSAGING, 40, f"track handler '{hv or md.get('handler_audio')}' is written by the Snapchat app", "metadata")
    if "produced by google" in hv_low:
        ev.add(DOWNLOAD, 40, f"track handler '{hv}' is the YouTube/Google encoder signature", "metadata")
    if md.get("software") and str(md.get("make") or "").lower() == "apple":
        ev.add(CAMERA, 10, f"iOS version recorded ({md['software']})", "metadata")

    enc = str(md.get("encoder") or "")
    enc_low = enc.lower()
    ffmpeg_made = bool(re.match(r"^\s*lav[fc]", enc_low)) or (hv_low in FFMPEG_HANDLERS)
    if ffmpeg_made:
        src = f"encoder '{enc}'" if enc else f"track handler '{hv}'"
        ev.add(CAMERA, -20, f"{src} = processed with FFmpeg; phone cameras do not write this", "metadata")
        ev.add(SOCIAL, 10, f"{src}: FFmpeg-processed, typical of social-media apps", "metadata")
        ev.add(DOWNLOAD, 10, f"{src}: FFmpeg-processed, typical of downloaded/converted video", "metadata")
        ev.add(MESSAGING, 5, f"{src}: FFmpeg-processed", "metadata")
    if "handbrake" in enc_low:
        ev.add(CAMERA, -15, f"encoder '{enc}' (HandBrake re-encode)", "metadata")
        ev.add(DOWNLOAD, 10, f"encoder '{enc}' (converted on a computer)", "metadata")
    if re.match(r"^\s*byte(dance|vc|ve)", enc_low):
        ev.add(SOCIAL, 40, f"encoder '{enc}' is ByteDance's (TikTok) encoder", "metadata")
    if "google" in enc_low:
        ev.add(DOWNLOAD, 25, f"encoder '{enc}' (Google/YouTube)", "metadata")

    blob_parts = [str(md.get(k) or "") for k in ("comment", "description", "title", "encoder")]
    blob_parts += [f"{k}={v}" for k, v in (md.get("signature_tags") or {}).items()]
    blob = " ".join(blob_parts).lower()
    comment = str(md.get("comment") or "")
    if comment.strip().lower().startswith("vid:"):
        ev.add(SOCIAL, 60, f"comment tag '{comment[:40]}' is TikTok's video-id signature ('vid:...')", "metadata")
    sig = md.get("signature_tags") or {}
    if any("aigc" in k for k in sig) or "vid_md5" in sig:
        ev.add(SOCIAL, 50, "TikTok-specific metadata tag present (" + ", ".join(sorted(sig)[:3]) + ")", "metadata")
    if re.search(r"tiktok|douyin|bytedance", blob):
        ev.add(SOCIAL, 40, "metadata mentions TikTok/ByteDance", "metadata")
    for word, cat, why in (("instagram", SOCIAL, "Instagram"), ("snapchat", MESSAGING, "Snapchat"),
                           ("facebook", SOCIAL, "Facebook"), ("whatsapp", MESSAGING, "WhatsApp"),
                           ("telegram", MESSAGING, "Telegram"), ("capcut", MESSAGING, "CapCut editor"),
                           ("inshot", MESSAGING, "InShot editor"), ("kinemaster", MESSAGING, "KineMaster editor")):
        if word in blob:
            ev.add(cat, 35, f"metadata mentions {why}", "metadata")
    title = str(md.get("title") or "").strip()
    if title and title.lower() not in ("videohandle", "videohandler", "core media video") and len(title) > 3:
        ev.add(DOWNLOAD, 10, f"embedded title '{title[:60]}' - typical of published/downloaded media", "metadata")

    brand = (md.get("container") or {}).get("major_brand") or ""
    label = (md.get("container") or {}).get("label") or ""
    if (md.get("container") or {}).get("fragmented") or label.startswith("MP4 (fragmented"):
        ev.add(DOWNLOAD, 15, "fragmented/DASH MP4 - a streaming format", "technical")
        ev.add(SOCIAL, 5, "fragmented/DASH MP4 - a streaming format", "technical")
    if label.startswith("3GPP"):
        ev.add(CAMERA, 10, f"{label} container ('{brand.strip()}') - older phone camera format", "technical")
        ev.add(MESSAGING, 10, f"{label} container - also used for MMS video", "technical")


def _technical_evidence(md: dict, ev: _Evidence):
    v = md.get("video") or {}
    dw, dh = v.get("display_width"), v.get("display_height")
    rot = v.get("rotation") or 0
    if dw and dh:
        short, long_ = min(dw, dh), max(dw, dh)
        ratio = long_ / short if short else 0
        portrait = dh > dw
        if portrait and rot == 0 and 1.74 <= ratio <= 1.80:
            ev.add(SOCIAL, 15, f"vertical {dw}x{dh} frames stored natively without a rotation flag - typical of "
                               "social-media/app re-encodes", "technical")
            ev.add(DOWNLOAD, 5, "natively vertical frames (re-encoded)", "technical")
            ev.add(CAMERA, -10, "phone cameras store portrait video as landscape frames plus a rotation flag", "technical")
        if rot in (90, 270):
            ev.add(CAMERA, 8, f"rotation flag {rot} degrees - how phone cameras store portrait video", "technical")
        if (short, long_) in _SCREEN_SIZES:
            ev.add(SCREEN, 30, f"{dw}x{dh} matches a phone screen resolution, not a camera video mode", "technical")
        elif 1.95 <= ratio <= 2.25:
            ev.add(SCREEN, 20, f"{dw}x{dh} has a {ratio:.2f}:1 phone-screen aspect ratio (cameras use 16:9 or 4:3)",
                   "technical")
        if 0.98 <= ratio <= 1.02:
            ev.add(SOCIAL, 12, f"square {dw}x{dh} video - typical of Instagram-style posts", "technical")
        if short <= 480:
            ev.add(MESSAGING, 10, f"low resolution {dw}x{dh} - typical of messaging-app compression", "technical")
            ev.add(SOCIAL, 5, f"low resolution {dw}x{dh}", "technical")
    br = v.get("bit_rate") or md.get("bit_rate")
    w, h = v.get("width"), v.get("height")
    if br and w and h:
        fps = v.get("fps") or 30.0
        bpp = br / (w * h * max(fps, 1.0))
        codec = str(v.get("codec") or v.get("codec_tag") or "").lower()
        eff = bpp * (1.8 if codec in ("hevc", "h265", "hvc1", "hev1", "av1", "vp9") else 1.0)
        mbps = br / 1e6
        if eff >= 0.15:
            ev.add(CAMERA, 15, f"high bit rate ({mbps:.1f} Mbit/s, {bpp:.2f} bits/pixel) typical of original "
                               "camera recordings", "technical")
        elif eff <= 0.07:
            ev.add(CAMERA, -10, f"heavily compressed ({mbps:.1f} Mbit/s, {bpp:.3f} bits/pixel) - "
                                "original camera files are much larger", "technical")
            ev.add(SOCIAL, 10, f"heavily compressed ({mbps:.1f} Mbit/s) - typical of social media", "technical")
            ev.add(MESSAGING, 10, f"heavily compressed ({mbps:.1f} Mbit/s) - typical of messaging apps", "technical")
            ev.add(DOWNLOAD, 8, f"heavily compressed ({mbps:.1f} Mbit/s) - typical of streamed video", "technical")
    fps = v.get("fps")
    if fps and fps >= 59:
        ev.add(CAMERA, 8, f"{fps:.0f} fps high-frame-rate recording", "technical")
    duration = md.get("duration")
    if duration and duration > 20 * 60:
        ev.add(DOWNLOAD, 10, f"long duration ({duration / 60:.0f} min) - typical of downloaded programmes", "technical")
        ev.add(SOCIAL, -5, "long for short-form social video", "technical")
    if md.get("video") and not md.get("audio"):
        ev.add(SCREEN, 8, "no audio track - common for screen recordings", "technical")


def classify(rel_parts, filename: str, md: dict | None) -> dict:
    ev = _Evidence()
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    _path_evidence(tuple(rel_parts or ()), ev)
    _name_evidence(stem, ev)
    if md:
        _meta_evidence(md, ev)
        _technical_evidence(md, ev)

    scores = {c: 0 for c in C.CATEGORIES}
    positive = {c: 0 for c in C.CATEGORIES}
    for item in ev.items:
        scores[item["category"]] += item["weight"]
        if item["weight"] > 0:
            positive[item["category"]] += item["weight"]
    ranked = sorted(C.CATEGORIES, key=lambda c: (-scores[c], C.CATEGORIES.index(c)))
    top, second = ranked[0], ranked[1]
    top_score, margin = scores[top], scores[top] - max(scores[second], 0)

    conflicts = []
    for cat in C.CATEGORIES:
        if cat != top and positive[cat] >= 20:
            reasons = [i["reason"] for i in ev.items if i["category"] == cat and i["weight"] > 0][:2]
            conflicts.append(f"{positive[cat]} points of {cat} evidence ({'; '.join(reasons)})")

    if top_score < MIN_SCORE:
        classification, confidence = C.UNKNOWN, C.UNKNOWN_CONF
        lean = f"weak lean towards {top} ({top_score} points)" if top_score > 0 else "no usable evidence"
        conflicts.insert(0, f"Not enough evidence to classify: {lean}; minimum is {MIN_SCORE}.")
    else:
        classification = top
        if top_score >= HIGH_SCORE and margin >= HIGH_MARGIN:
            confidence = C.HIGH
        elif top_score >= MEDIUM_SCORE and margin >= MEDIUM_MARGIN:
            confidence = C.MEDIUM
        else:
            confidence = C.LOW
        strongest_other = max((positive[c] for c in C.CATEGORIES if c != top), default=0)
        if strongest_other >= CONFLICT_CAP_LOW and margin < 40:
            confidence = C.LOW
        elif strongest_other >= CONFLICT_CAP_MEDIUM and confidence == C.HIGH:
            confidence = C.MEDIUM

    order = sorted(ev.items, key=lambda i: (i["category"] != top, -abs(i["weight"])))
    text = " | ".join([f"note: {n}" for n in ev.notes]
                      + [f"{i['weight']:+d} {SHORT[i['category']]}: {i['reason']}" for i in order])
    return {
        "Classification": classification,
        "ClassificationConfidence": confidence,
        "ClassificationScore": top_score,
        "ClassificationRunnerUp": f"{second} ({scores[second]})",
        "ClassificationEvidence": text or "no evidence found",
        "ClassificationConflicts": " | ".join(conflicts),
        "EvidenceDetail": ev.items,
        "Scores": scores,
    }
