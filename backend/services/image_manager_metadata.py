"""Still-image header metadata shared by scanning and verified backup restore."""
from datetime import datetime, timezone
from contextlib import contextmanager
import struct
from PIL import Image, ImageFile, TiffImagePlugin, UnidentifiedImageError

FORMATS = {'JPEG', 'PNG', 'WEBP', 'BMP', 'TIFF', 'AVIF', 'GIF'}


class _LocalTiffImageFile(TiffImagePlugin.TiffImageFile):
    def load_prepare(self):
        # Uncompressed TIFF repeats the generic count veto during decoding.
        # Override only this local reader, preserving global upload safeguards.
        if self._im is None: self.im = Image.core.new(self.mode, self._tile_size)
        ImageFile.ImageFile.load_prepare(self)


@contextmanager
def open_local_image(path):
    """Open an explicitly selected local still image without a pixel-count veto.

    Use Pillow's registered, signature-checked format readers directly. This
    avoids Image.open's generic decompression-bomb count check without changing
    process-wide settings used by uploads or thumbnail workers. Header parsing
    stays lazy; corrupt files and decoder errors still fail normally.
    """
    Image.init()
    with open(path, 'rb') as stream:
        prefix = stream.read(16)
        image = None
        for name in Image.ID:
            if name not in FORMATS or name not in Image.OPEN: continue
            factory, accept = Image.OPEN[name]
            accepted = accept(prefix) if accept else True
            if not accepted or isinstance(accepted, str): continue
            if name == 'TIFF': factory = _LocalTiffImageFile
            stream.seek(0)
            try:
                image = factory(stream, str(path))
            except (SyntaxError, IndexError, TypeError, struct.error):
                continue
            break
        if image is None: raise UnidentifiedImageError('Cannot identify local image file.')
        try: yield image
        finally: image.close()


def signature(info):
    return [info.st_size, info.st_mtime_ns, info.st_dev, info.st_ino]


def image_metadata(path):
    info = path.stat()
    with open_local_image(path) as image:
        if image.format not in FORMATS or getattr(image, 'is_animated', False) or getattr(image, 'n_frames', 1) > 1:
            raise ValueError('Animated/multiple-frame media is excluded.')
        width, height = image.size
        orientation, captured = 1, None
        try:
            exif = image.getexif()
            orientation = exif.get(274, 1)
            dates = [exif.get(36867), exif.get_ifd(34665).get(36867), exif.get(306)]
            for value in dates:
                if isinstance(value, str):
                    try:
                        captured = datetime.strptime(value.rstrip('\x00'), '%Y:%m:%d %H:%M:%S').isoformat()
                        break
                    except ValueError:
                        continue
        except (ValueError, KeyError, TypeError, OSError, SyntaxError):
            pass
        if orientation in (5, 6, 7, 8):
            width, height = height, width
        return {'width': width, 'height': height, 'format': image.format,
                'date': captured or datetime.fromtimestamp(info.st_mtime, timezone.utc).isoformat(),
                'date_source': 'EXIF' if captured else 'File modified', 'signature': signature(info), 'bytes': info.st_size}
