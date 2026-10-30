"""Bounded, in-memory previews; source authorization runs before every cache hit.

No originals are changed and no unencrypted preview sidecars are written.
"""
from collections import OrderedDict
from io import BytesIO
import hashlib
import threading
import warnings

from fastapi import HTTPException, Response
from PIL import Image, ImageOps

MAX_PIXELS = 40_000_000
MAX_BYTES = 64 * 1024 * 1024
CACHE_BYTES = 8 * 1024 * 1024
CACHE_ITEMS = 128
_cache = OrderedDict()
_cache_bytes = 0
_lock = threading.RLock()
_slots = threading.BoundedSemaphore(2)


def clear_cache():
    global _cache_bytes
    with _lock:
        _cache.clear()
        _cache_bytes = 0


def render(data, size=320):
    global _cache_bytes
    from services import image_vault
    if size not in (160, 320, 640):
        raise HTTPException(422, "Unsupported preview size")
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(422, "Image exceeds the preview byte limit")
    digest = hashlib.sha256(data).hexdigest()
    key = (digest, size)
    with _slots:
        # Check after waiting for a decoder slot: queued requests must respect
        # locks applied while earlier previews were being decoded.
        try:
            image_vault.require_public(digest)
        except image_vault.LockedImageError as error:
            raise HTTPException(403, "Image unavailable or locked") from error
        with _lock:
            cached = _cache.get(key)
            if cached:
                _cache.move_to_end(key)
                return cached
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(data)) as source:
                    if source.width * source.height > MAX_PIXELS:
                        raise ValueError("Image exceeds the preview pixel limit")
                    source.seek(0)  # Animated inputs have a stable first-frame preview.
                    source.draft("RGB", (size, size))
                    image = ImageOps.exif_transpose(source)
                    image.thumbnail((size, size), Image.Resampling.LANCZOS)
                    stream = BytesIO()
                    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                        image.convert("RGBA").save(stream, "PNG")
                        media_type = "image/png"
                    else:
                        image.convert("RGB").save(stream, "JPEG", quality=82)
                        media_type = "image/jpeg"
                    result = (stream.getvalue(), media_type)
        except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise HTTPException(422, "Could not decode an image preview") from error
        # A lock may be applied while decoding; do not publish those pixels.
        try:
            image_vault.require_public(digest)
        except image_vault.LockedImageError as error:
            raise HTTPException(403, "Image unavailable or locked") from error
        with _lock:
            while _cache and (len(_cache) >= CACHE_ITEMS or _cache_bytes + len(result[0]) > CACHE_BYTES):
                _, old = _cache.popitem(last=False)
                _cache_bytes -= len(old[0])
            if len(result[0]) <= CACHE_BYTES:
                previous = _cache.pop(key, None)
                if previous:
                    _cache_bytes -= len(previous[0])
                _cache[key] = result
                _cache_bytes += len(result[0])
        return result


def response(data, media_type, thumbnail=False):
    if thumbnail:
        data, media_type = render(data)
    return Response(data, media_type=media_type, headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


def path_response(path):
    from services.image_vault import LockedImageError
    try:
        with path.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            stream.seek(0)
            return file_preview(stream, digest)
    except LockedImageError as error:
        raise HTTPException(403, 'Image unavailable or locked') from error
    except (OSError, ValueError) as error:
        raise HTTPException(422, 'Could not decode an image preview') from error


def file_preview(stream, digest, size=320):
    """Authorized local originals use bounded previews, without byte-count gates."""
    from services.image_vault import require_public
    from services.image_manager_metadata import open_local_image, FORMATS
    key = (digest, size)
    with _slots:
        require_public(digest)
        with _lock:
            cached = _cache.get(key)
            if cached:
                _cache.move_to_end(key)
                return response(*cached)
        with open_local_image(stream, formats=FORMATS | {'ICO'}) as original:
            original.draft('RGB', (size, size))
            # Downsample before EXIF transpose/conversion to avoid full-size copies.
            original.thumbnail((size, size), Image.Resampling.LANCZOS)
            with ImageOps.exif_transpose(original) as image:
                output = BytesIO()
                with image.convert('RGBA') as rgba: rgba.save(output, 'PNG')
                result = (output.getvalue(), 'image/png')
        require_public(digest)
        global _cache_bytes
        with _lock:
            while _cache and (len(_cache) >= CACHE_ITEMS or _cache_bytes + len(result[0]) > CACHE_BYTES):
                _, old = _cache.popitem(last=False)
                _cache_bytes -= len(old[0])
            if len(result[0]) <= CACHE_BYTES:
                previous = _cache.pop(key, None)
                if previous: _cache_bytes -= len(previous[0])
                _cache[key] = result
                _cache_bytes += len(result[0])
        return response(*result)
