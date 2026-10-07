"""Disk-backed RGBA compilations and incremental PNG output."""
import struct
import tempfile
import zlib

from PIL import Image, ImageColor


class DiskCanvas:
    """Keep the full canvas on disk; composite and encode bounded strips.

    TemporaryFile uses exclusive creation and removes the raw canvas on close,
    including stop/failure. No mmap or whole-canvas pixel allocation is needed.
    """
    def __init__(self, size, background, directory, check):
        self.size = size
        self.width, self.height = size
        self.check = check
        self.raw = tempfile.TemporaryFile(dir=directory)
        try:
            color = bytes(ImageColor.getcolor(background, 'RGBA'))
            chunk = color * (256 * 1024)
            remaining = self.width * self.height * 4
            while remaining:
                check()
                length = min(remaining, len(chunk))
                self.raw.write(chunk[:length]); remaining -= length
        except BaseException:
            self.close()
            raise

    def alpha_composite(self, image, position):
        x, y = position
        if x < 0 or y < 0 or x + image.width > self.width or y + image.height > self.height:
            raise ValueError('Image placement exceeds the canvas.')
        # Horizontal strips also bound memory for very wide tiles.
        for row in range(image.height):
            for column in range(0, image.width, 16384):
                self.check()
                length = min(16384, image.width - column)
                offset = ((y + row) * self.width + x + column) * 4
                self.raw.seek(offset)
                with Image.frombytes('RGBA', (length, 1), self.raw.read(length * 4)) as base:
                    with image.resize((length, 1), Image.Resampling.NEAREST, box=(column, row, column + length, row + 1)) as tile:
                        base.alpha_composite(tile)
                    self.raw.seek(offset); self.raw.write(base.tobytes())

    @staticmethod
    def _chunk(stream, kind, data):
        stream.write(struct.pack('>I', len(data)))
        stream.write(kind); stream.write(data)
        stream.write(struct.pack('>I', zlib.crc32(data, zlib.crc32(kind)) & 0xffffffff))

    def save(self, stream, *, format):
        if format != 'PNG': raise ValueError('Disk-backed canvas output requires PNG.')
        stream.write(b'\x89PNG\r\n\x1a\n')
        self._chunk(stream, b'IHDR', struct.pack('>IIBBBBB', self.width, self.height, 8, 6, 0, 0, 0))
        compressor = zlib.compressobj()
        self.raw.seek(0)

        def compress(data):
            value = compressor.compress(data)
            if value: self._chunk(stream, b'IDAT', value)

        for _ in range(self.height):
            self.check(); compress(b'\x00')  # PNG filter None; RGBA pixels follow.
            remaining = self.width * 4
            while remaining:
                self.check()
                data = self.raw.read(min(65536, remaining))
                if not data: raise OSError('Incomplete temporary canvas.')
                compress(data); remaining -= len(data)
        self._chunk(stream, b'IDAT', compressor.flush())
        self._chunk(stream, b'IEND', b'')

    def close(self):
        self.raw.close()


def composite(canvas, tile, position):
    """Compose known local pixels without Image.crop's generic count guard."""
    if isinstance(canvas, DiskCanvas):
        canvas.alpha_composite(tile, position)
        return
    x, y = position
    strip_height = max(1, 1024 * 1024 // tile.width)
    for row in range(0, tile.height, strip_height):
        height = min(strip_height, tile.height - row)
        with canvas.resize((tile.width, height), Image.Resampling.NEAREST, box=(x, y + row, x + tile.width, y + row + height)) as base:
            with tile.resize((tile.width, height), Image.Resampling.NEAREST, box=(0, row, tile.width, row + height)) as overlay:
                with Image.alpha_composite(base, overlay) as combined:
                    canvas.paste(combined, (x, y + row))
