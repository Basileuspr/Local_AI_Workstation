"""Still-image copies, sizing, stitching and GIF export, independent of motion media."""
import hashlib
import json
import math
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps


def sources(manager, ids):
    if not ids or len(ids) > 1000 or len(set(ids)) != len(ids):
        raise ValueError('Choose 1–1,000 distinct catalog images.')
    with manager.database() as db:
        records = db.execute('SELECT i.*,f.path AS folder_path FROM images i JOIN folders f ON f.id=i.folder_id WHERE i.available=1 AND i.id IN (' + ','.join('?' for _ in ids) + ') ORDER BY i.relative COLLATE NOCASE,i.id', ids).fetchall()
    if len(records) != len(ids): raise ValueError('A selected image is unavailable. Scan again.')
    return dict(images=[dict(row) | {'tags': json.loads(row['tags']), 'signature': json.loads(row['signature'])} for row in records], total=len(records))


def validate(manager, payload):
    ids = payload.get('ids', [])
    if not ids or len(ids) > 1000 or len(set(ids)) != len(ids):
        raise ValueError('Choose 1–1,000 distinct catalog images.')
    output, root = manager.folder(payload.get('output_id'))
    if output['purpose'] != 'output':
        raise ValueError('Choose a registered output folder for image copies.')
    options = dict(payload.get('image_options') or {})
    options = dict(format='png', standardize=False, width=1024, height=1024,
                   fit='contain', background='#ffffff', layout='none', columns=1,
                   gap=0, frame_delay=100, loop=0, reverse=False) | options
    if options['format'] not in ('png', 'jpg', 'webp') or options['fit'] not in ('contain', 'cover', 'stretch') or options['layout'] not in ('none', 'vertical', 'horizontal', 'grid', 'gif'):
        raise ValueError('Choose a supported format, fit and layout.')
    for key, minimum, maximum in [('width', 1, 16384), ('height', 1, 16384), ('columns', 1, 1000), ('gap', 0, 256), ('frame_delay', 20, 10000), ('loop', -1, 1000)]:
        if type(options[key]) is not int or not minimum <= options[key] <= maximum:
            raise ValueError(f'Invalid {key.replace("_", " ")}.')
    if type(options['standardize']) is not bool or type(options['reverse']) is not bool or not re.fullmatch(r'#[0-9a-fA-F]{6}', options['background']):
        raise ValueError('Choose valid sizing, order and background settings.')
    if options['layout'] != 'none' and not options['standardize']:
        raise ValueError('Enable a common image size for stitching or GIF creation.')
    if options['width'] * options['height'] > 24_000_000:
        raise ValueError('Individual output images support up to 24 megapixels.')
    if options['layout'] == 'grid' and len(ids) % options['columns']:
        raise ValueError('Choose a grid column count that divides the image count.')
    if options['layout'] in ('grid', 'horizontal', 'vertical'):
        cols = len(ids) if options['layout'] == 'horizontal' else 1 if options['layout'] == 'vertical' else options['columns']
        rows = math.ceil(len(ids) / cols)
        width = cols * options['width'] + (cols - 1) * options['gap']
        height = rows * options['height'] + (rows - 1) * options['gap']
        if width * height > 64_000_000 or max(width, height) > 65535:
            raise ValueError('The stitched image exceeds 64 megapixels or 65,535 pixels per side. Choose smaller dimensions.')
    if options['layout'] == 'gif' and len(ids) * options['width'] * options['height'] * 4 > 128 * 1024 * 1024:
        raise ValueError('GIF frames exceed the memory limit. Use fewer images or smaller dimensions.')
    for identifier in ids:
        record, _ = manager.image_path(identifier)
        source = Path(record['folder_path'])
        if root.is_relative_to(source) or source.is_relative_to(root):
            raise ValueError('Choose an output folder outside the source folder trees.')
        if record['width'] * record['height'] > 40_000_000 or record['bytes'] > 64 * 1024 * 1024:
            raise ValueError('Source images support up to 40 megapixels and 64 MiB.')
    return options


def execute(manager, payload):
    from .image_manager import no_links, signature, image_metadata, now, Stopped
    from .image_vault import guard_path
    options = validate(manager, payload)
    _, root = manager.folder(payload['output_id'])
    records = sources(manager, payload['ids'])['images']
    if options['reverse']: records.reverse()
    output = no_links(root / ('Image_Tools_' + uuid.uuid4().hex[:12]))
    output.mkdir(exist_ok=False)
    receipt = dict(id=uuid.uuid4().hex, kind='image-tools', mode='image tools', status='running', started=now(), output=str(output), entries=[])
    manager._receipt(receipt)
    result = dict(output=str(output), images=[], stitched=None, animated=None, receipt_id=receipt['id'])
    canvas = None
    frames = []
    count = len(records)
    columns = count if options['layout'] == 'horizontal' else 1 if options['layout'] == 'vertical' else options['columns']
    if options['layout'] in ('grid', 'horizontal', 'vertical'):
        rows = math.ceil(count / columns)
        canvas = Image.new('RGBA', (columns * options['width'] + (columns - 1) * options['gap'], rows * options['height'] + (rows - 1) * options['gap']), options['background'])

    def save(image, target, sources, *, animated=False):
        manager._check(); no_links(target)
        for identifier in sources:
            _, source = manager.image_path(identifier); guard_path(source)
        with target.open('xb') as stream:
            if animated:
                settings = dict(format='GIF', save_all=True, append_images=frames[1:], duration=options['frame_delay'], disposal=2)
                if options['loop'] >= 0: settings['loop'] = options['loop']
                image.save(stream, **settings)
            elif options['format'] == 'jpg':
                flattened = Image.new('RGB', image.size, options['background'])
                flattened.paste(image, mask=image.getchannel('A'))
                try: flattened.save(stream, format='JPEG', quality=92)
                finally: flattened.close()
            else:
                image.save(stream, format='PNG' if options['format'] == 'png' else 'WEBP', **({'lossless': True} if options['format'] == 'webp' else {}))
        identifier = None
        if not animated:
            with manager.database() as db:
                identifier = manager._upsert(db, payload['output_id'], str(target.relative_to(root)), target, image_metadata(target), now())
        digest = hashlib.sha256()
        with target.open('rb') as stream:
            while chunk := stream.read(1024 * 1024): digest.update(chunk)
        receipt['entries'].append(dict(source='; '.join(manager.image(id)['relative'] for id in sources), target=str(target), sha256=digest.hexdigest(), status='created copy'))
        manager._receipt(receipt)
        return dict(id=identifier, path=str(target), width=image.width, height=image.height)

    try:
        manager._progress(total=count, current=0, message=f'Creating {count} image copies in {output}')
        for index, record in enumerate(records):
            manager._check()
            _, source = manager.image_path(record['id']); guard_path(source)
            with Image.open(source) as original:
                if getattr(original, 'n_frames', 1) != 1:
                    raise ValueError('A source became animated or multipage. Scan the folder again.')
                image = ImageOps.exif_transpose(original).convert('RGBA')
                image.info.clear()
            try:
                if signature(source.stat()) != record['signature']:
                    raise ValueError('A source changed during processing. Scan again.')
                if options['standardize']:
                    size = (options['width'], options['height'])
                    if options['fit'] == 'cover': sized = ImageOps.fit(image, size, method=Image.Resampling.LANCZOS)
                    elif options['fit'] == 'stretch': sized = image.resize(size, Image.Resampling.LANCZOS)
                    else: sized = ImageOps.pad(image, size, method=Image.Resampling.LANCZOS, color=options['background'])
                    image.close(); image = sized
                target = output / f'{index + 1:04d}-{Path(record["relative"]).stem[:180]}.{options["format"]}'
                result['images'].append(save(image, target, [record['id']]))
                if canvas is not None:
                    x = (index % columns) * (options['width'] + options['gap'])
                    y = (index // columns) * (options['height'] + options['gap'])
                    canvas.alpha_composite(image, (x, y))
                if options['layout'] == 'gif':
                    frame = Image.new('RGB', image.size, options['background']); frame.paste(image, mask=image.getchannel('A'))
                    frames.append(frame)
                manager._progress(current=index + 1, message=f'{index + 1} of {count} image copies created.')
            finally: image.close()
        source_ids = [record['id'] for record in records]
        if canvas is not None: result['stitched'] = save(canvas, output / ('stitched.' + options['format']), source_ids)
        if frames: result['animated'] = save(frames[0], output / 'animation.gif', source_ids, animated=True)
        receipt['status'] = 'complete'
        return result
    except Exception as error:
        receipt['status'] = 'stopped' if isinstance(error, Stopped) else 'failed'
        receipt['error'] = str(error)
        raise
    finally:
        receipt['finished'] = now(); manager._receipt(receipt)
        if canvas is not None: canvas.close()
        for frame in frames: frame.close()
