"""On-demand JPEG previews in bounded memory; never create media sidecars."""
from collections import OrderedDict
from io import BytesIO
import threading
import warnings

from PIL import Image, ImageOps

MAX_PIXELS = 40_000_000
MAX_SOURCE_BYTES = 256 * 1024 * 1024
CACHE_BYTES = 24 * 1024 * 1024
CACHE_ITEMS = 128


class PreviewCache:
    def __init__(self, *, max_bytes=CACHE_BYTES, max_items=CACHE_ITEMS):
        self.max_bytes = max_bytes
        self.max_items = max_items
        self.entries = OrderedDict()
        self.bytes = 0
        self.lock = threading.Lock()

    def get(self, manager, identifier, size):
        if size not in (320, 1280):
            raise ValueError('Unsupported Image Manager preview size.')
        # Authorize/validate even hits: changed, forgotten or missing originals
        # must not stay accessible through cached pixels.
        record, source = manager.image_path(identifier)
        key = (identifier, tuple(record['signature']), size)
        if record['width'] * record['height'] > MAX_PIXELS or record['bytes'] > MAX_SOURCE_BYTES:
            raise ValueError('This image exceeds the preview limit (40 megapixels / 256 MiB).')
        def revalidate():
            current, path = manager.image_path(identifier)
            if path != source or current['signature'] != record['signature']:
                raise ValueError('The image changed while reading its preview. Refresh and try again.')
        with manager.preview_slots:
            revalidate()
            with self.lock:
                cached = self.entries.get(key)
                if cached is not None:
                    self.entries.move_to_end(key)
                    return cached
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(source) as original:
                    if original.width * original.height > MAX_PIXELS:
                        raise ValueError('This image exceeds the preview pixel limit.')
                    original.draft('RGB', (size, size))
                    with ImageOps.exif_transpose(original) as image:
                        image.thumbnail((size, size))
                        output = BytesIO()
                        with Image.new('RGB', image.size, '#161e29') as canvas:
                            if image.mode in ('RGBA', 'LA') or 'transparency' in image.info:
                                with image.convert('RGBA') as rgba, rgba.getchannel('A') as mask:
                                    canvas.paste(rgba, mask=mask)
                            else:
                                canvas.paste(image)
                            canvas.save(output, 'JPEG', quality=84)
                        result = output.getvalue()
            revalidate()
            with self.lock:
                previous = self.entries.pop(key, None)
                if previous is not None:
                    self.bytes -= len(previous)
                while self.entries and (len(self.entries) >= self.max_items or self.bytes + len(result) > self.max_bytes):
                    _, discarded = self.entries.popitem(last=False)
                    self.bytes -= len(discarded)
                if self.max_items > 0 and len(result) <= self.max_bytes:
                    self.entries[key] = result
                    self.bytes += len(result)
            return result
