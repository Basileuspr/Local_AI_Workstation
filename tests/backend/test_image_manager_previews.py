"""Repeated folder browsing cannot accumulate original copies or preview files."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
import pytest

from services.image_manager import ImageManager
from services.image_manager_previews import PreviewCache


@pytest.fixture
def catalog(tmp_path):
    source = tmp_path / 'source'; source.mkdir()
    for index in range(4):
        Image.new('RGBA', (640, 480), (index * 60, 50, 150, 120)).save(source / f'{index}.png')
    manager = ImageManager(tmp_path / 'catalog')
    folder = manager.add_folder(str(source))['id']
    manager.start('scan', {'folder_ids': [folder]}); manager.worker.join(10)
    assert manager.state()['job']['status'] == 'complete'
    rows = manager.query(sort='name')['images']
    return manager, source, folder, [row['id'] for row in rows]


def test_repeated_scans_and_browsing_only_write_catalog(catalog):
    manager, source, folder, ids = catalog
    originals = {p: p.read_bytes() for p in source.iterdir()}
    for _ in range(3):
        for identifier in ids:
            for size in (320, 1280):
                with Image.open(BytesIO(manager.thumbnail(identifier, size))) as preview:
                    assert preview.format == 'JPEG' and max(preview.size) <= size
        manager.start('scan', {'folder_ids': [folder]}); manager.worker.join(10)
        assert manager.state()['job']['status'] == 'complete'
    assert originals == {p: p.read_bytes() for p in source.iterdir()}
    assert all(p.name.startswith('catalog.sqlite3') for p in manager.directory.iterdir())
    assert manager.query()['total'] == len(ids)
    assert not manager.state()['receipts']


def test_item_limit_lru_and_memory_hits(catalog, monkeypatch):
    manager, _, _, ids = catalog
    manager.previews = PreviewCache(max_items=2)
    first = manager.thumbnail(ids[0]); manager.thumbnail(ids[1])
    assert manager.thumbnail(ids[0]) is first
    manager.thumbnail(ids[2])
    assert {key[0] for key in manager.previews.entries} == {ids[0], ids[2]}
    def unexpected_decode(*args, **kwargs):
        pytest.fail('A cached preview should not decode the source again')
    monkeypatch.setattr('services.image_manager_previews.Image.open', unexpected_decode)
    assert manager.thumbnail(ids[0]) is first


def test_byte_budget_and_oversized_preview_not_retained(catalog):
    manager, _, _, ids = catalog
    sample = manager.thumbnail(ids[0])
    manager.previews = PreviewCache(max_bytes=len(sample) * 2)
    for identifier in ids:
        manager.thumbnail(identifier)
        assert manager.previews.bytes == sum(map(len, manager.previews.entries.values()))
        assert manager.previews.bytes <= manager.previews.max_bytes
    manager.previews = PreviewCache(max_bytes=1)
    assert manager.thumbnail(ids[0]).startswith(b'\xff\xd8')
    assert manager.previews.bytes == 0 and not manager.previews.entries


@pytest.mark.parametrize('change', ['missing', 'changed', 'forgotten'])
def test_cached_preview_revalidates_original(catalog, change):
    manager, source, folder, ids = catalog
    manager.thumbnail(ids[0])
    if change == 'missing': (source / '0.png').unlink()
    elif change == 'changed': (source / '0.png').write_bytes(b'changed fixture')
    else: manager.forget_folder(folder)
    with pytest.raises(ValueError): manager.thumbnail(ids[0])


def test_old_disk_previews_are_ignored_and_preserved(catalog):
    manager, _, _, ids = catalog
    legacy = manager.directory / 'thumbnails'; legacy.mkdir()
    old = legacy / ('a' * 64 + '.jpg'); old.write_bytes(b'legacy fixture')
    assert manager.thumbnail(ids[0]).startswith(b'\xff\xd8')
    assert list(legacy.iterdir()) == [old] and old.read_bytes() == b'legacy fixture'


def test_concurrent_browsing_stays_bounded_and_creates_no_files(catalog):
    manager, _, _, ids = catalog
    manager.previews = PreviewCache(max_items=2, max_bytes=10000)
    with ThreadPoolExecutor(max_workers=8) as pool:
        images = list(pool.map(manager.thumbnail, ids * 4))
    assert all(image.startswith(b'\xff\xd8') for image in images)
    assert len(manager.previews.entries) <= 2 and manager.previews.bytes <= 10000
    assert manager.previews.bytes == sum(map(len, manager.previews.entries.values()))
    assert not (manager.directory / 'thumbnails').exists()


def test_api_returns_bytes_without_disk_sidecars_and_checks_locked_hits(catalog, monkeypatch):
    from routes import image_manager as routes
    from services import image_vault
    manager, _, _, ids = catalog
    monkeypatch.setattr(routes, 'manager', manager)
    monkeypatch.setattr(image_vault, 'guard_path', lambda path: None)
    app = FastAPI(); app.include_router(routes.router)
    with TestClient(app) as client:
        for query in ('', '?large=true'):
            result = client.get(f'/image-manager/images/{ids[0]}/thumbnail{query}')
            assert result.status_code == 200 and result.headers['content-type'] == 'image/jpeg'
            assert result.headers['cache-control'] == 'no-store'
            assert result.content.startswith(b'\xff\xd8')
        def locked(path): raise image_vault.LockedImageError('locked fixture')
        monkeypatch.setattr(image_vault, 'guard_path', locked)
        assert client.get(f'/image-manager/images/{ids[0]}/thumbnail').status_code == 403
    assert not (manager.directory / 'thumbnails').exists()
