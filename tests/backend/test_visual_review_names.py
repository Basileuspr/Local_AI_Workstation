"""Person folders and tag filters share names without rewriting manual tags."""
import hashlib
import io
import sqlite3

import pytest
from PIL import Image
from services import image_library, image_manager, image_vault, visual_review as store
from services import visual_review_names as names
from services.faces.providers import DetectedFace


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'ROOT', tmp_path / 'review')
    monkeypatch.setattr(image_library, 'ROOT', tmp_path / 'library')
    monkeypatch.setattr(image_vault, 'ROOT', tmp_path / 'vault')


def picture(color):
    output = io.BytesIO()
    Image.new('RGB', (80, 80), color).save(output, 'PNG')
    return output.getvalue()


def detection(index):
    vector = tuple(float(i == index) for i in range(32))
    return DetectedFace((0, 0, 40, 40), .99, embedding=vector)


def media_people():
    people = []
    for index, color in enumerate(['red', 'blue', 'green']):
        raw = picture(color)
        digest = hashlib.sha256(raw).hexdigest()
        store.register('media-manager', color, color, digest)
        store.add_faces(digest, raw, [detection(index)])
        people.append(store.result(digest)['faces'][0])
    return people


def manager_people(tmp_path, monkeypatch):
    root = tmp_path / 'photos'
    root.mkdir()
    for color in ['red', 'blue', 'green']:
        (root / (color + '.png')).write_bytes(picture(color))
    manager = image_manager.ImageManager(tmp_path / 'manager')
    monkeypatch.setattr(image_manager, 'manager', manager)
    folder = manager.add_folder(str(root))['id']
    manager.start('scan', {'folder_ids': [folder], 'recursive': True})
    manager.worker.join(10)
    assert manager.job['status'] == 'complete'
    items = manager.query(sort='name')['images']
    faces = []
    for index, item in enumerate(items):
        raw, digest, _ = store.read_source('image-manager', item['id'])
        store.add_faces(digest, raw, [detection(index)])
        faces.append(store.result(digest)['faces'][0])
    return manager, root, items, faces


def test_existing_name_merges_all_legacy_duplicates_and_keeps_target():
    faces = media_people()
    target = faces[0]['person_id']
    store.rename_person(target, 'Alex Example')
    # Simulate previously saved duplicate folders, including spacing/case.
    with store.database() as db:
        db.execute('UPDATE people SET name=? WHERE id=?', ('alex   example', faces[1]['person_id']))
    saved = store.rename_person(faces[2]['person_id'], '  ALEX  Example  ')
    assert saved['person_id'] in {target, faces[1]['person_id']}
    assert saved['merged'] == 2
    catalog = store.catalog('media-manager')
    assert len(catalog['people']) == 1 and catalog['people'][0]['count'] == 3
    assert {face['person_id'] for item in catalog['items'] for face in item['classification']['faces']} == {saved['person_id']}
    with store.database() as db:
        assert db.execute('SELECT COUNT(*) FROM people').fetchone()[0] == 1


def test_merge_consolidates_duplicate_target_names_and_counts_each_photo_once():
    faces = media_people()
    source, target, duplicate = [face['person_id'] for face in faces]
    with store.database() as db:
        db.execute('UPDATE people SET name=? WHERE id IN (?,?)', ('Alex', target, duplicate))
    saved = store.merge_people(source, target)
    assert saved['person_id'] == target
    assert store.catalog('media-manager')['people'][0]['count'] == 3
    assert len(store.catalog('media-manager')['people']) == 1


def test_named_correction_reuses_an_existing_person_and_undo_updates_tags(tmp_path, monkeypatch):
    manager, root, items, faces = manager_people(tmp_path, monkeypatch)
    first, second = faces[:2]
    store.rename_person(first['person_id'], 'Alex')
    saved = store.correct_face(second['id'], name=' alex ')
    assert saved['person_id'] == first['person_id']
    assert manager.query(tag='Alex', limit=1)['total'] == 2
    assert len(manager.query(tag='Alex', limit=1)['images']) == 1
    store.correct_face(second['id'], second['person_id'])
    assert manager.query(tag='Alex')['total'] == 1
    store.correct_face(first['id'], first['person_id'], exclude=True)
    assert 'Alex' not in manager.query()['tags']
    store.correct_face(first['id'], first['person_id'], exclude=False)
    assert manager.query(tag='Alex')['total'] == 1


def test_manager_tags_follow_names_and_merges_without_changing_manual_metadata(tmp_path, monkeypatch):
    manager, root, items, faces = manager_people(tmp_path, monkeypatch)
    first, second = faces[:2]
    first_id, second_id = [item['id'] for item in items[:2]]
    manager.metadata([first_id], tags=['Keep'], favorite=True)
    store.review('image-manager', first_id, {'caption': 'Keep these notes', 'project': 'Album'})
    before = {path.name: path.read_bytes() for path in root.iterdir()}
    store.rename_person(first['person_id'], 'Alex')
    store.rename_person(second['person_id'], 'Jordan')
    assert manager.query(tag='Alex')['images'][0]['id'] == first_id
    assert manager.query(search='Alex')['total'] == 1
    assert manager.query(hide_tagged=True)['total'] == 1
    assert store.catalog('image-manager')['available_tags'] == ['Alex', 'Jordan', 'Keep']
    opened = store.open_item('image-manager', first_id)
    assert opened['person_tags'] == ['Alex'] and opened['review']['tags'] == ['Keep']
    store.rename_person(first['person_id'], 'Taylor')
    assert 'Alex' not in manager.query()['tags']
    saved = store.rename_person(second['person_id'], ' taylor ')
    assert saved['person_id'] == first['person_id']
    assert set(item['id'] for item in manager.query(tag='Taylor')['images']) == {first_id, second_id}
    assert 'Jordan' not in manager.query()['tags']
    assert manager.image(first_id)['tags'] == ['Keep']
    assert manager.image(second_id)['tags'] == []
    value = store.review('image-manager', first_id)
    assert value['caption'] == 'Keep these notes' and value['project'] == 'Album' and value['favorite']
    assert {path.name: path.read_bytes() for path in root.iterdir()} == before
    # Read fresh SQLite connections, with no UI or process-local name cache.
    fresh = image_manager.ImageManager(manager.directory)
    assert fresh.query(tag='Taylor')['total'] == 2


def test_manager_names_respect_rescans_privacy_long_names_and_hide_tagged(tmp_path, monkeypatch):
    manager, root, items, faces = manager_people(tmp_path, monkeypatch)
    label = 'A' * 120
    store.rename_person(faces[0]['person_id'], label)
    assert manager.query(tag=label)['total'] == 1
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routes import image_manager as manager_routes
    monkeypatch.setattr(manager_routes, 'manager', manager)
    app = FastAPI(); app.include_router(manager_routes.router)
    response = TestClient(app).get('/image-manager/images', params={'tag': label})
    assert response.status_code == 200 and response.json()['total'] == 1
    digest = hashlib.sha256((root / items[0]['relative']).read_bytes()).hexdigest()
    monkeypatch.setattr(image_vault, 'locked_hashes', lambda: {digest})
    assert label not in manager.query()['tags']
    monkeypatch.setattr(image_vault, 'locked_hashes', lambda: set())
    (root / items[0]['relative']).write_bytes(picture('yellow'))
    manager.start('scan', {'folder_ids': [items[0]['folder_id']], 'recursive': True})
    manager.worker.join(10)
    assert label not in manager.query()['tags']
    store.rename_person(faces[1]['person_id'], 'Named')
    assert manager.hide_tagged()['updated'] == 1
    assert manager.query(visibility='hidden')['images'][0]['id'] == items[1]['id']


def test_library_reuses_saved_name_tags_and_projects_new_names_without_writes():
    first = image_library.import_image(picture('red'), 'first.png')
    second = image_library.import_image(picture('blue'), 'second.png')
    saved_tag = image_library.tag('Alex')
    people = []
    for index, item in enumerate([first, second]):
        raw, digest, _ = store.read_source('library', item['id'])
        store.add_faces(digest, raw, [detection(index)])
        people.append(store.result(digest)['faces'][0])
    store.rename_person(people[0]['person_id'], 'Alex')
    store.rename_person(people[1]['person_id'], 'Jordan')
    before = (image_library.ROOT / 'index.json').read_bytes()
    index = image_library.public_index()
    alex = next(tag for tag in index['tags'] if tag['name'] == 'Alex')
    jordan = next(tag for tag in index['tags'] if tag['name'] == 'Jordan')
    with pytest.raises(ValueError, match='face grouping'):
        image_library.delete_tag(jordan['id'])
    assert alex['id'] == saved_tag['id']
    assert next(item for item in index['images'] if item['id'] == first['id'])['tag_ids'] == [alex['id']]
    assert (image_library.ROOT / 'index.json').read_bytes() == before
    # A caption/tag save keeps a projected name attached without making it
    # sticky manual metadata; a later correction can remove it cleanly.
    image_library.edit_image(second['id'], caption='Notes', tag_ids=[jordan['id']])
    raw_second = next(item for item in image_library.read_index()['images'] if item['id'] == second['id'])
    assert raw_second['tag_ids'] == [] and raw_second['annotations']['caption'] == 'Notes'
    image_library.tag('Taylor', jordan['id'])
    assert store.result(second['sha256'])['faces'][0]['name'] == 'Taylor'
    assert 'Jordan' not in [tag['name'] for tag in image_library.public_index()['tags']]
    store.merge_people(people[1]['person_id'], people[0]['person_id'])
    index = image_library.public_index()
    assert [tag['name'] for tag in index['tags']] == ['Alex']
    assert all(item['tag_ids'] == [alex['id']] for item in index['images'])
    assert len(store.catalog('library')['people']) == 1
    assert image_library.image_bytes(first['id'])[0] == picture('red')
    assert image_library.image_bytes(second['id'])[0] == picture('blue')


def test_linked_library_tag_can_be_manually_applied_to_an_unclassified_image():
    first = image_library.import_image(picture('red'), 'first.png')
    second = image_library.import_image(picture('blue'), 'second.png')
    raw, digest, _ = store.read_source('library', first['id'])
    store.add_faces(digest, raw, [detection(0)])
    store.rename_person(store.result(digest)['faces'][0]['person_id'], 'Alex')
    tag = image_library.public_index()['tags'][0]
    image_library.edit_image(second['id'], tag_ids=[tag['id']])
    assert len(image_library.public_index()['tags']) == 1
    manual = next(item for item in image_library.read_index()['images'] if item['id'] == second['id'])
    assert manual['tag_ids'] == [tag['id']]


def test_listing_name_tags_does_not_create_the_review_catalog():
    assert names.sources('image-manager') == {}
    assert not store.ROOT.exists()


def test_name_tags_read_legacy_sources_without_migrating_or_losing_names():
    store.ROOT.mkdir()
    path = store.ROOT / 'catalog.sqlite3'
    with sqlite3.connect(path) as db:
        db.executescript('''CREATE TABLE sources(source TEXT,id TEXT,digest TEXT);
          CREATE TABLE faces(digest TEXT,person_id TEXT,excluded INTEGER);
          CREATE TABLE people(id TEXT,name TEXT);
          INSERT INTO sources VALUES ('library','photo','digest');
          INSERT INTO faces VALUES ('digest','person',0);
          INSERT INTO people VALUES ('person','Alex');''')
    before = path.read_bytes()
    assert names.sources('library') == {'photo': {'digest': 'digest', 'stamp': '', 'people': [{'id': 'person', 'name': 'Alex'}]}}
    assert path.read_bytes() == before
