"""Tiny ISO-BMFF writer for unit tests: structurally valid MP4 boxes, dummy media data.

The files it produces are NOT playable (mdat is zero-filled), but their
container structure is exactly what the built-in parser reads.
"""
from __future__ import annotations

import struct
from datetime import datetime, timezone

MP4_EPOCH = datetime(1904, 1, 1, tzinfo=timezone.utc)
IDENTITY = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]
ROTATE_90 = [0, 0x00010000, 0, -0x00010000, 0, 0, 0, 0, 0x40000000]


def box(btype: bytes, payload: bytes = b"") -> bytes:
    return struct.pack(">I", 8 + len(payload)) + btype + payload


def full(btype: bytes, payload: bytes, version: int = 0, flags: int = 0) -> bytes:
    return box(btype, bytes([version]) + flags.to_bytes(3, "big") + payload)


def mp4_seconds(dt: datetime | None) -> int:
    if dt is None:
        return 0
    return int((dt - MP4_EPOCH).total_seconds())


def ftyp(major=b"isom", minor=512, compat=(b"isom", b"iso2", b"avc1", b"mp41")) -> bytes:
    return box(b"ftyp", major + struct.pack(">I", minor) + b"".join(compat))


def mvhd(created=0, modified=0, timescale=1000, duration=3000) -> bytes:
    body = struct.pack(">IIII", created, modified, timescale, duration)
    body += struct.pack(">IH", 0x00010000, 0x0100) + b"\0" * 10
    body += struct.pack(">9i", *IDENTITY) + b"\0" * 24 + struct.pack(">I", 3)
    return full(b"mvhd", body)


def tkhd(track_id, width, height, created=0, matrix=IDENTITY, duration=3000) -> bytes:
    body = struct.pack(">IIIII", created, created, track_id, 0, duration) + b"\0" * 8
    body += struct.pack(">hhhH", 0, 0, 0, 0) + struct.pack(">9i", *matrix)
    body += struct.pack(">II", int(width * 65536), int(height * 65536))
    return full(b"tkhd", body, flags=3)


def mdhd(created=0, timescale=30000, duration=90000) -> bytes:
    return full(b"mdhd", struct.pack(">IIIIHH", created, created, timescale, duration, 0x55C4, 0))


def hdlr(handler: bytes, name: str) -> bytes:
    return full(b"hdlr", b"\0" * 4 + handler + b"\0" * 12 + name.encode() + b"\0")


def stsd_video(fourcc=b"avc1", width=1920, height=1080) -> bytes:
    entry = b"\0" * 6 + struct.pack(">H", 1) + b"\0" * 16 + struct.pack(">HH", width, height)
    entry += struct.pack(">IIIH", 0x00480000, 0x00480000, 0, 1) + b"\0" * 32 + struct.pack(">Hh", 0x18, -1)
    return full(b"stsd", struct.pack(">I", 1) + box(fourcc, entry))


def stsd_audio(fourcc=b"mp4a", channels=2, rate=48000) -> bytes:
    entry = b"\0" * 6 + struct.pack(">H", 1) + struct.pack(">HHIHHhHI", 0, 0, 0, channels, 16, 0, 0, rate << 16)
    return full(b"stsd", struct.pack(">I", 1) + box(fourcc, entry))


def stbl(stsd: bytes, samples: int, delta: int, sample_size: int, chunk_offset: int) -> bytes:
    stts = full(b"stts", struct.pack(">III", 1, samples, delta))
    stsz = full(b"stsz", struct.pack(">II", sample_size, samples))
    stco = full(b"stco", struct.pack(">II", 1, chunk_offset))
    return box(b"stbl", stsd + stts + stsz + stco)


def video_trak(width=1920, height=1080, created=0, matrix=IDENTITY, handler_name="VideoHandle",
               fourcc=b"avc1", samples=90, sample_size=60000, chunk_offset=48) -> bytes:
    minf = box(b"minf", stbl(stsd_video(fourcc, width, height), samples, 1000, sample_size, chunk_offset))
    mdia = box(b"mdia", mdhd(created, 30000, samples * 1000) + hdlr(b"vide", handler_name) + minf)
    return box(b"trak", tkhd(1, width, height, created, matrix) + mdia)


def audio_trak(created=0, handler_name="SoundHandle", chunk_offset=48) -> bytes:
    minf = box(b"minf", stbl(stsd_audio(), 141, 1024, 400, chunk_offset))
    mdia = box(b"mdia", mdhd(created, 48000, 144000) + hdlr(b"soun", handler_name) + minf)
    return box(b"trak", tkhd(2, 0, 0, created) + mdia)


def udta_text(btype: bytes, text: str) -> bytes:
    raw = text.encode("utf-8")
    return box(btype, struct.pack(">HH", len(raw), 0x15C7) + raw)


def mdta_meta(items: dict) -> bytes:
    """QuickTime 'meta' with mdta keys (as written by Android and Apple devices)."""
    keys, ilst = b"", b""
    for i, (k, v) in enumerate(items.items(), 1):
        keys += struct.pack(">I", 8 + len(k.encode())) + b"mdta" + k.encode()
        if isinstance(v, float):
            data = struct.pack(">II", 23, 0) + struct.pack(">f", v)
        else:
            data = struct.pack(">II", 1, 0) + str(v).encode()
        ilst += box(struct.pack(">I", i), box(b"data", data))
    return box(b"meta", hdlr(b"mdta", "") + full(b"keys", struct.pack(">I", len(items)) + keys) + box(b"ilst", ilst))


def itunes_udta(tags: dict) -> bytes:
    """udta/meta/ilst in iTunes style (as written by FFmpeg for MP4)."""
    ilst = b""
    for code, value in tags.items():
        ilst += box(code, box(b"data", struct.pack(">II", 1, 0) + value.encode()))
    meta = full(b"meta", hdlr(b"mdir", "") + box(b"ilst", ilst))
    return box(b"udta", meta)


def build(created: datetime | None = None, width=1920, height=1080, matrix=IDENTITY, handler_name="VideoHandle",
          udta: bytes = b"", meta: bytes = b"", audio=True, major=b"isom", mdat_size=4096,
          moov_first=False, include_video=True) -> bytes:
    secs = mp4_seconds(created)
    head = ftyp(major)
    offset_guess = len(head) + 8

    def moov(chunk_offset):
        tracks = b""
        if include_video:
            tracks += video_trak(width, height, secs, matrix, handler_name, chunk_offset=chunk_offset)
        if audio:
            tracks += audio_trak(secs, chunk_offset=chunk_offset)
        return box(b"moov", mvhd(secs, secs) + tracks + udta + meta)

    mdat = box(b"mdat", b"\0" * mdat_size)
    if moov_first:
        m = moov(0)
        m = moov(len(head) + len(m) + 8)
        return head + m + mdat
    return head + mdat + moov(offset_guess)
