"""Create animations from uploaded still images without changing source files."""
import hashlib
import io
import re
import threading
import time

from PIL import Image, ImageOps, UnidentifiedImageError
from services import image_vault

MAX_FRAMES = 60
MAX_FILE_BYTES = 40 * 1024 * 1024
MAX_TOTAL_BYTES = 160 * 1024 * 1024
MAX_OUTPUT_PIXELS = 64_000_000


class GifProgress:
    def __init__(self):
        self.records = {}
        self.lock = threading.Lock()

    def start(self, request_id, total):
        with self.lock:
            now = time.monotonic()
            self.records = {key: value for key, value in self.records.items()
                            if value.get('finished') is None or now - value['finished'] < 300}
            if request_id in self.records:
                raise ValueError('This GIF request already exists. Start a new request.')
            if len(self.records) >= 64:
                completed = [key for key, value in self.records.items() if value.get('finished') is not None]
                if not completed:
                    raise ValueError('Too many GIF requests are running. Try again shortly.')
                del self.records[completed[0]]
            self.records[request_id] = dict(phase='Preparing frames', completed=0, total=total, started=now, finished=None)

    def update(self, request_id, phase, completed=None, total=None):
        with self.lock:
            if request_id in self.records:
                self.records[request_id].update(phase=phase, completed=completed, total=total)

    def begin(self, request_id, total):
        with self.lock:
            self.records[request_id].update(phase='Preparing frames', completed=0, total=total, started=time.monotonic())

    def finish(self, request_id, success):
        with self.lock:
            if request_id in self.records:
                self.records[request_id].update(phase='Ready' if success else 'Failed', finished=time.monotonic(),
                                                completed=1 if success else None, total=1 if success else None)

    def get(self, request_id):
        with self.lock:
            value = self.records.get(request_id)
            if not value or (value['finished'] is not None and time.monotonic() - value['finished'] >= 300):
                self.records.pop(request_id, None)
                return None
            return {key: value[key] for key in ('phase', 'completed', 'total')} | {
                'elapsed_seconds': round((value['finished'] or time.monotonic()) - value['started'], 1)}


progress = GifProgress()


def create(files, width=512, height=512, duration=200, loop=True, background="#ffffff", fit="cover", report=None):
    if not 2 <= len(files) <= MAX_FRAMES:
        raise ValueError("Choose between 2 and 60 still images.")
    if not (64 <= width <= 1024 and 64 <= height <= 1024):
        raise ValueError("GIF width and height must be between 64 and 1024 pixels.")
    if not 50 <= duration <= 2000 or duration % 10:
        raise ValueError("Frame time must be 50–2000 ms in steps of 10 ms.")
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", background):
        raise ValueError("Choose a valid background color.")
    if fit not in ("cover", "contain"):
        raise ValueError("Choose Fill frame or Fit whole image.")
    if width * height * len(files) > MAX_OUTPUT_PIXELS:
        raise ValueError("Reduce the output size or number of frames.")
    frames, hashes, total = [], [], 0
    report = report or (lambda *_: None)
    report('Preparing frames', 0, len(files))
    try:
        for upload in files:
            raw = upload.file.read(MAX_FILE_BYTES + 1)
            total += len(raw)
            if not raw or len(raw) > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                raise ValueError("Use images up to 40 MiB each and 160 MiB in total.")
            digest = hashlib.sha256(raw).hexdigest()
            image_vault.require_public(digest)
            hashes.append(digest)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in ("PNG", "JPEG", "WEBP") or getattr(source, "n_frames", 1) != 1:
                    raise ValueError("Choose still PNG, JPEG, or WebP images.")
                if source.width * source.height > 24_000_000:
                    raise ValueError("Each source image must be at most 24 megapixels.")
                with ImageOps.exif_transpose(source) as oriented:
                    rgba = oriented.convert("RGBA")
                # Both modes enlarge small inputs. Cover removes letterboxing
                # with a centered crop; contain preserves the entire image.
                fitted = (ImageOps.fit if fit == "cover" else ImageOps.contain)(rgba, (width, height), Image.Resampling.LANCZOS)
                rgba.close()
                rgba = fitted
                canvas = Image.new("RGB", (width, height), background)
                canvas.paste(rgba, ((width - rgba.width) // 2, (height - rgba.height) // 2), rgba)
                frames.append(canvas.quantize(colors=256))
                rgba.close()
                canvas.close()
            report('Preparing frames', len(frames), len(files))
        output = io.BytesIO()
        options = {"loop": 0} if loop else {}
        report('Encoding GIF', None, None)
        frames[0].save(output, format="GIF", save_all=True, append_images=frames[1:],
                       duration=duration, disposal=2, optimize=False, **options)
        # Recheck before releasing a derived file if privacy changed during encoding.
        for digest in hashes:
            image_vault.require_public(digest)
        data = output.getvalue()
        image_vault.require_public(hashlib.sha256(data).hexdigest())
        report('GIF encoded', len(frames), len(files))
        return data
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("One of the files could not be decoded as an image.") from exc
    finally:
        for frame in frames:
            frame.close()
