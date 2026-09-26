"""Folder image conversion, sizing and stitching with the existing FFmpeg tools."""
from datetime import datetime
import json
from pathlib import Path
import re
import uuid

from . import frames, hashing, manifest

EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}
MAX_PIXELS = 64_000_000
MAX_IMAGES = 1000


def inspect(state, payload, progress, cancel):
    root = Path(str(payload.get('source', ''))).expanduser()
    if not root.is_absolute() or not root.is_dir():
        raise ValueError('Choose an existing absolute image folder path.')
    root = root.resolve()
    binary = frames.binaries()
    candidates = root.rglob('*') if payload.get('recursive') is True else root.iterdir()
    paths = []
    progress(phase='finding-images')
    for path in candidates:
        if cancel.is_set(): raise ValueError('Image inspection cancelled. Source files unchanged.')
        if path.suffix.lower() in EXTENSIONS and path.is_file() and '.media-manager-trash' not in path.parts:
            paths.append(path)
            if len(paths) > MAX_IMAGES: raise ValueError('Choose up to 1,000 images per batch, or turn off subfolders.')
    paths.sort(key=lambda p: str(p.relative_to(root)).casefold())
    if not paths: raise ValueError('No supported images found. Choose a folder of JPEG, PNG, WebP, BMP, or TIFF images.')
    records = []
    for i, path in enumerate(paths):
        if cancel.is_set(): raise ValueError('Image inspection cancelled. Source files unchanged.')
        if not path.resolve().is_relative_to(root): raise ValueError('An image links outside the chosen folder. Choose a folder without external links.')
        progress(phase='analyzing', completed=i, total=len(paths), currentFile=str(path))
        before = path.stat()
        result = frames.run_process([binary['ffprobe'], '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,codec_name', '-of', 'json', str(path)], cancel)
        streams = json.loads(result).get('streams', [])
        if not streams: raise ValueError('Could not read image: ' + path.name)
        stream = streams[0]; width, height = stream.get('width', 0), stream.get('height', 0)
        if not width or not height or width * height > MAX_PIXELS:
            raise ValueError('Choose images up to 64 megapixels: ' + path.name)
        sha, _ = hashing.sha256_file(str(path), stop_event=cancel)
        if (before.st_size, before.st_mtime_ns) != (path.stat().st_size, path.stat().st_mtime_ns):
            raise ValueError('An image changed while being inspected. Inspect again.')
        records.append(dict(path=str(path.resolve()), name=str(path.relative_to(root)), width=width, height=height,
                            size=before.st_size, mtime=before.st_mtime_ns, sha256=sha, codec=stream.get('codec_name')))
    info = dict(id=uuid.uuid4().hex, source=str(root), records=records, count=len(records))
    with state.lock:
        if len(state.image_batches) >= 12: state.image_batches.pop(next(iter(state.image_batches)))
        state.image_batches[info['id']] = info
    progress(phase='analyzing', completed=len(records), total=len(records))
    return dict(message=f'Read {len(records)} images. Choose output options.', imageBatch=info)


def options(info, payload):
    def integer(key, default, minimum, maximum):
        value = payload.get(key, default)
        if type(value) is not int or not minimum <= value <= maximum: raise ValueError(f'Choose a valid whole-number {key}.')
        return value
    output_format = payload.get('format', 'png')
    if output_format not in ('png', 'jpg', 'webp'): raise ValueError('Choose PNG, JPEG, or WebP.')
    standardize = payload.get('standardize') is True
    width = integer('width', 1024, 1, 16384); height = integer('height', 1024, 1, 16384)
    if standardize and width * height > MAX_PIXELS: raise ValueError('Choose a target up to 64 megapixels.')
    fit = payload.get('fit', 'contain')
    if fit not in ('contain', 'cover', 'stretch'): raise ValueError('Choose pad, crop, or stretch.')
    color = payload.get('background', '#ffffff')
    if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError('Choose a background color.')
    layout = payload.get('layout', 'none'); count = info['count']
    if layout not in ('none', 'vertical', 'horizontal', 'grid', 'gif'): raise ValueError('Choose a supported stitch layout.')
    columns = 1 if layout in ('vertical', 'gif') else count if layout == 'horizontal' else integer('columns', 1, 1, count)
    if layout != 'none' and not standardize: raise ValueError('Enable a common image size before stitching.')
    if layout == 'grid' and count % columns: raise ValueError('Grid columns must divide the image count evenly.')
    gap = integer('gap', 0, 0, 256); rows = 1 if layout == 'gif' else count // columns
    canvas_width, canvas_height = columns * width + max(0, columns-1) * gap, rows * height + max(0, rows-1) * gap
    if layout not in ('none', 'gif') and (canvas_width > 32768 or canvas_height > 32768 or canvas_width * canvas_height > MAX_PIXELS):
        raise ValueError('The stitched image exceeds 64 megapixels or 32,768 pixels on one edge. Reduce the tile size or batch size.')
    delay = integer('frameDelay', 100, 20, 10000)
    if delay % 10: raise ValueError('GIF frame delay must use increments of 10 milliseconds.')
    loop = integer('loop', 0, -1, 100)
    if layout == 'gif' and (width * height > 4_000_000 or width * height * count > 100_000_000):
        raise ValueError('Reduce GIF dimensions: maximum 4 megapixels per frame and 100 million pixels across all frames.')
    destination = Path(str(payload.get('destination', ''))).expanduser()
    if not destination.is_absolute(): raise ValueError('Choose an absolute output folder.')
    return dict(format=output_format, standardize=standardize, width=width, height=height, fit=fit, background=color,
                layout=layout, columns=columns, rows=rows, gap=gap, canvasWidth=canvas_width, canvasHeight=canvas_height,
                frameDelay=delay, loop=loop, reverse=payload.get('reverse') is True, destination=str(destination.resolve()))


def image_filter(settings):
    parts = ['format=rgba']
    if settings['standardize']:
        w, h = settings['width'], settings['height']; fit = settings['fit']; color = '0x' + settings['background'][1:]
        if fit == 'stretch': parts.append(f'scale={w}:{h}')
        elif fit == 'cover': parts.extend([f'scale={w}:{h}:force_original_aspect_ratio=increase', f'crop={w}:{h}'])
        else: parts.extend([f'scale={w}:{h}:force_original_aspect_ratio=decrease', f'pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={color}'])
    parts.append('setsar=1')
    return ','.join(parts)


def image_arguments(binary, source, target, filters, background):
    args = [binary, '-hide_banner', '-v', 'error', '-nostdin', '-n', '-i', str(source), '-frames:v', '1']
    if target.suffix == '.jpg':
        # Explicit background for transparent inputs, rather than silently making alpha black.
        filters += f',split[fg][bg];[bg]drawbox=c=0x{background[1:]}:t=fill:replace=1[solid];[solid][fg]overlay=format=auto,format=rgb24'
    args += ['-vf', filters, '-threads', '1']
    if target.suffix == '.jpg': args += ['-q:v', '2']
    if target.suffix == '.webp': args += ['-lossless', '1']
    args.append(str(target))
    return args


def execute(state, payload, progress, cancel):
    info = state.image_batches.get(payload.get('batchId'))
    if not info: raise ValueError('Inspect the image folder again before processing.')
    settings = options(info, payload); binary = frames.binaries()
    destination = Path(settings['destination']); destination.mkdir(parents=True, exist_ok=True)
    output = destination / f"images_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}"; output.mkdir()
    tiles = output / 'images'; tiles.mkdir()
    record = dict(source=info['source'], settings=settings, status='running', output=str(output), images=[])
    reports = state.reports / 'image-tools'; reports.mkdir(parents=True, exist_ok=True)
    def save():
        manifest.write_json(str(output / 'images.json'), record)
        manifest.write_json(str(reports / (output.name + '.json')), record)
    save()
    files = list(reversed(info['records'])) if settings['reverse'] else info['records']
    total = len(files) + int(settings['layout'] != 'none')
    try:
        for i, item in enumerate(files):
            if cancel.is_set(): raise ValueError('Image processing cancelled. Completed copies are retained.')
            source = Path(item['path']); before = source.stat()
            if (before.st_size, before.st_mtime_ns) != (item['size'], item['mtime']): raise ValueError('Source changed. Inspect again: ' + item['name'])
            progress(phase='processing', completed=i, total=total, currentFile=str(source))
            sha, _ = hashing.sha256_file(str(source), stop_event=cancel)
            if sha != item['sha256']: raise ValueError('Source content changed. Inspect again: ' + item['name'])
            target = tiles / f"image_{i+1:06d}.{settings['format']}"
            args = image_arguments(binary['ffmpeg'], source, target, image_filter(settings), settings['background'])
            frames.run_process(args, cancel)
            if (source.stat().st_size, source.stat().st_mtime_ns) != (item['size'], item['mtime']): raise ValueError('Source changed during processing: ' + item['name'])
            record['images'].append(dict(source=item, output=str(target))); save()
        if settings['layout'] == 'gif':
            progress(phase='processing', completed=len(files), total=total, currentFile='Creating animated GIF')
            animated = output / 'animated.gif'
            pattern = tiles / ('image_%06d.' + settings['format'])
            palette = 'split[frames][colors];[colors]palettegen=reserve_transparent=1[p];[frames][p]paletteuse=dither=sierra2_4a'
            args = [binary['ffmpeg'], '-hide_banner', '-v', 'error', '-nostdin', '-n',
                    '-framerate', f"1000/{settings['frameDelay']}", '-i', str(pattern),
                    '-filter_complex', palette, '-loop', str(settings['loop']),
                    '-final_delay', str(settings['frameDelay']//10), '-threads', '1', str(animated)]
            frames.run_process(args, cancel)
            record['animated'] = str(animated)
        elif settings['layout'] != 'none':
            progress(phase='processing', completed=len(files), total=total, currentFile='Stitching image copies')
            pattern = tiles / ('image_%06d.' + settings['format'])
            stitched = output / ('stitched.' + settings['format'])
            tile_filter = f"tile={settings['columns']}x{settings['rows']}:nb_frames={len(files)}:padding={settings['gap']}:color=0x{settings['background'][1:]}"
            args = [binary['ffmpeg'], '-hide_banner', '-v', 'error', '-nostdin', '-n', '-framerate', '1', '-i', str(pattern),
                    '-vf', tile_filter, '-frames:v', '1', '-threads', '1']
            if settings['format'] == 'jpg': args += ['-q:v', '2']
            if settings['format'] == 'webp': args += ['-lossless', '1']
            frames.run_process(args + [str(stitched)], cancel); record['stitched'] = str(stitched)
        record['status'] = 'complete'
        progress(phase='processing', completed=total, total=total)
    except Exception as exc:
        record.update(status='partial', error=str(exc)); raise
    finally: save()
    return dict(message=f"Created {len(record['images'])} image copies" + (' and an animated GIF.' if record.get('animated') else ' and a stitched image.' if record.get('stitched') else '.'),
                imageOutput=record, details=f"{output}\nSource images retained. images.json records image order and settings.")
