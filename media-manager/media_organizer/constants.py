"""Shared constants: categories, destination folder names, integrity statuses."""

MANIFEST_FORMAT = "media-organizer-manifest"
MANIFEST_VERSION = 1
OPLOG_FORMAT = "media-organizer-oplog"

# --- Media-origin categories -------------------------------------------------
CAMERA = "Camera Recording"
SOCIAL = "TikTok / Social Media"
SCREEN = "Screen Recording"
DOWNLOAD = "Downloaded Video"
MESSAGING = "Messaging/App Media"
UNKNOWN = "Unknown"

CATEGORIES = (CAMERA, SOCIAL, SCREEN, DOWNLOAD, MESSAGING)

# Folder names must be valid Windows names, so '/' becomes '-'.
CATEGORY_FOLDERS = {
    CAMERA: "Camera Recording",
    SOCIAL: "TikTok - Social Media",
    SCREEN: "Screen Recording",
    DOWNLOAD: "Downloaded Video",
    MESSAGING: "Messaging-App Media",
    UNKNOWN: "Unknown",
}

UNKNOWN_YEAR_FOLDER = "Unknown Year"
INVALID_FOLDER = "_Invalid or Unreadable"
DUPLICATES_FOLDER = "_Duplicates"
LOGS_FOLDER = "_Organizer Logs"

# --- Confidence levels -------------------------------------------------------
HIGH, MEDIUM, LOW, UNKNOWN_CONF = "High", "Medium", "Low", "Unknown"
CONFIDENCE_RANK = {UNKNOWN_CONF: 0, LOW: 1, MEDIUM: 2, HIGH: 3}

# --- Integrity statuses ------------------------------------------------------
OK = "OK"
OK_WARNINGS = "OK_WITH_WARNINGS"
AUDIO_ONLY = "AUDIO_ONLY"
NOT_MP4 = "NOT_MP4"
EMPTY = "EMPTY"
NO_MOOV = "NO_MOOV"
TRUNCATED = "TRUNCATED"
CORRUPT = "CORRUPT"
PROBE_FAILED = "PROBE_FAILED"
UNREADABLE = "UNREADABLE"
CLOUD_PLACEHOLDER = "CLOUD_PLACEHOLDER"

MOVABLE_STATUSES = frozenset({OK, OK_WARNINGS})
# Statuses for which the file could not be read at all (no hash -> never movable).
UNHASHABLE_STATUSES = frozenset({UNREADABLE, CLOUD_PLACEHOLDER})

STATUS_FOLDERS = {
    AUDIO_ONLY: "Audio Only (no video track)",
    NOT_MP4: "Not Actually MP4",
    EMPTY: "Empty File",
    NO_MOOV: "Incomplete Recording (no moov)",
    TRUNCATED: "Truncated",
    CORRUPT: "Corrupt Structure",
    PROBE_FAILED: "FFprobe Could Not Read",
}

STATUS_DESCRIPTIONS = {
    OK: "valid MP4 video",
    OK_WARNINGS: "valid video, with notes (see IntegrityNotes)",
    AUDIO_ONLY: "MP4 container without a video track",
    NOT_MP4: "content is not an MP4 container (renamed file)",
    EMPTY: "0-byte file",
    NO_MOOV: "no 'moov' header - interrupted/unfinished recording",
    TRUNCATED: "file ends before its declared data - incomplete copy",
    CORRUPT: "damaged container structure",
    PROBE_FAILED: "FFprobe could not open the file",
    UNREADABLE: "could not be read (permissions / I/O error)",
    CLOUD_PLACEHOLDER: "cloud placeholder (online-only), not downloaded",
}
