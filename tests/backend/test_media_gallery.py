import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from routes import image_library as library_routes, media_generation as media_routes
from services import image_library as library, image_vault as vault, media_generation as media


@pytest.fixture
def gallery(tmp_path, monkeypatch):
    monkeypatch.setattr(media, 'OUTPUT_DIR', tmp_path / 'outputs')
    monkeypatch.setattr(media, 'jobs', media.MediaJobs())
    monkeypatch.setattr(library, 'ROOT', tmp_path / 'library')
    monkeypatch.setattr(vault, 'ROOT', tmp_path / 'vault')
    vault.TOKENS.clear()
    app = FastAPI()
    app.include_router(library_routes.router)
    app.include_router(media_routes.router)
    with TestClient(app) as client:
        yield client
    vault.TOKENS.clear()


def saved_job(*, status='completed', kind='image', color='red', created=1):
    identifier = uuid.uuid4().hex
    directory = media.OUTPUT_DIR / identifier
    directory.mkdir(parents=True)
    output = 'output.png' if kind == 'image' else 'output.webm'
    if kind == 'image': Image.new('RGB', (24, 16), color).save(directory / output)
    else: (directory / output).write_bytes(b'video fixture')
    item = {'id': identifier, 'model_id': 'qwen-test', 'name': 'Qwen test', 'kind': kind,
            'status': status, 'created_at': created, 'request': {'prompt': 'Private generation prompt', 'seed': 42},
            'phase': 'Complete', 'output': output}
    media.jobs.save(item)
    if media.jobs.loaded: media.jobs.jobs[identifier] = item
    return item


def images(client):
    response = client.get('/image-library')
    assert response.status_code == 200, response.text
    return response.json()


def test_existing_and_new_qwen_outputs_use_regular_library_images(gallery):
    old = saved_job()
    first = images(gallery)
    assert first['warnings'] == []
    entry, = first['images']
    assert (entry['width'], entry['height'], entry['seed']) == (24, 16, 42)
    assert entry['origin'] == {'kind': 'media-generation', 'job_id': old['id'], 'model_id': 'qwen-test'}
    assert not entry['review_only']
    assert 'Private generation prompt' not in json.dumps(entry)
    original = media.OUTPUT_DIR / old['id'] / 'output.png'
    assert gallery.get(entry['url']).content == original.read_bytes()
    assert library.read_index()['media_imports'][old['id']] == entry['id']
    assert json.loads((original.parent / 'job.json').read_text()) == old
    assert 'media_imports' not in first
    assert images(gallery)['images'][0]['id'] == entry['id']
    saved_job(color='blue', created=2)
    assert len(images(gallery)['images']) == 2


def test_backfill_is_not_limited_to_the_recent_100_jobs(gallery):
    old = saved_job()
    for index in range(100): saved_job(status='failed', created=index + 2)
    assert old['id'] not in {job['id'] for job in media.jobs.snapshots()}
    assert images(gallery)['images'][0]['origin']['job_id'] == old['id']


def test_hide_filing_and_delete_survive_refresh_and_backend_restart(gallery, monkeypatch):
    job = saved_job()
    entry, = images(gallery)['images']
    folder = gallery.post('/image-library/folders', json={'name': 'Qwen favorites'}).json()
    url = f'/image-library/images/{entry["id"]}'
    assert gallery.patch(url, json={'hidden': True, 'folder_ids': [folder['id']], 'rating': 'liked'}).status_code == 200
    monkeypatch.setattr(media, 'jobs', media.MediaJobs())
    refreshed, = images(gallery)['images']
    assert refreshed['hidden'] and refreshed['folder_ids'] == [folder['id']] and refreshed['rating'] == 'liked'
    assert gallery.delete(url).status_code == 200
    monkeypatch.setattr(media, 'jobs', media.MediaJobs())
    assert images(gallery)['images'] == []
    # Gallery owns a copy; the source generation still has its independent lifetime.
    assert gallery.get(f'/media-generation/jobs/{job["id"]}/output').status_code == 200


def test_skips_unfinished_video_and_failed_outputs_without_losing_valid_images(gallery):
    for status in ['queued', 'running', 'cancelled', 'failed']: saved_job(status=status)
    saved_job(kind='video')
    good = saved_job(color='green')
    bad = saved_job(color='blue')
    (media.OUTPUT_DIR / bad['id'] / 'output.png').write_bytes(b'broken PNG')
    result = images(gallery)
    assert [image['origin']['job_id'] for image in result['images']] == [good['id']]
    assert len(result['warnings']) == 1 and bad['id'][:8] in result['warnings'][0]
    Image.new('RGB', (24, 16), 'blue').save(media.OUTPUT_DIR / bad['id'] / 'output.png')
    assert len(images(gallery)['images']) == 2
    assert images(gallery)['warnings'] == []


def test_locking_gallery_copy_also_blocks_original_qwen_preview_and_download(gallery):
    job = saved_job()
    entry, = images(gallery)['images']
    token = vault.setup('12345678')['token']
    data, item = library.image_bytes(entry['id'])
    locked = vault.add(token, data, item['name'], item['origin'])
    assert images(gallery)['images'] == []
    url = f'/media-generation/jobs/{job["id"]}/output'
    assert gallery.get(url).status_code == 403
    assert gallery.get(url + '?download=true').status_code == 403
    vault.restore(token, locked['id'])
    assert len(images(gallery)['images']) == 1
    assert gallery.get(url).status_code == 200
    assert gallery.get(url).headers['cache-control'] == 'no-store'


def test_parallel_refresh_and_failed_receipt_do_not_duplicate_images(gallery, monkeypatch):
    job = saved_job()
    original_save = library.save_index
    monkeypatch.setattr(library, 'save_index', lambda item: (_ for _ in ()).throw(OSError('locked receipt')))
    assert len(images(gallery)['warnings']) == 1
    assert library.read_index()['images'] == []
    assert list((library.ROOT / 'images').glob('*.image')) == []
    monkeypatch.setattr(library, 'save_index', original_save)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda _: media.jobs.sync_gallery(), range(2))) == [[], []]
    assert len(images(gallery)['images']) == 1
    assert library.read_index()['media_imports'][job['id']] == library.read_index()['images'][0]['id']


def test_output_path_rejects_traversal_and_wrong_media_extension(gallery):
    job = saved_job()
    with pytest.raises(ValueError): media.output_path(dict(job, output='../output.png'))
    with pytest.raises(ValueError): media.output_path(dict(job, kind='video'))
    with pytest.raises(ValueError): media.output_path(dict(job, id='../elsewhere'))


def test_source_imported_then_deleted_during_inspection_is_not_resurrected(gallery, monkeypatch):
    job = saved_job()
    inspect_file = library.inspect_file
    def inspect_and_delete(path, name):
        metadata = inspect_file(path, name)
        saved = library._import_file(path, metadata, {'kind': 'media-generation', 'job_id': job['id']})
        library.delete_image(saved['id'])
        return metadata
    monkeypatch.setattr(library, 'inspect_file', inspect_and_delete)
    assert images(gallery)['images'] == []
    assert job['id'] in library.read_index()['media_imports']


def test_identical_outputs_share_one_copy_and_both_receipts_survive_deletion(gallery):
    first = saved_job()
    second = saved_job(created=2)
    entry, = images(gallery)['images']
    assert library.read_index()['media_imports'] == {first['id']: entry['id'], second['id']: entry['id']}
    assert gallery.delete(f'/image-library/images/{entry["id"]}').status_code == 200
    assert images(gallery)['images'] == []
