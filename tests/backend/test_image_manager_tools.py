import hashlib
from pathlib import Path

import pytest
from PIL import Image

from services.image_manager import ImageManager
from services.image_manager_tools import sources, DEFAULTS, LIMITS, trim_white
from services.image_manager_layout import plan, ordered


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


@pytest.mark.parametrize('options', [dict(width=0, height=16384), dict(layout='grid'), dict(layout='gif', standardize=True, width=8192, height=4096), dict(layout='grid', standardize=True, columns=3), dict(background='bad'), dict(format='exe')])
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


def test_reported_layout_fits_without_changing_requested_copy_dimensions():
    records = [dict(id=str(i), width=40, height=20) for i in range(297)]
    options = DEFAULTS | dict(layout='grid', standardize=True, columns=11, gap=3, size_mode='fit')
    sheet = plan(records, options, LIMITS)[0]
    assert sheet['reduced'] and sheet['width'] * sheet['height'] <= 64_000_000
    assert len(sheet['placements']) == 297 and sheet['tile_width'] < 1024
    assert options['width'] == 1024
    exact = plan(records, options | {'size_mode': 'exact'}, LIMITS)[0]
    assert (exact['width'], exact['height']) == (11294, 27726) and not exact['reduced']


@pytest.mark.parametrize('layout', ['grid', 'horizontal', 'vertical', 'balanced'])
def test_paged_geometry_contains_every_source_once_and_bounds_each_sheet(layout):
    records = [dict(id=str(i), width=40 if i % 2 else 20, height=20 if i % 2 else 40) for i in range(1001)]
    sheets = plan(records, DEFAULTS | dict(layout=layout, size_mode='pages', images_per_sheet=60, standardize=True), LIMITS)
    placements = [placement for sheet in sheets for placement in sheet['placements']]
    assert len(placements) == 1001 and len({placement['id'] for placement in placements}) == 1001
    assert len(sheets) > 1
    assert all(sheet['width'] * sheet['height'] <= 64_000_000 and max(sheet['width'], sheet['height']) <= 65535 for sheet in sheets)
    if layout != 'balanced': assert all(p['width'] == 1024 and p['height'] == 1024 for p in placements)


def test_partial_grid_rows_and_large_tile_pages_are_supported():
    records = [dict(id=str(i), width=16, height=16) for i in range(7)]
    sheet = plan(records, DEFAULTS | dict(layout='grid', columns=3, width=16, height=16), LIMITS)[0]
    assert (sheet['width'], sheet['height']) == (48, 48) and len(sheet['placements']) == 7
    sheets = plan(records, DEFAULTS | dict(layout='grid', width=4096, height=4096, size_mode='pages'), LIMITS)
    assert all(s['width'] * s['height'] <= 64_000_000 and s['tile_width'] == 4096 for s in sheets)


def test_shuffling_agrees_with_preview_and_preserves_all_ids():
    result = ordered(list(range(10)), dict(order='shuffle', shuffle_seed=42))
    assert result == [0, 4, 6, 5, 2, 8, 1, 9, 7, 3]
    assert sorted(result) == list(range(10))
    assert ordered(list(range(10)), dict(order='shuffle', shuffle_seed=43)) != result


def test_full_fill_adapts_density_for_sparse_orientation_groups():
    from statistics import median
    records = [dict(id='portrait', width=20, height=40), dict(id='landscape', width=40, height=20)]
    records.extend(dict(id=str(i), width=20, height=20) for i in range(99))
    sheet = plan(records, DEFAULTS | dict(layout='balanced', columns=10, width=16, height=16, size_mode='fit'), LIMITS)[0]
    areas = [p['width'] * p['height'] for p in sheet['placements']]
    assert max(areas) <= 3 * median(areas)
    assert len(sheet['placements']) == 101 and sheet['columns'] < 10


def test_tools_source_scope_respects_subfolders_and_hidden_images(catalog):
    manager, source, _, ids, _ = catalog
    nested = source / 'nested'; nested.mkdir(); Image.new('RGB', (4, 4), 'red').save(nested / 'child.png')
    folder = manager.image(ids[0])['folder_id']; run(manager, 'scan', folder_ids=[folder], recursive=True)
    assert sources(manager, folder_id=folder)['total'] == 3
    assert sources(manager, folder_id=folder, recursive=False)['total'] == 2
    manager.metadata([ids[0]], hidden=True)
    assert sources(manager, folder_id=folder)['total'] == 2
    assert sources(manager, ids)['total'] == 2


def test_full_fill_geometry_covers_canvas_and_preserves_orientation_rows(catalog):
    manager, source, output, ids, dest = catalog
    for index in range(2, 7):
        size, color = ((40, 20), 'red') if index in (2, 3) else ((20, 40), 'blue')
        Image.new('RGB', size, color).save(source / f'c{index}.png')
    folder = manager.image(ids[0])['folder_id']; run(manager, 'scan', folder_ids=[folder])
    records = sources(manager, folder_id=folder)['images']; ids = [record['id'] for record in records]
    options = DEFAULTS | dict(layout='balanced', width=16, height=16, columns=3, standardize=True, save_copies=False, size_mode='fit', background='#00ff00')
    sheet = plan(records, options, LIMITS)[0]
    assert (sheet['width'], sheet['height']) == (48, 32)
    assert sum(p['width'] * p['height'] for p in sheet['placements']) == sheet['width'] * sheet['height']
    by_id = {record['id']: record for record in records}
    for y in {p['y'] for p in sheet['placements']}:
        row = [p for p in sheet['placements'] if p['y'] == y]
        assert sum(p['width'] for p in row) == sheet['width']
        assert len({by_id[p['id']]['width'] > by_id[p['id']]['height'] for p in row}) == 1
    before = {path: path.read_bytes() for path in source.iterdir()}
    job = run(manager, 'image-tools', ids=ids, output_id=dest, image_options=options)
    assert job['status'] == 'complete', job['message']
    result = job['result']['image_tools']; assert not result['images'] and len(result['sheets']) == 1
    with Image.open(result['stitched']['path']) as image:
        assert image.size == (48, 32)
        assert (0, 255, 0, 255) not in {image.getpixel((x, y)) for y in range(image.height) for x in range(image.width)}
    assert all(path.read_bytes() == data for path, data in before.items())
    import csv
    with open(result['report'], encoding='utf-8-sig', newline='') as stream:
        report = list(csv.DictReader(stream))
    assert len(report) == 7 and {row['Source'] for row in report} == {record['relative'] for record in records}


def test_real_folder_above_old_count_cap_and_multiple_sheets(tmp_path):
    source = tmp_path / 'source'; source.mkdir(); output = tmp_path / 'output'; output.mkdir()
    for index in range(1001):
        Image.new('RGB', (4, 4), (index % 256, 50, 90)).save(source / f'{index:04d}.png')
    manager = ImageManager(tmp_path / 'catalog')
    folder = manager.add_folder(str(source))['id']; dest = manager.add_folder(str(output), 'output')['id']
    manager.start('scan', dict(folder_ids=[folder])); manager.worker.join(90)
    assert not manager.worker.is_alive() and manager.state()['job']['status'] == 'complete'
    records = sources(manager, folder_id=folder)['images']; ids = [record['id'] for record in records]
    assert len(ids) == 1001 and sources(manager, ids)['total'] == 1001
    before = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in source.iterdir()}
    manager.start('image-tools', dict(ids=ids, output_id=dest, image_options=dict(layout='grid', standardize=True, width=8, height=8, size_mode='pages', images_per_sheet=60, save_copies=False)))
    manager.worker.join(90); assert not manager.worker.is_alive()
    job = manager.state()['job']; assert job['status'] == 'complete', job['message']
    result = job['result']['image_tools']; assert len(result['sheets']) == 17 and not result['images']
    assert manager.query(folder_id=dest)['total'] == 17
    assert before == {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in source.iterdir()}
    assert all(not path.name.endswith('.part') for path in Path(result['output']).iterdir())


def test_trimming_keeps_interior_white_and_all_white_images():
    with Image.new('RGBA', (10, 10), 'white') as image:
        image.putpixel((2, 3), (0, 0, 0, 255)); image.putpixel((7, 8), (0, 0, 0, 255))
        cropped = trim_white(image)
        try:
            assert cropped.size == (6, 6) and cropped.getpixel((2, 2)) == (255, 255, 255, 255)
        finally: cropped.close()
    with Image.new('RGBA', (10, 10), 'white') as image:
        cropped = trim_white(image)
        try: assert cropped.size == (10, 10)
        finally: cropped.close()


def test_copy_prefix_orientation_preset_and_dimensions_report(catalog):
    import csv
    manager, source, _, ids, dest = catalog
    before = {path: path.read_bytes() for path in source.iterdir()}
    job = run(manager, 'image-tools', ids=ids, output_id=dest, image_options=dict(name_prefix='Test', orientation_size=True))
    assert job['status'] == 'complete', job['message']
    result = job['result']['image_tools']
    assert [Path(item['path']).name for item in result['images']] == ['Test_0001.png', 'Test_0002.png']
    assert [(item['width'], item['height']) for item in result['images']] == [(1920, 1080), (1080, 1920)]
    with open(result['report'], encoding='utf-8-sig', newline='') as stream: assert len(list(csv.DictReader(stream))) == 2
    assert all(path.read_bytes() == data for path, data in before.items())
    with pytest.raises(ValueError): manager.start('image-tools', dict(ids=ids, output_id=dest, image_options=dict(name_prefix='../unsafe')))


def test_cancel_pages_retains_complete_sheet_and_sources(catalog, monkeypatch):
    manager, source, _, ids, dest = catalog
    original = manager._upsert
    def stop_after_sheet(*args, **kwargs):
        saved = original(*args, **kwargs); manager.cancel.set(); return saved
    monkeypatch.setattr(manager, '_upsert', stop_after_sheet)
    before = {path: path.read_bytes() for path in source.iterdir()}
    job = run(manager, 'image-tools', ids=ids, output_id=dest, image_options=dict(layout='grid', standardize=True, width=16, height=16, size_mode='pages', images_per_sheet=1, save_copies=False))
    assert job['status'] == 'stopped'
    entries = manager.state()['receipts'][0]['entries']; assert len(entries) == 1
    with Image.open(entries[0]['target']) as image: image.verify()
    assert all(path.read_bytes() == data for path, data in before.items())


def test_local_large_sources_scan_and_process_above_both_old_caps(catalog, monkeypatch):
    from services.image_manager_metadata import open_local_image
    manager, source, _, ids, dest = catalog
    with Image.new('RGB', (6400, 6400), 'green') as image: image.save(source / 'large.png')
    with Image.new('RGB', (5000, 5000), 'yellow') as image: image.save(source / 'large.bmp')
    assert (source / 'large.bmp').stat().st_size > 64 * 1024 * 1024
    folder = manager.image(ids[0])['folder_id']
    # Simulate a lower generic Pillow limit; the local folder path must neither
    # obey it nor disable it globally for other upload/preview threads.
    monkeypatch.setattr(Image, 'MAX_IMAGE_PIXELS', 10)
    job = run(manager, 'scan', folder_ids=[folder])
    assert job['status'] == 'complete', job['message']
    records = sources(manager, folder_id=folder)['images']; assert len(records) == 4
    assert any(row['width'] * row['height'] > 40_000_000 for row in records)
    before = {p.name: hashlib.sha256(p.read_bytes()).digest() for p in source.iterdir()}
    job = run(manager, 'image-tools', ids=[r['id'] for r in records], output_id=dest, image_options=dict(layout='grid', standardize=True, width=8, height=8, save_copies=False))
    assert job['status'] == 'complete', job['message']
    with open_local_image(job['result']['image_tools']['stitched']['path']) as image:
        assert image.size == (16, 16); image.load()
    assert Image.MAX_IMAGE_PIXELS == 10
    assert all(hashlib.sha256(p.read_bytes()).digest() == before[p.name] for p in source.iterdir())


def test_exact_large_png_uses_disk_canvas_and_preserves_requested_dimensions(catalog):
    manager, source, _, ids, dest = catalog
    before = {p.name: hashlib.sha256(p.read_bytes()).digest() for p in source.iterdir()}
    job = run(manager, 'image-tools', ids=ids, output_id=dest, image_options=dict(layout='grid', standardize=True, width=4096, height=8193, columns=2, fit='stretch', save_copies=False))
    assert job['status'] == 'complete', job['message']
    result = job['result']['image_tools']; sheet = result['stitched']
    assert (sheet['width'], sheet['height']) == (8192, 8193)
    assert sheet['width'] * sheet['height'] > 64_000_000
    with Image.open(sheet['path']) as image:
        assert image.getpixel((0, 0)) == (255, 127, 127, 255)
        assert image.getpixel((8191, 8192)) == (0, 0, 255, 255)
    assert sorted(p.name for p in Path(result['output']).iterdir()) == ['dimensions.csv', 'stitched.png']
    assert manager.query(folder_id=dest)['total'] == 1
    assert all(hashlib.sha256(p.read_bytes()).digest() == before[p.name] for p in source.iterdir())


def test_png_strip_can_exceed_old_edge_limit_while_codecs_keep_their_real_limits(catalog):
    manager, _, _, ids, dest = catalog
    options = dict(layout='horizontal', standardize=True, width=40000, height=1, save_copies=False)
    job = run(manager, 'image-tools', ids=ids, output_id=dest, image_options=options)
    assert job['status'] == 'complete', job['message']
    with Image.open(job['result']['image_tools']['stitched']['path']) as image: assert image.size == (80000, 1)
    for format in ('jpg', 'webp'):
        with pytest.raises(ValueError, match='edge limit'):
            manager.start('image-tools', dict(ids=ids, output_id=dest, image_options=options | {'format': format}))


def test_disk_canvas_compositing_matches_pillow_and_cleans_up_after_stop(tmp_path):
    from services.image_manager_canvas import DiskCanvas
    from services.image_manager import Stopped
    calls = 0
    def check():
        nonlocal calls
        calls += 1
        if calls > 100: raise Stopped()
    canvas = DiskCanvas((20000, 2), '#112233', tmp_path, check)
    try:
        with Image.new('RGBA', (18000, 2), (10, 240, 30, 100)) as tile:
            canvas.alpha_composite(tile, (1000, 0))
            with Image.new('RGBA', canvas.size, '#112233') as expected:
                expected.alpha_composite(tile, (1000, 0))
                import io
                encoded = io.BytesIO(); canvas.save(encoded, format='PNG'); encoded.seek(0)
                with Image.open(encoded) as actual: assert actual.tobytes() == expected.tobytes()
        calls = 100
        with pytest.raises(Stopped): canvas.save(__import__('io').BytesIO(), format='PNG')
    finally: canvas.close()
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize('format', ['TIFF', 'PNG', 'JPEG', 'WEBP', 'BMP'])
def test_local_reader_decodes_supported_stills_without_mutating_generic_guard(tmp_path, monkeypatch, format):
    from services.image_manager_metadata import open_local_image
    path = tmp_path / 'image'
    with Image.new('RGB', (32, 24), 'blue') as image: image.save(path, format=format)
    monkeypatch.setattr(Image, 'MAX_IMAGE_PIXELS', 1)
    with open_local_image(path) as local:
        local.load(); assert local.size == (32, 24)
    assert Image.MAX_IMAGE_PIXELS == 1
    with pytest.raises(Image.DecompressionBombError): Image.open(path)
