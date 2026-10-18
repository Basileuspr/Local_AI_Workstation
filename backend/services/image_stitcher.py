"""Ordered gallery PNGs with bounded canvas RAM and no selection/output budget."""
import base64
import hashlib
import io
import tempfile
import threading
from pathlib import Path

from PIL import Image, ImageOps

from services import image_library as library, image_vault as vault
from services.image_manager_canvas import DiskCanvas
from services.image_manager_layout import regular_sheet
from services.image_manager_metadata import open_local_image
from services.image_workflows import store

LOCK = threading.Lock()
BACKGROUNDS = {'dark': '#171b24', 'white': '#ffffff', 'transparent': '#00000000'}


def _sources(sources, directory):
    """Snapshot one authorized source at a time, releasing its bytes immediately."""
    inputs = []
    for number, source in enumerate(sources, 1):
        try:
            path = directory / f'{number}.source'
            if source['kind'] == 'library':
                stream, _ = library.image_stream(source.get('id'))
                try:
                    with path.open('xb') as output:
                        import shutil
                        shutil.copyfileobj(stream, output, 1024 * 1024)
                finally:
                    stream.close()
            else:
                data, _ = library.source_bytes(source)
                path.write_bytes(data)
                del data
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            vault.require_public(digest)
            with open_local_image(path) as original:
                original.verify()
            with open_local_image(path) as original:
                if getattr(original, 'n_frames', 1) != 1:
                    raise ValueError('Choose still images')
                width, height = original.size
                if original.getexif().get(274) in {5, 6, 7, 8}:
                    width, height = height, width
            inputs.append(dict(id=number, path=path, width=width, height=height, sha256=digest))
        except vault.LockedImageError:
            raise
        except (ValueError, KeyError, TypeError, OSError, store.NotFound, store.Conflict) as error:
            raise ValueError(f'Frame {number}: {error}') from error
    return inputs


def _render(inputs, sheet, background, directory, preview):
    scale = min(1, 1600 / max(sheet['width'], sheet['height']))
    display = Image.new('RGBA', (max(1, round(sheet['width'] * scale)), max(1, round(sheet['height'] * scale))), background)
    canvas = None
    try:
        if not preview:
            # Large canvases spill to disk instead of shrinking the saved image.
            canvas = (Image.new('RGBA', (sheet['width'], sheet['height']), background)
                      if sheet['width'] * sheet['height'] <= 4_000_000 else
                      DiskCanvas((sheet['width'], sheet['height']), background, directory, lambda: None))
        for item, placement in zip(inputs, sheet['placements']):
            vault.require_public(item['sha256'])
            with open_local_image(item['path']) as original:
                with ImageOps.exif_transpose(original) as oriented:
                    with oriented.convert('RGBA') as tile:
                        tile.thumbnail((placement['width'], placement['height']), Image.Resampling.LANCZOS)
                        x = placement['x'] + (placement['width'] - tile.width) // 2
                        y = placement['y'] + (placement['height'] - tile.height) // 2
                        if canvas is not None:
                            canvas.alpha_composite(tile, (x, y))
                        with tile.resize((max(1, round(tile.width * scale)), max(1, round(tile.height * scale))), Image.Resampling.LANCZOS) as small:
                            display.alpha_composite(small, (round(x * scale), round(y * scale)))
        for item in inputs:
            vault.require_public(item['sha256'])
        buffer = io.BytesIO()
        display.save(buffer, 'PNG')
        content = buffer.getvalue()
        if canvas is not None:
            path = directory / 'stitched.png'
            with path.open('xb') as stream:
                canvas.save(stream, format='PNG')
            return path, content
        return None, content
    finally:
        display.close()
        if canvas is not None:
            canvas.close()


def compose(sources, options, *, preview=False):
    with LOCK, tempfile.TemporaryDirectory(prefix='law-stitch-') as temporary:
        directory = Path(temporary)
        inputs = _sources(sources, directory)
        width = max(item['width'] for item in inputs)
        height = max(item['height'] for item in inputs)
        scale = min(1, options['tile_size'] / max(width, height)) if options['tile_size'] else 1
        sheet = regular_sheet(inputs, {
            'layout': {'row': 'horizontal', 'column': 'vertical', 'grid': 'grid'}[options['layout']],
            'width': max(1, int(width * scale)), 'height': max(1, int(height * scale)),
            'columns': options['columns'], 'gap': options['gap'], 'size_mode': 'exact', 'format': 'png',
        }, {'max_stitched_side': 2**31 - 1})  # PNG format boundary, not an application budget.
        path, content = _render(inputs, sheet, BACKGROUNDS[options['background']], directory, preview)
        result = {key: sheet[key] for key in ('width', 'height', 'columns', 'rows', 'reduced')}
        if preview:
            return {**result, 'preview': 'data:image/png;base64,' + base64.b64encode(content).decode('ascii')}
        return library.import_composite(path, content, sheet['width'], sheet['height'], {
            'kind': 'stitch', 'sources': sources, 'source_hashes': [item['sha256'] for item in inputs], 'options': options,
        })
