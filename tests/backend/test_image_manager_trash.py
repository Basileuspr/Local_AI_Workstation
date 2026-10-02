import hashlib
import json
import os
import shutil
from pathlib import Path

import pytest
from PIL import Image
from services.image_manager import ImageManager
from services import image_manager_trash as trash


def run(manager, kind, **payload):
    manager.start(kind, payload); manager.worker.join(15)
    assert not manager.worker.is_alive()
    return manager.state()['job']


@pytest.fixture
def catalog(tmp_path):
    source = tmp_path / 'photos'; source.mkdir()
    Image.new('RGB', (32, 24), 'red').save(source / 'keep.png')
    shutil.copy2(source / 'keep.png', source / 'extra.png')
    Image.new('RGB', (32, 24), 'blue').save(source / 'irrelevant.png')
    manager = ImageManager(tmp_path / 'catalog')
    folder = manager.add_folder(str(source))['id']
    assert run(manager, 'scan', folder_ids=[folder])['status'] == 'complete'
    return manager, source, folder


def test_delete_review_is_read_only_then_restore_preserves_hash_metadata(catalog):
    manager, source, folder = catalog
    row = next(row for row in manager.query()['images'] if row['relative'] == 'extra.png')
    manager.metadata([row['id']], favorite=True, tags=['Trip'])
    before = (source / 'extra.png').read_bytes()
    review = manager.review_trash('delete', [row['id']])
    assert (source / 'extra.png').read_bytes() == before
    assert manager.trash()['entries'] == []
    assert run(manager, 'trash', review_id=review['id'], confirmation='DELETE 1')['status'] == 'complete'
    assert not (source / 'extra.png').exists() and (source / 'keep.png').read_bytes() == before
    assert manager.query()['total'] == 2
    entry = manager.trash()['entries'][0]; assert Path(entry['trash_path']).read_bytes() == before
    assert run(manager, 'scan', folder_ids=[folder])['status'] == 'complete'
    assert manager.query()['total'] == 2
    with pytest.raises(ValueError, match='Trash'): manager.forget_folder(folder)
    with pytest.raises(ValueError, match='Trash'): manager.add_folder(str(Path(entry['trash_path']).parent))
    restarted = ImageManager(manager.directory)
    restore = restarted.review_trash('restore', [entry['id']])
    assert run(restarted, 'trash', review_id=restore['id'], confirmation='RESTORE 1')['status'] == 'complete'
    assert (source / 'extra.png').read_bytes() == before
    assert restarted.trash()['entries'] == []
    restored = restarted.image(row['id']); assert restored['favorite'] and restored['tags'] == ['Trip']


def test_selection_and_confirmation_are_required(catalog):
    manager, source, _ = catalog
    ids = [row['id'] for row in manager.query()['images'][:2]]
    for invalid in ([], [ids[0], ids[0]], ['unknown']):
        with pytest.raises(ValueError): manager.review_trash('delete', invalid)
    review = manager.review_trash('delete', ids)
    for word in ('DELETE', 'DELETE 1', 'COPY 2', ''):
        with pytest.raises(ValueError, match='confirmation'): manager.start('trash', dict(review_id=review['id'], confirmation=word))
    assert len(list(source.glob('*.png'))) == 3


def test_changed_review_blocks_whole_batch_even_if_timestamp_is_restored(catalog):
    manager, source, _ = catalog
    rows = sorted(manager.query()['images'], key=lambda row: row['relative'])
    review = manager.review_trash('delete', [row['id'] for row in rows])
    path = source / rows[-1]['relative']; stamp = path.stat(); content = bytearray(path.read_bytes()); content[-1] ^= 1
    path.write_bytes(content); os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    job = run(manager, 'trash', review_id=review['id'], confirmation='DELETE 3')
    assert job['status'] == 'failed' and 'changed' in job['message']
    assert len(list(source.glob('*.png'))) == 3 and not manager.trash()['entries']


def test_restore_never_overwrites_existing_file(catalog):
    manager, source, _ = catalog; row = manager.query()['images'][0]
    review = manager.review_trash('delete', [row['id']]); run(manager, 'trash', review_id=review['id'], confirmation='DELETE 1')
    entry = manager.trash()['entries'][0]; original = Path(entry['original_path']); original.write_bytes(b'new occupant')
    with pytest.raises(ValueError, match='overwritten'): manager.review_trash('restore', [entry['id']])
    assert original.read_bytes() == b'new occupant' and Path(entry['trash_path']).exists()


def test_copy_fallback_retains_original_on_failure_and_recovers_interrupted_delete(catalog, monkeypatch):
    manager, source, _ = catalog; row = manager.query()['images'][0]
    monkeypatch.setattr(trash.os, 'link', lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError('no hard links')))
    review = manager.review_trash('delete', [row['id']]); assert run(manager, 'trash', review_id=review['id'], confirmation='DELETE 1')['status'] == 'complete'
    entry = manager.trash()['entries'][0]
    entry['phase'] = 'pending'; trash.write_entry(manager, entry)
    with manager.database() as db: db.execute('UPDATE images SET available=1 WHERE id=?', (row['id'],))
    restarted = ImageManager(manager.directory)
    assert restarted.state()['summary']['trash'] == 1
    assert restarted.image(row['id'])['available'] == 0
    assert hashlib.sha256(Path(entry['trash_path']).read_bytes()).hexdigest() == entry['sha256']


def test_permanent_deletion_requires_separate_review_and_never_touches_other_copies(catalog):
    manager, source, _ = catalog
    row = next(row for row in manager.query()['images'] if row['relative'] == 'extra.png')
    before = (source / 'keep.png').read_bytes()
    with pytest.raises(ValueError): manager.review_trash('purge', [row['id']])
    review = manager.review_trash('delete', [row['id']]); run(manager, 'trash', review_id=review['id'], confirmation='DELETE 1')
    entry = manager.trash()['entries'][0]; location = Path(entry['trash_path'])
    review = manager.review_trash('purge', [entry['id']]); assert location.exists()
    with pytest.raises(ValueError): manager.start('trash', dict(review_id=review['id'], confirmation='DELETE 1'))
    assert run(manager, 'trash', review_id=review['id'], confirmation='DELETE FOREVER 1')['status'] == 'complete'
    assert not location.exists() and not manager.trash()['entries']
    assert (source / 'keep.png').read_bytes() == before


def test_state_poll_does_not_recover_a_journal_owned_by_running_worker(catalog):
    manager, _, _ = catalog; row = manager.query()['images'][0]
    review = manager.review_trash('delete', [row['id']])
    assert run(manager, 'trash', review_id=review['id'], confirmation='DELETE 1')['status'] == 'complete'
    entry = manager.trash()['entries'][0]; entry['phase'] = 'pending'; trash.write_entry(manager, entry)
    with manager.database() as db: db.execute('UPDATE images SET available=1 WHERE id=?', (row['id'],))
    manager.job = {'status': 'running'}
    assert manager.state()['summary']['trash'] == 1
    assert manager.trash()['entries'][0]['phase'] == 'pending'
    assert manager.image(row['id'])['available'] == 1
    manager.job = None
    assert manager.trash()['entries'][0]['phase'] == 'trashed'
    assert manager.image(row['id'])['available'] == 0
