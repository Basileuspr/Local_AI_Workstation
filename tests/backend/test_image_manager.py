import hashlib
import json
import os
import shutil
import sqlite3
import threading
from pathlib import Path

import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services.image_manager import ImageManager, Stopped, image_metadata


def run(manager, kind, **payload):
    manager.start(kind, payload)
    manager.worker.join(10)
    assert not manager.worker.is_alive()
    return manager.state()['job']


@pytest.fixture
def setup(tmp_path):
    source = tmp_path / 'photos'; source.mkdir()
    output = tmp_path / 'organized'; output.mkdir()
    nested = source / 'holiday'; nested.mkdir()
    Image.new('RGB', (60, 40), 'red').save(source / 'a.png')
    shutil.copy2(source / 'a.png', nested / 'a.png')
    Image.new('RGBA', (32, 24), 'blue').save(source / 'other.webp')
    Image.new('RGB', (24, 16), 'red').save(source / 'motion.gif', save_all=True, append_images=[Image.new('RGB', (24, 16), 'blue')], duration=80, loop=0)
    (source / 'clip.mp4').write_bytes(b'motion media untouched')
    ignored = source / 'NVIDIA'; ignored.mkdir(); Image.new('RGB', (16, 16)).save(ignored / 'private.png')
    manager = ImageManager(tmp_path / 'catalog')
    src = manager.add_folder(str(source))['id']; dest = manager.add_folder(str(output), 'output')['id']
    assert run(manager, 'scan', folder_ids=[src], recursive=True)['status'] == 'complete'
    return manager, source, output, src, dest


def test_still_images_only_metadata_preview_and_source_preservation(setup):
    manager, source, _, src, _ = setup
    before = {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in source.rglob('*') if file.is_file()}
    records = manager.query()['images']
    assert len(records) == 3
    assert {row['relative'] for row in records} == {'a.png', str(Path('holiday/a.png')), 'other.webp'}
    assert all(row['date_source'] == 'File modified' for row in records)
    preview = manager.thumbnail(records[0]['id'])
    assert preview.is_relative_to(manager.directory)
    with Image.open(preview) as image: assert max(image.size) <= 320
    manager.metadata([records[0]['id']], favorite=True, tags=['Trip', 'Trip', '  Blue '])
    assert manager.query(search='Trip', favorite=True)['total'] == 1
    assert run(manager, 'scan', folder_ids=[src], recursive=True)['status'] == 'complete'
    assert manager.query(favorite=True)['images'][0]['tags'] == ['Trip', 'Blue']
    assert before == {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in source.rglob('*') if file.is_file()}
    manager.forget_folder(src)
    assert manager.query()['total'] == 0
    assert (source / 'a.png').exists()


def test_exif_orientation_and_capture_date(tmp_path):
    path = tmp_path / 'oriented.jpg'
    exif = Image.Exif(); exif[274] = 6; exif[306] = '2021:02:03 04:05:06'
    Image.new('RGB', (60, 40)).save(path, exif=exif)
    metadata = image_metadata(path)
    assert (metadata['width'], metadata['height']) == (40, 60)
    assert metadata['date_source'] == 'EXIF'
    assert metadata['date'].startswith('2021-02-03')


def test_duplicate_hashes_changed_files_and_partial_scan(setup):
    manager, source, _, src, _ = setup
    job = run(manager, 'duplicates', folder_ids=[src])
    assert job['status'] == 'complete'
    assert manager.duplicates()[0]['count'] == 2
    original = next(row for row in manager.query()['images'] if row['relative'] == 'a.png')
    Image.new('RGB', (61, 41), 'green').save(source / 'a.png')
    with pytest.raises(ValueError, match='changed'): manager.image_path(original['id'])
    assert run(manager, 'scan', folder_ids=[src], recursive=True)['status'] == 'complete'
    assert not manager.duplicates()
    manager.scan_limit = 1
    assert run(manager, 'scan', folder_ids=[src], recursive=True)['result']['scan']['partial']
    assert manager.query()['total'] == 3  # unvisited entries remain in bounded scans


def test_copy_plan_no_overwrite_and_verified_receipt(setup):
    manager, source, output, _, dest = setup
    rows = [row for row in manager.query()['images'] if row['format'] == 'PNG']
    existing_dir = output / 'png'; existing_dir.mkdir(); existing = existing_dir / 'a.png'; existing.write_bytes(b'keep me')
    before = {file: file.read_bytes() for file in source.rglob('*') if file.is_file()}
    job = run(manager, 'plan', ids=[row['id'] for row in rows], output_id=dest, layout='format', mode='copy')
    assert job['status'] == 'complete'
    plan = manager.plan(job['result']['plan_id'])
    assert {Path(item['target']).name for item in plan['entries']} == {'a (2).png', 'a (3).png'}
    assert list(output.rglob('*')) == [existing_dir, existing]
    with pytest.raises(ValueError, match='confirmation'): manager.start('apply', {'plan_id': plan['id'], 'confirmation': 'MOVE 2'})
    applied = run(manager, 'apply', plan_id=plan['id'], confirmation='COPY 2')
    assert applied['status'] == 'complete'
    assert existing.read_bytes() == b'keep me'
    assert all(file.read_bytes() == data for file, data in before.items())
    for entry in plan['entries']: assert hashlib.sha256(Path(entry['target']).read_bytes()).hexdigest() == entry['sha256']
    assert manager.state()['receipts'][0]['status'] == 'complete'
    assert all(row['status'] == 'copied' for row in manager.state()['receipts'][0]['entries'])
    with pytest.raises(ValueError): manager.start('apply', {'plan_id': plan['id'], 'confirmation': 'COPY 2'})


@pytest.mark.parametrize('change', ['source', 'target'])
def test_preflight_checks_all_sources_and_targets_before_copy(setup, change):
    manager, source, _, _, dest = setup
    rows = manager.query(sort='name')['images']
    plan = manager.plan(run(manager, 'plan', ids=[row['id'] for row in rows], output_id=dest, layout='format', mode='move')['result']['plan_id'])
    last = plan['entries'][-1]
    if change == 'source': Path(last['source']).write_bytes(b'changed original')
    else:
        target = Path(last['target']); target.parent.mkdir(parents=True); target.write_bytes(b'existing target')
    job = run(manager, 'apply', plan_id=plan['id'], confirmation='MOVE 3')
    assert job['status'] == 'failed'
    assert all(Path(item['source']).exists() for item in plan['entries'])
    assert not Path(plan['entries'][0]['target']).exists()
    assert manager.plan(plan['id'])['status'] == 'ready'


def test_verified_move_preserves_tags_and_catalog_id(setup):
    manager, source, _, _, dest = setup
    row = next(row for row in manager.query()['images'] if row['relative'] == 'other.webp')
    manager.metadata([row['id']], favorite=True, tags=['Original'])
    original = (source / row['relative']).read_bytes()
    plan = manager.plan(run(manager, 'plan', ids=[row['id']], output_id=dest, layout='folders', mode='move')['result']['plan_id'])
    assert run(manager, 'apply', plan_id=plan['id'], confirmation='MOVE 1')['status'] == 'complete'
    assert not (source / row['relative']).exists()
    record, target = manager.image_path(row['id'])
    assert target.read_bytes() == original
    assert record['favorite'] and record['tags'] == ['Original']
    assert (source / 'clip.mp4').read_bytes() == b'motion media untouched'


def test_stop_retains_verified_copy_and_original(setup, monkeypatch):
    manager, _, _, _, dest = setup
    row = manager.query()['images'][0]
    plan = manager.plan(run(manager, 'plan', ids=[row['id']], output_id=dest, layout='format', mode='move')['result']['plan_id'])
    original_receipt = manager._receipt
    def stop_when_verified(receipt):
        original_receipt(receipt)
        if receipt['entries'] and receipt['entries'][-1]['status'] == 'verified copy; source retained': manager.cancel.set()
    monkeypatch.setattr(manager, '_receipt', stop_when_verified)
    job = run(manager, 'apply', plan_id=plan['id'], confirmation='MOVE 1')
    assert job['status'] == 'stopped'
    assert Path(plan['entries'][0]['source']).exists()
    assert Path(plan['entries'][0]['target']).exists()
    assert manager.state()['receipts'][0]['status'] == 'stopped'


def test_failed_verification_removes_only_own_incomplete_target(setup, monkeypatch):
    manager, _, _, _, dest = setup
    row = manager.query()['images'][0]
    plan = manager.plan(run(manager, 'plan', ids=[row['id']], output_id=dest, layout='format', mode='move')['result']['plan_id'])
    original_hash = manager._hash
    def corrupt_target(path, expected=None):
        return '0' * 64 if str(path) == plan['entries'][0]['target'] else original_hash(path, expected)
    monkeypatch.setattr(manager, '_hash', corrupt_target)
    assert run(manager, 'apply', plan_id=plan['id'], confirmation='MOVE 1')['status'] == 'failed'
    assert Path(plan['entries'][0]['source']).exists()
    assert not Path(plan['entries'][0]['target']).exists()


def test_saved_function_order_report_and_never_apply(setup):
    manager, source, output, src, dest = setup
    recipe = manager.save_function({'name': 'Monthly image audit', 'folder_ids': [src], 'output_id': dest, 'recursive': True, 'layout': 'month', 'mode': 'move', 'steps': ['scan', 'duplicates', 'plan', 'report']})
    job = run(manager, 'function', function_id=recipe['id'])
    assert job['status'] == 'complete'
    assert [step['type'] for step in job['steps']] == ['scan', 'duplicates', 'plan', 'report']
    assert all(step['status'] == 'complete' for step in job['steps'])
    assert manager.plan(job['result']['plan_id'])['status'] == 'ready'
    report = Path(job['result']['report'])
    assert list(output.iterdir()) == [report]
    assert json.loads(report.read_text())['plan']['mode'] == 'move'
    assert (source / 'a.png').exists()
    restored = ImageManager(manager.directory)
    assert restored.functions()[0]['steps'] == recipe['steps']
    assert restored.state()['plans'][0]['status'] == 'ready'
    with pytest.raises(ValueError): manager.save_function({**recipe, 'steps': ['apply']})


def test_links_and_nested_destinations_rejected(setup, tmp_path):
    manager, source, _, _, _ = setup
    with pytest.raises(ValueError, match='NVIDIA'): manager.add_folder(str(source / 'NVIDIA'))
    internal = manager.directory / 'inside'; internal.mkdir()
    with pytest.raises(ValueError): manager.add_folder(str(internal))
    destination = source / 'nested-output'; destination.mkdir()
    dest = manager.add_folder(str(destination), 'output')['id']
    with pytest.raises(ValueError, match='separate'): manager.start('plan', {'ids': [manager.query()['images'][0]['id']], 'output_id': dest, 'layout': 'month', 'mode': 'copy'})
    link = tmp_path / 'linked'
    try: link.symlink_to(source, target_is_directory=True)
    except OSError:
        if os.name != 'nt': raise
        import _winapi
        _winapi.CreateJunction(str(source), str(link))
    with pytest.raises(ValueError, match='links'): manager.add_folder(str(link))


def test_concurrent_tasks_rejected_and_stop_prevents_later_steps(setup, monkeypatch):
    manager, _, output, src, dest = setup
    entered, release = threading.Event(), threading.Event()
    original_scan = manager._scan
    def block(*args): entered.set(); release.wait(5); return original_scan(*args)
    monkeypatch.setattr(manager, '_scan', block)
    recipe = manager.save_function({'name': 'Cancel', 'folder_ids': [src], 'output_id': dest, 'steps': ['scan', 'report']})
    identifier = manager.start('function', {'function_id': recipe['id']})['job_id']; assert entered.wait(5)
    with pytest.raises(ValueError, match='already running'): manager.start('scan', {'folder_ids': [src]})
    manager.stop(identifier); release.set(); manager.worker.join(5)
    assert manager.state()['job']['status'] == 'stopped'
    assert manager.state()['job']['steps'][1]['status'] == 'pending'
    assert not list(output.iterdir())


def test_api_validation_and_original_thumbnail(setup, monkeypatch):
    from routes import image_manager as routes
    manager, _, _, src, _ = setup
    monkeypatch.setattr(routes, 'manager', manager)
    app = FastAPI(); app.include_router(routes.router)
    client = TestClient(app)
    row = client.get('/image-manager/images').json()['images'][0]
    assert client.get(f'/image-manager/images/{row["id"]}/thumbnail').headers['content-type'] == 'image/jpeg'
    assert client.get(f'/image-manager/images/{row["id"]}/file').status_code == 200
    assert client.get('/image-manager/images/unknown/file').status_code == 422
    assert client.post('/image-manager/tasks', json={'kind': 'command'}).status_code == 422
    assert client.post('/image-manager/functions', json={'name': 'Unsafe', 'folder_ids': [src], 'steps': ['apply']}).status_code == 422
    assert client.get('/image-manager/images?sort=invalid').status_code == 422


def test_restart_marks_unfinished_receipts_without_resuming_or_deleting(setup):
    manager, source, output, _, _ = setup
    manager._receipt({'id': 'interrupted-test', 'started': 'before restart', 'status': 'running', 'mode': 'move', 'entries': [{'status': 'verified copy; source retained', 'source': str(source / 'a.png'), 'target': str(output / 'a.png')}]})
    restored = ImageManager(manager.directory)
    state = restored.state()
    assert state['job'] is None
    assert state['receipts'][0]['status'] == 'interrupted'
    assert state['receipts'][0]['entries'][0]['status'] == 'verified copy; source retained'
    assert (source / 'a.png').exists()


def test_reports_and_function_results_stay_in_selected_folder_scope(setup):
    manager, _, _, src, dest = setup
    ids = [row['id'] for row in manager.query()['images']]
    plan_id = run(manager, 'plan', ids=ids, output_id=dest, layout='format', mode='copy')['result']['plan_id']
    assert run(manager, 'apply', plan_id=plan_id, confirmation='COPY 3')['status'] == 'complete'
    recipe = manager.save_function({'name': 'Scoped report', 'folder_ids': [src], 'output_id': dest, 'steps': ['duplicates', 'report']})
    job = run(manager, 'function', function_id=recipe['id'])
    report = json.loads(Path(job['result']['report']).read_text())
    assert len(report['images']) == 3
    assert report['duplicates'][0]['count'] == 2
    assert job['result']['duplicates']['groups'][0]['count'] == 2


def test_hide_tagged_filters_before_count_and_paging_and_updates_after_tagging(setup):
    manager, _, _, _, _ = setup
    records = manager.query(sort='name')['images']
    manager.metadata([records[0]['id']], tags=['Done'])
    remaining = manager.query(hide_tagged=True, limit=1, offset=1, sort='name')
    assert remaining['total'] == 2 and len(remaining['images']) == 1
    assert remaining['images'][0]['tags'] == []
    manager.metadata([remaining['images'][0]['id']], tags=['Next'])
    assert manager.query(hide_tagged=True)['total'] == 1
    manager.metadata([records[0]['id']], tags=[])
    assert manager.query(hide_tagged=True)['total'] == 2
    assert manager.query()['total'] == 3


def test_saved_tag_choices_cover_catalog_and_filter_exact_values_before_paging(setup):
    manager, _, _, src, _ = setup
    records = manager.query(sort='name')['images']
    special = 'Trip %_" café'
    manager.metadata([records[0]['id']], tags=['Trip', special])
    manager.metadata([records[1]['id']], tags=['Trip planning'], hidden=True)
    manager.metadata([records[2]['id']], tags=['Trip'], favorite=True)
    # Filename/substring/search wildcard matches cannot stand in for a saved tag.
    with manager.database() as db:
        db.execute('UPDATE images SET relative=? WHERE id=?', ('Trip.png', records[1]['id']))
    first = manager.query(tag='Trip', sort='name', offset=0, limit=1)
    second = manager.query(tag='Trip', sort='name', offset=1, limit=1)
    assert first['total'] == second['total'] == 2
    assert first['images'][0]['id'] != second['images'][0]['id']
    assert first['tags'] == second['tags'] == ['Trip', special, 'Trip planning']
    assert manager.query(tag='Trip', favorite=True, folder_id=src)['total'] == 1
    assert manager.query(tag='trip')['total'] == 0  # Exact stored spelling.
    assert manager.query(tag=special)['images'][0]['id'] == records[0]['id']
    assert manager.query(tag='Trip', hide_tagged=True)['total'] == 0
    assert manager.query(tag='Trip', visibility='hidden')['total'] == 0
    assert manager.query(tag='Trip planning', visibility='hidden')['total'] == 1
    assert manager.query(search='no such filename', limit=1)['tags'] == first['tags']
    manager.metadata([records[0]['id']], tags=[])
    assert special not in manager.query()['tags']
    manager.metadata([records[2]['id']], tags=[])
    assert manager.query()['tags'] == ['Trip planning']
    assert ImageManager(manager.directory).query(visibility='hidden', tag='Trip planning')['total'] == 1
    with pytest.raises(ValueError): manager.query(tag='x' * 61)


def test_tag_dropdown_api_updates_after_setting_tags_and_handles_reserved_characters(setup, monkeypatch):
    from routes import image_manager as routes
    manager, _, _, _, _ = setup
    monkeypatch.setattr(routes, 'manager', manager)
    app = FastAPI(); app.include_router(routes.router); client = TestClient(app)
    identifier = manager.query()['images'][0]['id']
    tag = 'Client & 50% / α'
    assert client.patch('/image-manager/metadata', json={'ids': [identifier], 'tags': [tag]}).status_code == 200
    page = client.get('/image-manager/images', params={'tag': tag, 'limit': 1}).json()
    assert page['total'] == 1 and page['images'][0]['id'] == identifier
    assert page['tags'] == [tag]
    assert client.get('/image-manager/images', params={'tag': 'Client'}).json()['total'] == 0
    assert client.get('/image-manager/images', params={'tag': 'x' * 61}).status_code == 422
    client.patch('/image-manager/metadata', json={'ids': [identifier], 'tags': []})
    assert client.get('/image-manager/images').json()['tags'] == []


def test_apply_existing_tag_preserves_each_images_tags_and_exact_label(setup, monkeypatch):
    from routes import image_manager as routes
    manager, source, _, _, _ = setup
    monkeypatch.setattr(routes, 'manager', manager)
    app = FastAPI(); app.include_router(routes.router); client = TestClient(app)
    rows = manager.query(sort='name')['images']
    first, second, donor = [row['id'] for row in rows]
    tag = 'Client, archive & α'
    before = {file: file.read_bytes() for file in source.rglob('*') if file.is_file()}
    manager.metadata([first], tags=['Portrait'], favorite=True, hidden=True)
    manager.metadata([second], tags=['Reviewed'])
    manager.metadata([donor], tags=[tag])
    for _ in range(2):
        assert client.patch('/image-manager/metadata', json={'ids': [first, second], 'add_tags': [tag]}).status_code == 200
    restarted = ImageManager(manager.directory)
    assert restarted.image(first)['tags'] == ['Portrait', tag]
    assert restarted.image(first)['favorite'] == 1 and restarted.image(first)['hidden'] == 1
    assert restarted.image(second)['tags'] == ['Reviewed', tag]
    assert restarted.image(donor)['tags'] == [tag]
    assert before == {file: file.read_bytes() for file in source.rglob('*') if file.is_file()}


def test_add_tags_preflights_whole_batch_before_updating_any_metadata(setup):
    manager, _, _, _, _ = setup
    first, second = [row['id'] for row in manager.query()['images'][:2]]
    full = [f'Tag {index}' for index in range(20)]
    manager.metadata([first], tags=['Keep'])
    manager.metadata([second], tags=full)
    with pytest.raises(ValueError, match='exceed 20 tags'):
        manager.metadata([first, second], favorite=True, add_tags=['New'])
    assert manager.image(first)['tags'] == ['Keep'] and manager.image(first)['favorite'] == 0
    assert manager.image(second)['tags'] == full and manager.image(second)['favorite'] == 0
    manager.metadata([second], add_tags=[' Tag 0 ', 'Tag 0'])
    assert manager.image(second)['tags'] == full
    with pytest.raises(ValueError, match='no longer'):
        manager.metadata([first, 'unknown'], add_tags=['New'])
    assert manager.image(first)['tags'] == ['Keep']


@pytest.mark.parametrize('values', [[''], [' '], ['x' * 61], [4], 'tag', ['x'] * 21])
def test_add_tags_validates_tags_and_rejects_ambiguous_replacement(setup, values):
    manager, _, _, _, _ = setup
    identifier = manager.query()['images'][0]['id']
    with pytest.raises(ValueError): manager.metadata([identifier], add_tags=values)
    with pytest.raises(ValueError, match='either replacing'):
        manager.metadata([identifier], tags=['Replace'], add_tags=['Add'])
    assert manager.image(identifier)['tags'] == []


def test_saved_hiding_persists_through_restart_rescan_and_tag_changes(setup):
    manager, source, _, src, _ = setup
    before = {file: file.read_bytes() for file in source.rglob('*') if file.is_file()}
    rows = manager.query(sort='name')['images']
    manager.metadata([rows[0]['id']], tags=['Done'], favorite=True)
    manager.metadata([rows[1]['id']], hidden=True)
    assert manager.hide_tagged(src) == {'ok': True, 'updated': 1}
    assert manager.hide_tagged(src)['updated'] == 0
    assert manager.query()['total'] == 1
    assert manager.query(visibility='hidden')['total'] == 2
    assert manager.query(visibility='all')['total'] == 3
    assert manager.state()['summary']['hidden'] == 2
    manager.metadata([rows[0]['id']], tags=[])
    restored = ImageManager(manager.directory)
    assert run(restored, 'scan', folder_ids=[src], recursive=True)['status'] == 'complete'
    assert restored.query()['total'] == 1
    assert restored.query(visibility='hidden', limit=1, offset=1)['total'] == 2
    assert restored.image(rows[0]['id'])['favorite'] == 1
    restored.metadata([row['id'] for row in rows], hidden=False)
    assert restored.query()['total'] == 3
    assert restored.query(visibility='hidden')['total'] == 0
    assert before == {file: file.read_bytes() for file in source.rglob('*') if file.is_file()}


def test_hide_tagged_covers_whole_folder_beyond_selection_limit(setup):
    manager, _, _, src, dest = setup
    with manager.database() as db:
        template = dict(db.execute('SELECT * FROM images LIMIT 1').fetchone())
        columns = ','.join(template)
        records = [{**template, 'id': f'bulk-{index}', 'key': f'bulk-path-{index}', 'relative': f'{index}.png', 'folder_id': src, 'tags': '["Done"]', 'hidden': 0} for index in range(1005)]
        records.append({**template, 'id': 'other-folder', 'key': 'other-folder-key', 'folder_id': dest, 'tags': '["Done"]', 'hidden': 0})
        db.executemany(f"INSERT INTO images({columns}) VALUES({','.join('?' for _ in template)})", [tuple(record.values()) for record in records])
    assert manager.hide_tagged(src)['updated'] == 1005
    assert manager.query(folder_id=src, visibility='hidden', limit=48, offset=1000)['total'] == 1005
    assert manager.query(folder_id=dest)['total'] == 1
    assert manager.hide_tagged()['updated'] == 1
    with pytest.raises(ValueError): manager.hide_tagged('unknown-folder')
    with pytest.raises(ValueError): manager.query(visibility='invalid')


def test_hidden_metadata_validates_all_ids_before_updating(setup):
    manager, _, _, _, _ = setup
    identifier = manager.query()['images'][0]['id']
    with pytest.raises(ValueError): manager.metadata([identifier, 'unknown'], hidden=True)
    with pytest.raises(ValueError): manager.metadata([identifier], hidden='true')
    assert manager.query()['total'] == 3


def test_catalog_visibility_migration_preserves_existing_metadata(tmp_path):
    directory = tmp_path / 'old-catalog'; directory.mkdir()
    with sqlite3.connect(directory / 'catalog.sqlite3') as db:
        db.execute("CREATE TABLE images(id TEXT PRIMARY KEY,folder_id TEXT,relative TEXT,key TEXT,bytes INTEGER,width INTEGER,height INTEGER,format TEXT,date TEXT,date_source TEXT,signature TEXT,sha256 TEXT,available INTEGER DEFAULT 1,favorite INTEGER DEFAULT 0,tags TEXT DEFAULT '[]',seen TEXT)")
        db.execute("INSERT INTO images(id,available,favorite,tags) VALUES('existing',1,1,'[\"Reviewed\"]')")
    manager = ImageManager(directory)
    with manager.database() as db:
        row = dict(db.execute('SELECT * FROM images').fetchone())
        assert row['hidden'] == 0 and row['favorite'] == 1 and json.loads(row['tags']) == ['Reviewed']
    assert manager.hide_tagged()['updated'] == 1
    assert ImageManager(directory).state()['summary']['hidden'] == 1


def test_saved_visibility_api_and_restore(setup, monkeypatch):
    from routes import image_manager as routes
    manager, _, _, src, _ = setup
    monkeypatch.setattr(routes, 'manager', manager)
    app = FastAPI(); app.include_router(routes.router); client = TestClient(app)
    identifier = manager.query()['images'][0]['id']
    manager.metadata([identifier], tags=['Reviewed'])
    assert client.post('/image-manager/visibility/hide-tagged', json={'folder_id': src}).json()['updated'] == 1
    assert client.get('/image-manager/images').json()['total'] == 2
    assert client.get('/image-manager/images?visibility=hidden').json()['images'][0]['id'] == identifier
    assert client.get('/image-manager/images?visibility=bad').status_code == 422
    assert client.post('/image-manager/visibility/hide-tagged', json={'folder_id': 'unknown'}).status_code == 422
    assert client.patch('/image-manager/metadata', json={'ids': [identifier], 'hidden': False}).status_code == 200
    assert client.get('/image-manager/images').json()['total'] == 3


@pytest.mark.parametrize('members,mode,count', [('extra', 'move', 1), ('all', 'move', 2), ('all', 'copy', 2)])
def test_duplicate_folder_plans_keep_or_send_requested_members_and_skip_destination_on_scan(setup, members, mode, count):
    manager, source, _, src, _ = setup
    before = {file: file.read_bytes() for file in source.rglob('*') if file.is_file()}
    job = run(manager, 'duplicate-plan', folder_ids=[src], mode=mode, duplicate_members=members)
    assert job['status'] == 'complete', job
    plan = manager.plan(job['result']['plan_id'])
    assert plan['kind'] == 'duplicates' and len(plan['entries']) == count
    assert Path(plan['destination']) == source / 'Duplicates'
    assert list((source / 'Duplicates').iterdir()) == []
    assert all(file.read_bytes() == value for file, value in before.items())
    assert len(plan['kept']) == (1 if members == 'extra' else 0)
    assert run(manager, 'apply', plan_id=plan['id'], confirmation=f'{mode.upper()} {count}')['status'] == 'complete'
    for item in plan['entries']:
        assert Path(item['target']).read_bytes() == before[Path(item['source'])]
        assert Path(item['source']).exists() == (mode == 'copy')
    for path in plan['kept']: assert Path(path).exists()
    assert (source / 'other.webp').exists()
    assert (source / 'motion.gif').exists()
    assert run(manager, 'scan', folder_ids=[src], recursive=True)['status'] == 'complete'
    assert manager.query(folder_id=src)['total'] == (3 if mode == 'copy' else 3 - count)
    if mode == 'move':
        next_job = run(manager, 'duplicate-plan', folder_ids=[src], mode=mode, duplicate_members=members)
        assert next_job['status'] == 'failed'
        assert 'No exact duplicates' in next_job['message']
    else:
        second = manager.plan(run(manager, 'duplicate-plan', folder_ids=[src], mode=mode, duplicate_members=members)['result']['plan_id'])
        assert all(' (2)' in Path(item['target']).name for item in second['entries'])


def test_duplicate_plan_rechecks_hashes_and_refuses_changed_kept_original(setup):
    manager, source, _, src, _ = setup
    assert run(manager, 'duplicates', folder_ids=[src])['status'] == 'complete'
    job = run(manager, 'duplicate-plan', folder_ids=[src], mode='move', duplicate_members='extra')
    plan = manager.plan(job['result']['plan_id'])
    Path(plan['kept'][0]).write_bytes(b'changed retained image')
    applied = run(manager, 'apply', plan_id=plan['id'], confirmation='MOVE 1')
    assert applied['status'] == 'failed'
    assert Path(plan['entries'][0]['source']).exists()
    assert not Path(plan['entries'][0]['target']).exists()


def test_duplicate_function_prepares_review_only_and_bounds_to_one_source(setup):
    manager, source, _, src, dest = setup
    recipe = manager.save_function({'name': 'Separate duplicates', 'folder_ids': [src], 'mode': 'move', 'duplicate_members': 'all', 'steps': ['scan', 'duplicate-plan']})
    job = run(manager, 'function', function_id=recipe['id'])
    assert job['status'] == 'complete'
    assert manager.plan(job['result']['plan_id'])['status'] == 'ready'
    assert (source / 'a.png').exists() and (source / 'holiday/a.png').exists()
    assert not list((source / 'Duplicates').iterdir())
    with pytest.raises(ValueError, match='one source'): manager.save_function({**recipe, 'folder_ids': [src, dest]})
    with pytest.raises(ValueError): manager.start('duplicate-plan', {'folder_ids': [dest], 'mode': 'move'})
    with pytest.raises(ValueError): manager.start('duplicate-plan', {'folder_ids': [src], 'mode': 'move', 'duplicate_members': 'delete'})


def test_duplicate_destination_file_or_junction_and_stale_sources_never_transferred(setup, tmp_path):
    manager, source, _, src, _ = setup
    destination = source / 'Duplicates'; destination.write_bytes(b'keep existing file')
    with pytest.raises(ValueError, match='occupied'): manager.start('duplicate-plan', {'folder_ids': [src], 'mode': 'move'})
    assert destination.read_bytes() == b'keep existing file'; destination.unlink()
    target = tmp_path / 'elsewhere'; target.mkdir()
    try: destination.symlink_to(target, target_is_directory=True)
    except OSError:
        if os.name != 'nt': raise
        import _winapi
        _winapi.CreateJunction(str(target), str(destination))
    with pytest.raises(ValueError, match='links'): manager.start('duplicate-plan', {'folder_ids': [src], 'mode': 'move'})
    os.rmdir(destination)
    (source / 'a.png').write_bytes(b'modified after scan')
    job = run(manager, 'duplicate-plan', folder_ids=[src], mode='move')
    assert job['status'] == 'failed'
    assert (source / 'holiday/a.png').exists() and not destination.exists()


@pytest.mark.parametrize('members,mode', [('all', 'copy'), ('all', 'move'), ('extra', 'copy'), ('extra', 'move')])
def test_large_duplicate_sets_continue_in_reviewed_batches(setup, monkeypatch, members, mode):
    from services import image_manager as service
    manager, source, _, src, _ = setup
    shutil.copy2(source / 'a.png', source / 'b.png'); shutil.copy2(source / 'a.png', source / 'c.png')
    assert run(manager, 'scan', folder_ids=[src], recursive=True)['status'] == 'complete'
    monkeypatch.setattr(service, 'MAX_PLAN', 2)
    first = manager.plan(run(manager, 'duplicate-plan', folder_ids=[src], mode=mode, duplicate_members=members)['result']['plan_id'])
    assert len(first['entries']) == 2 and first['duplicate_total'] == (4 if members == 'all' else 3)
    assert first['duplicate_remaining'] == (2 if members == 'all' else 1)
    assert run(manager, 'apply', plan_id=first['id'], confirmation=f'{mode.upper()} 2')['status'] == 'complete'
    second = manager.plan(run(manager, 'duplicate-plan', folder_ids=[src], mode=mode, duplicate_members=members, duplicate_offset=2 if mode == 'copy' else 0)['result']['plan_id'])
    assert second['duplicate_remaining'] == 0
    assert {item['id'] for item in first['entries']}.isdisjoint(item['id'] for item in second['entries'])
    assert run(manager, 'apply', plan_id=second['id'], confirmation=f'{mode.upper()} {len(second["entries"])}')['status'] == 'complete'
    if mode == 'move': assert manager.query(folder_id=src)['total'] == (1 if members == 'all' else 2)
    else: assert manager.query(folder_id=src)['total'] == 5
