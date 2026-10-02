import hashlib
from pathlib import Path

import pytest
from PIL import Image

from services.image_manager import ImageManager
from services.image_manager_tools import sources


def run(manager, kind, **payload):
    manager.start(kind, payload); manager.worker.join(15)
    assert not manager.worker.is_alive()
    return manager.state()['job']


@pytest.fixture
def catalog(tmp_path):
    source = tmp_path / 'source'; source.mkdir()
    output = tmp_path / 'output'; output.mkdir()
    metadata = Image.Exif(); metadata[315] = 'Fixture photographer'
    Image.new('RGBA', (40, 20), (255, 0, 0, 128)).save(source / 'a.png', exif=metadata)
    Image.new('RGB', (20, 40), 'blue').save(source / 'b.png')
    manager = ImageManager(tmp_path / 'catalog')
    folder = manager.add_folder(str(source))['id']; dest = manager.add_folder(str(output), 'output')['id']
    run(manager, 'scan', folder_ids=[folder])
    ids = [row['id'] for row in manager.query(sort='name')['images']]
    return manager, source, output, ids, dest


@pytest.mark.parametrize('format', ['png', 'jpg', 'webp'])
def test_convert_real_copies_preserve_originals_and_catalog_outputs(catalog, format):
    manager, source, output, ids, dest = catalog
    before = {file: file.read_bytes() for file in source.iterdir()}
    job = run(manager, 'image-tools', ids=ids, output_id=dest, image_options={'format': format})
    assert job['status'] == 'complete', job['message']
    result = job['result']['image_tools']
    assert Path(result['output']).parent == output and len(result['images']) == 2
    assert manager.query(folder_id=dest)['total'] == 2
    for item in result['images']:
        with Image.open(item['path']) as image:
            assert image.size in [(40, 20), (20, 40)]
            assert image.format == {'png': 'PNG', 'jpg': 'JPEG', 'webp': 'WEBP'}[format]
            assert not image.getexif()
    with Image.open(result['images'][0]['path']) as image:
        if format != 'jpg': assert image.getpixel((0, 0))[3] == 128
        else: assert image.mode == 'RGB'
    assert all(file.read_bytes() == raw for file, raw in before.items())
    second = run(manager, 'image-tools', ids=ids, output_id=dest)['result']['image_tools']
    assert result['output'] != second['output']
    assert manager.state()['receipts'][0]['status'] == 'complete'


@pytest.mark.parametrize('fit', ['contain', 'cover', 'stretch'])
def test_size_stitch_and_reverse_order(catalog, fit):
    manager, _, _, ids, dest = catalog
    job = run(manager, 'image-tools', ids=ids, output_id=dest, image_options={'standardize': True, 'width': 16, 'height': 12, 'fit': fit, 'layout': 'grid', 'columns': 2, 'gap': 3, 'reverse': True})
    assert job['status'] == 'complete', job['message']
    result = job['result']['image_tools']
    with Image.open(result['stitched']['path']) as image: assert image.size == (35, 12)
    with Image.open(result['images'][0]['path']) as image:
        assert image.size == (16, 12)
        assert image.getpixel((8, 6))[:3] == (0, 0, 255)
    assert manager.query(folder_id=dest)['total'] == 3


def test_animated_gif_real_frames_timing_and_no_animation_in_still_catalog(catalog):
    manager, _, _, ids, dest = catalog
    job = run(manager, 'image-tools', ids=ids, output_id=dest, image_options={'standardize': True, 'width': 16, 'height': 16, 'layout': 'gif', 'frame_delay': 200, 'loop': -1})
    assert job['status'] == 'complete', job['message']
    with Image.open(job['result']['image_tools']['animated']['path']) as image:
        assert image.n_frames == 2 and image.size == (16, 16)
        assert image.info['duration'] == 200 and 'loop' not in image.info
        image.seek(1); assert image.convert('RGB').getpixel((8, 8)) == (0, 0, 255)
    assert manager.query(folder_id=dest)['total'] == 2


@pytest.mark.parametrize('options', [dict(width=16384, height=16384), dict(layout='grid'), dict(layout='gif', standardize=True, width=8192, height=4096), dict(layout='grid', standardize=True, columns=3), dict(background='bad'), dict(format='exe')])
def test_invalid_options_rejected_before_output(catalog, options):
    manager, _, output, ids, dest = catalog
    with pytest.raises(ValueError): manager.start('image-tools', dict(ids=ids, output_id=dest, image_options=options))
    assert not list(output.iterdir())


def test_stale_source_source_destinations_and_unavailable_selection_rejected(catalog):
    manager, source, output, ids, dest = catalog
    with pytest.raises(ValueError): manager.start('image-tools', dict(ids=ids, output_id=manager.image(ids[0])['folder_id']))
    nested = source / 'new-output'; nested.mkdir()
    nested_id = manager.add_folder(str(nested), 'output')['id']
    with pytest.raises(ValueError): manager.start('image-tools', dict(ids=ids, output_id=nested_id))
    with pytest.raises(ValueError): sources(manager, [ids[0], 'unknown'])
    (source / 'a.png').write_bytes(b'changed')
    with pytest.raises(ValueError): manager.start('image-tools', dict(ids=ids, output_id=dest))
    assert not list(output.iterdir())


def test_stop_retains_completed_outputs_and_receipt(catalog, monkeypatch):
    manager, source, _, ids, dest = catalog
    original = manager._upsert
    def cancel_after_first(*args, **kwargs):
        identifier = original(*args, **kwargs); manager.cancel.set(); return identifier
    monkeypatch.setattr(manager, '_upsert', cancel_after_first)
    before = hashlib.sha256((source / 'a.png').read_bytes()).digest()
    job = run(manager, 'image-tools', ids=ids, output_id=dest)
    assert job['status'] == 'stopped'
    receipt = manager.state()['receipts'][0]
    assert receipt['status'] == 'stopped' and len(receipt['entries']) == 1
    with Image.open(receipt['entries'][0]['target']) as image: image.verify()
    assert hashlib.sha256((source / 'a.png').read_bytes()).digest() == before
    assert ImageManager(manager.directory).query(folder_id=dest)['total'] == 1
