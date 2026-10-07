"""Reset/import checks using only disposable images and private fixture data."""
from pathlib import Path
import hashlib
import json
import sqlite3
import zipfile

import pytest
from PIL import Image

import maintenance
import backup_import
from services import image_manager, image_manager_maintenance as retention


def run(manager, kind, **options):
    manager.start(kind, options)
    manager.worker.join(10)
    assert not manager.worker.is_alive()
    job = manager.state()['job']
    assert job['status'] == 'complete', job['message']
    return job['result']


@pytest.fixture
def catalog(tmp_path):
    root = tmp_path / 'app-data'; root.mkdir()
    source = tmp_path / 'external-images'; source.mkdir()
    output = tmp_path / 'external-output'; output.mkdir()
    internal = root / 'generated_images'; internal.mkdir()
    for path, color in [(source / 'photo.png', 'red'), (source / 'hidden.png', 'blue'), (source / 'deleted.png', 'green'), (internal / 'private.png', 'yellow')]:
        Image.new('RGB', (24, 16), color).save(path)
    (root / 'sessions').mkdir(); (root / 'sessions/private.json').write_text('Private fixture chat')
    manager = image_manager.ImageManager(root / 'image_manager')
    source_id = manager.add_folder(str(source))['id']
    output_id = manager.add_folder(str(output), 'output')['id']
    private_id = manager.add_folder(str(internal))['id']
    run(manager, 'scan', folder_ids=[source_id, private_id], recursive=True)
    images = {row['relative']: row for row in manager.query()['images']}
    manager.metadata([images['photo.png']['id']], tags=['Fixture tag'], favorite=True)
    manager.metadata([images['hidden.png']['id']], tags=['Hidden fixture'], hidden=True)
    manager.metadata([images['private.png']['id']], tags=['APP_PRIVATE_SECRET'])
    plan_id = run(manager, 'plan', ids=[images['photo.png']['id']], output_id=output_id, mode='move', layout='folders')['plan_id']
    plan = manager.plan(plan_id)
    run(manager, 'apply', plan_id=plan_id, confirmation=f"MOVE {len(plan['entries'])}")
    review = manager.review_trash('delete', [images['deleted.png']['id']])
    run(manager, 'trash', review_id=review['id'], confirmation=review['confirmation'])
    manager.thumbnail(images['hidden.png']['id'])
    before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for folder in [source, output] for path in folder.rglob('*') if path.is_file()}
    return root, source, output, manager, images, before


def assert_retained(root, images, before, directory=None):
    manager = image_manager.ImageManager(directory or root / 'image_manager')
    visible = [row for row in manager.query()['images'] if row['id'] != images['private.png']['id']]
    assert [row['id'] for row in visible] == [images['photo.png']['id']]
    assert visible[0]['tags'] == ['Fixture tag'] and visible[0]['favorite']
    _, path = manager.image_path(visible[0]['id'])
    assert path.parent.name == 'external-output'
    hidden = manager.query(visibility='hidden')['images']
    assert [row['id'] for row in hidden] == [images['hidden.png']['id']]
    assert hidden[0]['tags'] == ['Hidden fixture']
    deleted = manager.trash()['entries']
    assert len(deleted) == 1 and deleted[0]['image']['id'] == images['deleted.png']['id']
    assert before == {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in before}
    return manager


def test_keep_external_catalog_survives_reset_including_moves_hidden_and_trash(catalog):
    root, _, _, old, images, before = catalog
    result = maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    assert result['image_manager_retained'] == {'folders': 2, 'images': 3}
    assert not (root / 'sessions').exists() and not (root / 'generated_images').exists()
    assert not (root / 'image_manager/thumbnails').exists()
    assert not (root / retention.STAGE).exists() and not (root / maintenance.MARKER).exists()
    # Deleted app-private paths/tags must not remain in SQLite free pages.
    assert b'APP_PRIVATE_SECRET' not in (root / retention.CATALOG).read_bytes()
    assert str(root / 'generated_images').encode() not in (root / retention.CATALOG).read_bytes()
    manager = assert_retained(root, images, before)
    assert manager.state()['plans'] == [] and manager.state()['receipts'] == []
    thumb = manager.thumbnail(images['hidden.png']['id'])
    assert thumb.startswith(b'\xff\xd8')
    review = manager.review_trash('restore', [manager.trash()['entries'][0]['id']])
    run(manager, 'trash', review_id=review['id'], confirmation=review['confirmation'])
    assert (Path(images['deleted.png']['folder_path']) / 'deleted.png').is_file()


def test_unchecked_retention_still_clears_catalog_without_touching_external_images(catalog):
    root, _, _, _, _, before = catalog
    maintenance.reset_data(confirmation='RESET', root=root)
    assert list(root.iterdir()) == []
    assert before == {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in before}


def test_automatic_independent_catalog_keeps_processed_images_and_recoverable_trash(catalog):
    from services.image_manager_storage import storage_directory
    root, _, _, _, images, before = catalog
    maintenance.reset_data(confirmation='RESET', root=root)
    manager = assert_retained(root, images, before, storage_directory(root))
    assert manager.thumbnail(images['hidden.png']['id']).startswith(b'\xff\xd8')
    review = manager.review_trash('restore', [manager.trash()['entries'][0]['id']])
    run(manager, 'trash', review_id=review['id'], confirmation=review['confirmation'])
    assert (Path(images['deleted.png']['folder_path']) / 'deleted.png').is_file()


def test_full_backup_import_restores_external_catalog_and_manual_metadata(catalog):
    root, _, _, manager, images, before = catalog
    exported = maintenance.export_backup(root.parent / 'backup.zip', {'density': 'extra-comfortable'}, root)
    with zipfile.ZipFile(exported['archive']) as archive:
        assert 'data/image_manager/catalog.sqlite3' in archive.namelist()
        assert not any('external-images' in name for name in archive.namelist())
    maintenance.reset_data(confirmation='RESET', root=root)
    reviewed = backup_import.validate_backup(exported['archive'], root)
    result = backup_import.import_backup(exported['archive'], reviewed['sha256'], 'IMPORT', {}, root)
    backup_import.finish_import(root)
    assert result['desktop_storage'] == {'density': 'extra-comfortable'}
    restored = assert_retained(root, images, before)
    _, private = restored.image_path(images['private.png']['id'])
    assert private.is_file()


def test_interrupted_retaining_reset_reuses_verified_catalog_before_retry(catalog, monkeypatch):
    root, _, _, _, images, before = catalog
    remove = maintenance.shutil.rmtree
    def fail(path):
        if path.name == 'sessions':
            raise PermissionError('Fixture interruption')
        remove(path)
    monkeypatch.setattr(maintenance.shutil, 'rmtree', fail)
    with pytest.raises(RuntimeError, match='incomplete'):
        maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    report = maintenance.inventory(root)
    assert report['reset_pending'] and report['keep_image_manager']
    assert (root / retention.STAGE / 'catalog.sqlite3').is_file()
    with pytest.raises(ValueError, match='original Image Manager retention choice'):
        maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=False)
    monkeypatch.setattr(maintenance.shutil, 'rmtree', remove)
    maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    assert_retained(root, images, before)


def test_interruption_after_catalog_install_can_complete_profile_cleanup(catalog):
    root, _, _, _, images, before = catalog
    maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True, keep_marker=True)
    assert (root / maintenance.MARKER).exists()
    maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    assert_retained(root, images, before)


def test_retained_catalog_tampering_refuses_retry_before_more_deletions(catalog, monkeypatch):
    root, _, _, _, _, _ = catalog
    monkeypatch.setattr(maintenance.shutil, 'rmtree', lambda path: (_ for _ in ()).throw(PermissionError('Fixture interruption')))
    with pytest.raises(RuntimeError):
        maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    staged = root / retention.STAGE / 'catalog.sqlite3'
    with staged.open('ab') as stream:
        stream.write(b'TAMPERED')
    with pytest.raises(ValueError, match='changed'):
        maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    assert (root / 'sessions/private.json').is_file()


def test_crash_during_snapshot_rebuilds_only_journal_owned_staging(catalog):
    root, _, _, _, images, before = catalog
    maintenance.write_atomic(root / maintenance.MARKER, {'version': 3, 'sanitize': True, 'keep_image_manager': True, 'image_manager_preparing': True})
    directory = root / retention.STAGE; directory.mkdir()
    (directory / 'catalog.sqlite3').write_bytes(b'Incomplete fixture snapshot')
    maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    assert_retained(root, images, before)


def test_invalid_catalog_refuses_retention_without_erasing_other_data(catalog):
    root, _, _, _, _, _ = catalog
    (root / retention.CATALOG).write_bytes(b'Corrupt fixture catalog')
    with pytest.raises(sqlite3.Error):
        maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    assert (root / 'sessions/private.json').read_text() == 'Private fixture chat'
    assert not (root / retention.STAGE).exists()


def test_retention_path_overlap_checks_include_windows_extended_spelling(tmp_path):
    root = tmp_path / 'app-data'
    assert not retention.external_path(str(root / 'generated_images'), root)
    assert not retention.external_path(str(root.parent), root)
    assert not retention.external_path(str(root / '..' / 'external'), root)
    assert retention.external_path(str(root.parent / 'external'), root)
    if root.drive:
        assert not retention.external_path('\\\\?\\' + str(root / 'generated_images'), root)


def test_image_manager_worker_blocks_app_maintenance(monkeypatch):
    from services import maintenance_gate
    class Worker:
        def is_alive(self): return True
    monkeypatch.setattr(image_manager.manager, 'worker', Worker())
    assert maintenance_gate.workers_busy()


def test_unowned_retention_stage_is_not_deleted_or_adopted(catalog):
    root, _, _, _, _, _ = catalog
    directory = root / retention.STAGE; directory.mkdir()
    staged = directory / 'catalog.sqlite3'; staged.write_bytes(b'Unrelated fixture data')
    with pytest.raises(ValueError, match='Unexpected'):
        maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    assert staged.read_bytes() == b'Unrelated fixture data'
    assert not (root / maintenance.MARKER).exists()
    assert (root / 'sessions/private.json').is_file()


def test_retention_without_existing_catalog_does_not_create_empty_stage(tmp_path):
    root = tmp_path / 'app-data'; root.mkdir()
    (root / 'fixture.txt').write_text('Resettable fixture')
    result = maintenance.reset_data(confirmation='RESET', root=root, keep_image_manager=True)
    assert result['image_manager_retained'] == {'folders': 0, 'images': 0}
    assert list(root.iterdir()) == []


def test_import_does_not_adopt_changed_external_or_known_hash_mismatch(catalog):
    root, source, _, manager, images, _ = catalog
    internal = root / 'generated_images/private.png'
    manager.metadata([images['private.png']['id']], favorite=True)
    with manager.database() as db:
        db.execute('UPDATE images SET sha256=? WHERE id=?',
                   (hashlib.sha256(internal.read_bytes()).hexdigest(), images['private.png']['id']))
    Image.new('RGB', (24, 16), 'purple').save(internal)
    exported = maintenance.export_backup(root.parent / 'backup.zip', {}, root)
    Image.new('RGB', (24, 16), 'orange').save(source / 'hidden.png')
    reviewed = backup_import.validate_backup(exported['archive'], root)
    backup_import.import_backup(exported['archive'], reviewed['sha256'], 'IMPORT', {}, root)
    backup_import.finish_import(root)
    restored = image_manager.ImageManager(root / 'image_manager')
    for name in ['private.png', 'hidden.png']:
        with pytest.raises(ValueError, match='changed since its scan'):
            restored.image_path(images[name]['id'])
    assert restored.query(visibility='all')['images']
