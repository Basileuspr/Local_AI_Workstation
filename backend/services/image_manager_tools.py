"""Copy-only image preparation and compilations; decode one source at a time."""
import csv
import hashlib
import json
import re
import uuid
from pathlib import Path

from PIL import Image, ImageChops, ImageOps
from . import image_manager_layout as layout
from .image_manager_metadata import open_local_image
from .image_manager_canvas import DiskCanvas, composite

LIMITS = json.loads(Path(__file__).with_name('image_manager_tools_limits.json').read_text(encoding='utf-8'))
DEFAULTS = dict(format='png', standardize=False, width=1024, height=1024,
                fit='contain', background='#ffffff', layout='none', columns=0,
                gap=0, frame_delay=100, loop=0, reverse=False, size_mode='exact',
                images_per_sheet=60, order='filename', shuffle_seed=1,
                trim_white=False, orientation_size=False, save_copies=True, name_prefix='')


def sources(manager, ids=None, *, folder_id='', recursive=True):
    ids = ids or []
    if bool(ids) == bool(folder_id) or len(set(ids)) != len(ids):
        raise ValueError('Choose distinct catalog images or one catalog folder.')
    query = 'SELECT i.*,f.path AS folder_path FROM images i JOIN folders f ON f.id=i.folder_id WHERE i.available=1 AND '
    records = []
    if folder_id: manager.folder(folder_id)
    with manager.database() as db:
        if folder_id:
            records = db.execute(query + 'i.folder_id=? AND i.hidden=0', [folder_id]).fetchall()
        else:
            # Avoid SQLite's variable limit without imposing a processing count cap.
            for offset in range(0, len(ids), 500):
                batch = ids[offset:offset + 500]
                records.extend(db.execute(query + 'i.id IN (' + ','.join('?' for _ in batch) + ')', batch).fetchall())
            if len(records) != len(ids): raise ValueError('A selected image is unavailable. Scan again.')
    images = [dict(row) | {'tags': json.loads(row['tags']), 'signature': json.loads(row['signature'])} for row in records]
    if folder_id and not recursive:
        images = [record for record in images if '/' not in record['relative'] and '\\' not in record['relative']]
    images.sort(key=lambda row: (row['relative'].casefold(), row['id']))
    return dict(images=images, total=len(images))


def validate(manager, payload):
    ids = payload.get('ids', [])
    records = sources(manager, ids)['images']
    if not records: raise ValueError('Choose available catalog images.')
    output, root = manager.folder(payload.get('output_id'))
    if output['purpose'] != 'output': raise ValueError('Choose a registered output folder for image copies.')
    options = DEFAULTS | dict(payload.get('image_options') or {})
    if set(options) != set(DEFAULTS): raise ValueError('Unknown image processing option.')
    for key, choices in [('format', ('png', 'jpg', 'webp')), ('fit', ('contain', 'cover', 'stretch')),
                         ('layout', ('none', 'vertical', 'horizontal', 'grid', 'balanced', 'gif')),
                         ('size_mode', ('exact', 'fit', 'pages')), ('order', ('filename', 'reverse', 'shuffle'))]:
        if options[key] not in choices: raise ValueError('Choose a supported format, fit, layout and order.')
    for key, minimum, maximum in [('width', 1, LIMITS['max_image_side']), ('height', 1, LIMITS['max_image_side']),
                                 ('columns', 0, LIMITS['max_stitched_side']), ('gap', 0, LIMITS['max_gap']),
                                 ('frame_delay', 20, 10000), ('loop', -1, 1000), ('shuffle_seed', 0, 2147483647)]:
        if type(options[key]) is not int or not minimum <= options[key] <= maximum:
            raise ValueError(f'Invalid {key.replace("_", " ")}.')
    if type(options['images_per_sheet']) is not int or options['images_per_sheet'] < 1:
        raise ValueError('Choose a positive whole-number sheet size.')
    for key in ('standardize', 'reverse', 'trim_white', 'orientation_size', 'save_copies'):
        if type(options[key]) is not bool: raise ValueError('Choose valid processing settings.')
    if not isinstance(options['background'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', options['background']):
        raise ValueError('Choose a background color.')
    if not isinstance(options['name_prefix'], str) or len(options['name_prefix']) > 80 or not re.fullmatch(r'[\w -]*', options['name_prefix']):
        raise ValueError('Use letters, numbers, spaces, underscores or hyphens for copy names.')
    options['name_prefix'] = options['name_prefix'].strip()
    if options['layout'] not in ('none', 'balanced') and not options['standardize']:
        raise ValueError('Enable a common image size for stitching or GIF creation.')
    if (options['standardize'] or options['layout'] not in ('none',)) and max(options['width'], options['height']) > layout.output_side(options, LIMITS):
        raise ValueError('Requested dimensions exceed this format\'s edge limit. Choose PNG or smaller dimensions.')
    if options['orientation_size'] and options['layout'] != 'none':
        raise ValueError('Orientation-based 1080p sizing is for individual copies. Use common dimensions for compilations.')
    if options['orientation_size'] and options['fit'] != 'contain':
        raise ValueError('Orientation-based copies preserve whole images. Choose Pad.')
    if options['layout'] == 'balanced' and (options['gap'] or options['fit'] != 'contain'):
        raise ValueError('Full fill preserves whole images and uses no gaps. Choose Pad and a zero gap.')
    if options['layout'] == 'none' and not options['save_copies']:
        raise ValueError('Enable individual copies or choose a compilation layout.')
    if options['layout'] in ('grid', 'balanced') and options['columns'] > len(records):
        raise ValueError('Choose no more columns than images, or use Auto.')
    if options['layout'] == 'gif' and len(ids) * options['width'] * options['height'] * 4 > LIMITS['max_gif_bytes']:
        raise ValueError('GIF frames exceed the memory limit. Use fewer images or smaller dimensions.')
    checked_folders = set()
    for record in records:
        if record['folder_path'] not in checked_folders:
            source = Path(record['folder_path'])
            if root.is_relative_to(source) or source.is_relative_to(root):
                raise ValueError('Choose an output folder outside the source folder trees.')
            checked_folders.add(record['folder_path'])
        check_source(record, guard=False)
        if options['save_copies'] and not options['standardize'] and not options['orientation_size'] and max(record['width'], record['height']) > layout.output_side(options, LIMITS):
            raise ValueError('An unscaled copy exceeds this format\'s edge limit. Choose PNG or resize individual copies.')
    layout.plan(layout.ordered(records, options), options, LIMITS)
    return options


def trim_white(image):
    """Trim only near-white outer rows/columns; retain wholly white images."""
    rgb = image.convert('RGB')
    try:
        channels = rgb.split()
        try:
            intermediate = ImageChops.darker(channels[0], channels[1])
            try: minimum = ImageChops.darker(intermediate, channels[2])
            finally: intermediate.close()
            try:
                mask = minimum.point([255 if value < 245 else 0 for value in range(256)])
                try: box = mask.getbbox()
                finally: mask.close()
            finally: minimum.close()
        finally:
            for channel in channels: channel.close()
        # Integer box + nearest sampling trims without Pillow's generic crop
        # pixel-count veto on explicitly selected large local images.
        return image.resize((box[2] - box[0], box[3] - box[1]), Image.Resampling.NEAREST, box=box) if box else image.copy()
    finally: rgb.close()


def check_source(record, *, guard=True):
    from .image_manager import no_links, signature
    from .image_vault import guard_path
    root = no_links(Path(record['folder_path']))
    source = no_links(root / record['relative'])
    if not source.is_relative_to(root) or not source.is_file() or signature(source.stat()) != record['signature']:
        raise ValueError('A source changed during processing. Scan again.')
    if guard: guard_path(source)
    return source


def read_image(manager, record, options):
    from .image_manager import signature
    from .image_vault import guard_path
    source = check_source(record)
    with open_local_image(source) as original:
        if getattr(original, 'n_frames', 1) != 1: raise ValueError('A source became animated or multipage. Scan again.')
        ImageOps.exif_transpose(original, in_place=True)
        image = original.convert('RGBA')
        image.info.clear()
    if signature(source.stat()) != record['signature']:
        image.close(); raise ValueError('A source changed during processing. Scan again.')
    if options['trim_white']:
        trimmed = trim_white(image); image.close(); image = trimmed
    return image


def resize(image, size, options):
    if options['fit'] == 'cover': return ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)
    if options['fit'] == 'stretch': return image.resize(size, Image.Resampling.LANCZOS)
    scale = min(size[0] / image.width, size[1] / image.height)
    fitted = (max(1, min(size[0], round(image.width * scale))), max(1, min(size[1], round(image.height * scale))))
    content = image.resize(fitted, Image.Resampling.LANCZOS)
    if fitted == size: return content
    padded = Image.new('RGBA', size, options['background'])
    try: padded.paste(content, (round((size[0] - fitted[0]) / 2), round((size[1] - fitted[1]) / 2)))
    finally: content.close()
    return padded


def execute(manager, payload):
    from .image_manager import no_links, image_metadata, now, Stopped
    from .image_vault import guard_path
    options = validate(manager, payload)
    _, root = manager.folder(payload['output_id'])
    records = layout.ordered(sources(manager, payload['ids'])['images'], options)
    # Trimming changes aspect ratios, so full-fill geometry uses actual trimmed sizes.
    measured = [dict(record) for record in records]
    if options['trim_white'] and options['layout'] == 'balanced':
        for index, record in enumerate(measured):
            manager._check(); manager._progress(total=len(records), current=index, message='Measuring trimmed images…')
            image = read_image(manager, record, options)
            try: record.update(width=image.width, height=image.height)
            finally: image.close()
    sheets = layout.plan(measured, options, LIMITS)
    by_id = {record['id']: record for record in records}
    output = no_links(root / ('Image_Tools_' + uuid.uuid4().hex[:12])); output.mkdir(exist_ok=False)
    receipt = dict(id=uuid.uuid4().hex, kind='image-tools', mode='image tools', status='running', started=now(), output=str(output), entries=[], options=options)
    manager._receipt(receipt)
    result = dict(output=str(output), images=[], stitched=None, sheets=[], animated=None, receipt_id=receipt['id'], report=str(output / 'dimensions.csv'))
    frames, processed = [], 0

    def save(image, target, source_ids, *, animated=False):
        manager._check(); no_links(target)
        for identifier in source_ids: check_source(by_id[identifier])
        temporary = no_links(target.with_name('.' + uuid.uuid4().hex + '.part'))
        try:
            with temporary.open('xb') as stream:
                if animated:
                    settings = dict(format='GIF', save_all=True, append_images=frames[1:], duration=options['frame_delay'], disposal=2)
                    if options['loop'] >= 0: settings['loop'] = options['loop']
                    image.save(stream, **settings)
                elif options['format'] == 'jpg':
                    flattened = Image.new('RGB', image.size, options['background']); flattened.paste(image, mask=image.getchannel('A'))
                    try: flattened.save(stream, format='JPEG', quality=92)
                    finally: flattened.close()
                else:
                    image.save(stream, format='PNG' if options['format'] == 'png' else 'WEBP', **({'lossless': True} if options['format'] == 'webp' else {}))
            with open_local_image(temporary) as verified: verified.verify()
            manager._check()
            for identifier in source_ids: check_source(by_id[identifier])
            temporary.rename(target)
        except BaseException:
            if temporary.exists(): temporary.unlink()
            raise
        identifier = None
        if not animated:
            with manager.database() as db:
                identifier = manager._upsert(db, payload['output_id'], str(target.relative_to(root)), target, image_metadata(target), now())
        digest = hashlib.sha256()
        with target.open('rb') as stream:
            while chunk := stream.read(1024 * 1024): digest.update(chunk)
        receipt['entries'].append(dict(source='; '.join(by_id[id]['relative'] for id in source_ids), target=str(target), sha256=digest.hexdigest(), status='created copy'))
        manager._receipt(receipt)
        return dict(id=identifier, path=str(target), width=image.width, height=image.height)

    def cell(value):
        value = str(value)
        return "'" + value if value.startswith(('=', '+', '-', '@', '\t', '\r')) else value

    try:
        manager._progress(total=len(records), current=0, message=f'Processing {len(records)} images…')
        with (output / 'dimensions.csv').open('x', newline='', encoding='utf-8-sig') as report:
            writer = csv.writer(report); writer.writerow(['Order', 'Source', 'Source width', 'Source height', 'Prepared width', 'Prepared height', 'Copy', 'Copy width', 'Copy height', 'Sheet', 'X', 'Y', 'Tile width', 'Tile height'])
            # A canvas exists only for the current sheet; sources close individually.
            batches = sheets or [dict(placements=[dict(id=record['id']) for record in records])]
            for page_index, sheet in enumerate(batches):
                if sheets:
                    size = (sheet['width'], sheet['height'])
                    manager._progress(message=f'Preparing sheet {page_index + 1} of {len(sheets)} · {size[0]} × {size[1]} pixels…')
                    canvas = DiskCanvas(size, options['background'], output, manager._check) if options['format'] == 'png' and size[0] * size[1] > LIMITS['fit_canvas_pixels'] else Image.new('RGBA', size, options['background'])
                else: canvas = None
                try:
                    for placement in sheet['placements']:
                        manager._check(); record = by_id[placement['id']]
                        image = read_image(manager, record, options)
                        try:
                            copy = None
                            if options['save_copies']:
                                size = ((1080, 1920) if image.height > image.width else (1920, 1080)) if options['orientation_size'] else (options['width'], options['height']) if options['standardize'] else image.size
                                prepared = resize(image, size, options) if size != image.size else image.copy()
                                try:
                                    name = f'{options["name_prefix"]}_{processed + 1:04d}' if options['name_prefix'] else f'{processed + 1:04d}-{Path(record["relative"]).stem[:180]}'
                                    copy = save(prepared, output / f'{name}.{options["format"]}', [record['id']]); result['images'].append(copy)
                                finally: prepared.close()
                            if canvas is not None:
                                size = (placement['width'], placement['height'])
                                tile = image.resize(size, Image.Resampling.LANCZOS) if options['layout'] == 'balanced' else resize(image, size, options)
                                try: composite(canvas, tile, (placement['x'], placement['y']))
                                finally: tile.close()
                            if options['layout'] == 'gif':
                                tile = resize(image, (options['width'], options['height']), options)
                                try:
                                    frame = Image.new('RGB', tile.size, options['background']); frame.paste(tile, mask=tile.getchannel('A')); frames.append(frame)
                                finally: tile.close()
                            check_source(record)
                            writer.writerow([processed + 1, cell(record['relative']), record['width'], record['height'], image.width, image.height, Path(copy['path']).name if copy else '', copy['width'] if copy else '', copy['height'] if copy else '', page_index + 1 if sheets else '', *[placement.get(key, '') for key in ('x', 'y', 'width', 'height')]])
                            report.flush(); processed += 1
                            manager._progress(current=processed, message=f'{processed} of {len(records)} images processed' + (f' · sheet {page_index + 1} of {len(sheets)}' if sheets else '') + '.')
                        finally: image.close()
                    if canvas is not None:
                        manager._progress(message=f'Saving sheet {page_index + 1} of {len(sheets)} · {canvas.width} × {canvas.height} pixels…')
                        filename = 'stitched.' + options['format'] if len(sheets) == 1 else f'sheet-{page_index + 1:04d}.{options["format"]}'
                        saved = save(canvas, output / filename, [item['id'] for item in sheet['placements']])
                        result['sheets'].append(saved)
                        if len(sheets) == 1: result['stitched'] = saved
                finally:
                    if canvas is not None: canvas.close()
            if frames: result['animated'] = save(frames[0], output / 'animation.gif', [record['id'] for record in records], animated=True)
        receipt['status'] = 'complete'
        return result
    except Exception as error:
        receipt['status'] = 'stopped' if isinstance(error, Stopped) else 'failed'; receipt['error'] = str(error)
        raise
    finally:
        receipt['finished'] = now(); manager._receipt(receipt)
        for frame in frames: frame.close()
