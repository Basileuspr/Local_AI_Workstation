"""Catalog continuity without exporting, using disposable source images only."""
from dataclasses import replace
from pathlib import Path
import hashlib
import json
import os
import sqlite3
import subprocess
import sys

from PIL import Image
import pytest
import config
import maintenance
import backup_import
from services import image_manager, image_manager_storage as storage


@pytest.fixture
def library(tmp_path, monkeypatch):
    root = tmp_path / 'app-data'; root.mkdir()
    source = tmp_path / 'external-images'; source.mkdir()
    for name, color in [('photo.png', 'red'), ('hidden.png', 'blue')]:
        Image.new('RGB', (20, 12), color).save(source / name)
    (root / 'private.txt').write_text('Resettable fixture')
    settings = replace(config.settings, data_dir=root, image_manager_storage_dir=None)
    for module in [config, image_manager, maintenance]:
        monkeypatch.setattr(module, 'settings', settings)
    legacy = image_manager.ImageManager(root / 'image_manager')
    folder = legacy.add_folder(str(source))
    legacy.start('scan', {'folder_ids': [folder['id']]})
    legacy.worker.join(10)
    assert legacy.state()['job']['status'] == 'complete'
    rows = {row['relative']: row for row in legacy.query()['images']}
    legacy.metadata([rows['photo.png']['id']], tags=['Saved fixture'], favorite=True)
    legacy.metadata([rows['hidden.png']['id']], tags=['Hidden fixture'], hidden=True)
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in source.iterdir()}
    return root, legacy, rows, hashes


def assert_library(rows, hashes):
    current = image_manager.ImageManager()
    assert current.state()['job'] is None
    visible = current.query()['images']
    hidden = current.query(visibility='hidden')['images']
    assert len(visible) == len(hidden) == 1
    assert visible[0]['id'] == rows['photo.png']['id']
    assert visible[0]['tags'] == ['Saved fixture'] and visible[0]['favorite']
    assert hidden[0]['id'] == rows['hidden.png']['id']
    assert hidden[0]['tags'] == ['Hidden fixture'] and hidden[0]['hidden']
    for image in visible + hidden:
        _, path = current.image_path(image['id'])
        assert hashlib.sha256(path.read_bytes()).hexdigest() == hashes[path]
    assert current.thumbnail(visible[0]['id']).startswith(b'\xff\xd8')
    return current


def test_default_storage_migrates_legacy_catalog_automatically(library):
    root, legacy, rows, hashes = library
    current = assert_library(rows, hashes)
    assert not current.directory.is_relative_to(root)
    assert current.directory == storage.storage_directory(root)
    assert legacy.directory.joinpath('catalog.sqlite3').is_file()


def test_desktop_location_migrates_direct_backend_store_after_reset(library, monkeypatch):
    root, _, rows, hashes = library
    current = assert_library(rows, hashes)
    prior = current.directory
    maintenance.reset_data(confirmation='RESET', root=root)
    desktop = root.parent / 'desktop-profile/image-manager'
    settings = replace(config.settings, image_manager_storage_dir=desktop)
    for module in [config, image_manager, maintenance]:
        monkeypatch.setattr(module, 'settings', settings)
    restarted = assert_library(rows, hashes)
    assert restarted.directory == desktop
    assert (prior / 'catalog.sqlite3').is_file()


def test_save_metadata_and_reset_keep_library_without_any_content_export(library):
    root, _, rows, hashes = library
    archive = root.parent / 'metadata-only.zip'
    maintenance.export_inventory(archive, root)
    # No opening of the new manager or full backup before reset: maintenance
    # must migrate the pre-existing catalog before removing any app data.
    maintenance.reset_data(confirmation='RESET', root=root)
    assert not (root / 'private.txt').exists()
    assert not (root / 'image_manager').exists()
    assert_library(rows, hashes)


def test_restart_in_fresh_process_keeps_library_after_reset_without_export(library):
    root, _, rows, hashes = library
    maintenance.reset_data(confirmation='RESET', root=root)
    assert_library(rows, hashes)
    script = "from services.image_manager import manager; import json; print(json.dumps({'images': manager.query(visibility='all')['total'], 'favorite': manager.query(favorite=True)['total'], 'hidden': manager.query(visibility='hidden')['total']}))"
    environment = {**os.environ, 'LAW_DATA_DIR': str(root), 'LAW_IMAGE_MANAGER_DIR': str(storage.storage_directory(root)), 'PYTHONPATH': str(Path(config.__file__).parent), 'PYTHONUTF8': '1'}
    result = subprocess.run([sys.executable, '-B', '-c', script], env=environment, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {'images': 2, 'favorite': 1, 'hidden': 1}


def test_import_without_any_catalog_preserves_current_library_without_export(library):
    root, _, rows, hashes = library
    empty = root.parent / 'empty-app-data'; empty.mkdir()
    (empty / 'imported.txt').write_text('Imported fixture')
    exported = maintenance.export_backup(root.parent / 'unrelated-backup.zip', {}, empty)
    reviewed = backup_import.validate_backup(exported['archive'], root)
    backup_import.import_backup(exported['archive'], reviewed['sha256'], 'IMPORT', {}, root)
    backup_import.finish_import(root)
    assert (root / 'imported.txt').is_file() and not (root / 'private.txt').exists()
    assert_library(rows, hashes)


def test_older_imported_catalog_cannot_replace_current_saved_metadata(library):
    root, _, rows, hashes = library
    current = assert_library(rows, hashes)
    exported = maintenance.export_backup(root.parent / 'older.zip', {}, root)
    current.metadata([rows['photo.png']['id']], tags=['Saved fixture', 'Newer edit'])
    reviewed = backup_import.validate_backup(exported['archive'], root)
    backup_import.import_backup(exported['archive'], reviewed['sha256'], 'IMPORT', {}, root)
    backup_import.finish_import(root)
    restarted = image_manager.ImageManager()
    assert restarted.query()['images'][0]['tags'] == ['Saved fixture', 'Newer edit']
    assert restarted.query()['images'][0]['favorite']
    assert restarted.query(visibility='hidden')['total'] == 1
    assert all(hashlib.sha256(path.read_bytes()).hexdigest() == digest for path, digest in hashes.items())


def test_migration_preserves_committed_wal_data(library):
    root, legacy, rows, _ = library
    with legacy.database() as db:
        db.execute('UPDATE images SET tags=? WHERE id=?', (json.dumps(['Committed WAL fixture']), rows['photo.png']['id']))
        db.commit()
        assert (legacy.directory / 'catalog.sqlite3-wal').exists()
        storage.ensure_catalog(root)
        assert image_manager.ImageManager().query()['images'][0]['tags'] == ['Committed WAL fixture']


def test_interrupted_migration_keeps_legacy_and_can_retry(library, monkeypatch):
    root, _, rows, hashes = library
    connect = sqlite3.connect
    class Interrupted:
        def __init__(self, db): self.db = db
        def __getattr__(self, name): return getattr(self.db, name)
        def backup(self, saved): raise OSError('Fixture interruption')
    def open_db(path, *args, **kwargs):
        db = connect(path, *args, **kwargs)
        return Interrupted(db) if '?mode=ro' in str(path) else db
    monkeypatch.setattr(storage.sqlite3, 'connect', open_db)
    with pytest.raises(OSError, match='interruption'):
        storage.ensure_catalog(root)
    assert (root / 'image_manager/catalog.sqlite3').is_file()
    assert not (storage.storage_directory(root) / 'catalog.sqlite3').exists()
    assert not list(storage.storage_directory(root).glob('catalog-migration-*'))
    monkeypatch.setattr(storage.sqlite3, 'connect', connect)
    assert_library(rows, hashes)


def test_catalog_storage_cannot_overlap_app_data(library):
    root, _, _, _ = library
    for path in [root, root / 'image_manager', root.parent]:
        with pytest.raises(ValueError, match='separate from app data'):
            storage.ensure_catalog(root, path)


def test_corrupt_legacy_catalog_refuses_reset_without_erasing_other_data(library):
    root, _, _, _ = library
    (root / 'image_manager/catalog.sqlite3').write_bytes(b'Broken fixture database')
    with pytest.raises(sqlite3.Error):
        maintenance.reset_data(confirmation='RESET', root=root)
    assert (root / 'private.txt').is_file()


def test_corrupt_independent_catalog_does_not_erase_legacy_recovery_copy(library):
    root, _, rows, hashes = library
    current = assert_library(rows, hashes)
    (current.directory / 'catalog.sqlite3').write_bytes(b'Broken persistent fixture')
    with pytest.raises(sqlite3.Error):
        maintenance.reset_data(confirmation='RESET', root=root)
    assert (root / 'private.txt').is_file()
    assert (root / 'image_manager/catalog.sqlite3').is_file()


def test_interrupted_reset_keeps_independent_catalog_and_can_retry(library, monkeypatch):
    root, _, rows, hashes = library
    remove = maintenance.shutil.rmtree
    monkeypatch.setattr(maintenance.shutil, 'rmtree', lambda path: (_ for _ in ()).throw(PermissionError('Fixture interruption')))
    with pytest.raises(RuntimeError, match='incomplete'):
        maintenance.reset_data(confirmation='RESET', root=root)
    assert (root / maintenance.MARKER).exists()
    assert_library(rows, hashes)
    monkeypatch.setattr(maintenance.shutil, 'rmtree', remove)
    maintenance.reset_data(confirmation='RESET', root=root)
    assert_library(rows, hashes)


def test_backup_catalog_can_seed_a_fresh_store_without_replacing_an_existing_one(library):
    root, _, rows, hashes = library
    assert_library(rows, hashes)
    exported = maintenance.export_backup(root.parent / 'catalog-backup.zip', {}, root)
    # Disposable fixture emulates a fresh installation, retaining the prior
    # store separately instead of deleting it.
    maintenance.reset_data(confirmation='RESET', root=root)
    directory = storage.storage_directory(root)
    directory.rename(root.parent / 'original-catalog')
    reviewed = backup_import.validate_backup(exported['archive'], root)
    backup_import.import_backup(exported['archive'], reviewed['sha256'], 'IMPORT', {}, root)
    backup_import.finish_import(root)
    assert_library(rows, hashes)
