import hashlib
import io
import json

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from routes.visual_review import router
from services import face_help, image_library, image_manager, image_vault, visual_review as store
from services.faces.providers import DetectedFace


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'ROOT', tmp_path / 'review')
    monkeypatch.setattr(image_vault, 'ROOT', tmp_path / 'vault')
    monkeypatch.setattr(image_library, 'ROOT', tmp_path / 'library')
    monkeypatch.setattr(image_manager, 'manager', image_manager.ImageManager(tmp_path / 'manager'))


def photo(color):
    picture = Image.new('RGB', (160, 120), color)
    draw = ImageDraw.Draw(picture)
    for x in range(0, 160, 4):
        draw.line((x, 0, x, 119), fill='white')
    output = io.BytesIO(); picture.save(output, 'PNG')
    return output.getvalue()


def vector(*values):
    result = np.zeros(32); result[:len(values)] = values
    return tuple(result / np.linalg.norm(result))


def analyzed(color, embedding=None, size=80, source='library', tmp_path=None):
    raw = photo(color)
    if source == 'library':
        item = image_library.import_image(raw, color + '.png')
        identifier = item['id']
    elif source == 'image-manager':
        root = tmp_path / color; root.mkdir(); (root / 'photo.png').write_bytes(raw)
        manager = image_manager.manager
        folder = manager.add_folder(str(root))['id']
        manager.start('scan', {'folder_ids': [folder], 'recursive': True}); manager.worker.join(10)
        identifier = manager.query(folder_id=folder)['images'][0]['id']
    else:
        identifier = color
        store.register(source, identifier, color + '.png', hashlib.sha256(raw).hexdigest())
    if source in ('library', 'image-manager'):
        _, digest, _ = store.read_source(source, identifier)
    else:
        digest = hashlib.sha256(raw).hexdigest()
    store.add_faces(digest, raw, [DetectedFace((5, 5, 5 + size, 5 + size), .99, embedding=embedding or vector(1, 0))])
    return store.result(digest)['faces'][0], identifier, raw


def current(source='all', **options):
    return face_help.questions(source, **options)['question']


def respond(question, decision='yes', **options):
    return face_help.answer('all', question['face_id'], question['version'], decision, **options)


def test_questions_are_read_only_and_names_seed_later_comparisons(monkeypatch):
    first, identifier, raw = analyzed('red', size=32)
    second, _, _ = analyzed('blue', vector(1, .02), size=48)
    index_before = (image_library.ROOT / 'index.json').read_bytes()
    with store.database() as db:
        faces_before = [tuple(row) for row in db.execute('SELECT * FROM faces')]
    monkeypatch.setattr('services.faces.providers.get_provider', lambda *args: pytest.fail('Opening questions must not load inference'))
    question = current()
    assert question['face_id'] == first['id']
    assert question['suggestion'] is None and question['view'] == 'single'
    with store.database() as db:
        assert [tuple(row) for row in db.execute('SELECT * FROM faces')] == faces_before
    saved = respond(question, name='  Alex  ')
    assert store.result(hashlib.sha256(raw).hexdigest())['faces'][0]['name'] == 'Alex'
    next_question = current()
    assert next_question['face_id'] == second['id']
    assert next_question['suggestion']['name'] == 'Alex'
    assert next_question['suggestion']['reference_id'] == first['id']
    assert next_question['view'] == 'comparison'
    assert (image_library.ROOT / 'index.json').read_bytes() == index_before
    assert image_library.image_bytes(identifier)[0] == raw
    # Each request opens a fresh SQLite connection; answers survive reconnecting.
    assert face_help.questions()['answered'] == 1
    face_help.undo('all', first['id'], saved['undo_id'])
    assert face_help.questions()['answered'] == 0


def test_yes_uses_existing_group_and_no_separates_without_deleting_sources():
    first, _, _ = analyzed('red')
    store.rename_person(first['person_id'], 'Alex')
    store.correct_face(first['id'], first['person_id'])
    second, identifier, raw = analyzed('blue', size=48)
    question = current()
    assert question['face_id'] == second['id'] and question['suggestion']['id'] == first['person_id']
    saved = respond(question, 'no', name='Alex', person_id=first['person_id'])
    separated = store.result(hashlib.sha256(raw).hexdigest())['faces'][0]
    assert separated['person_id'] != first['person_id'] and separated['uncertain']
    assert current()['face_id'] == first['id']
    face_help.undo('all', second['id'], saved['undo_id'])
    restored = store.result(hashlib.sha256(raw).hexdigest())['faces'][0]
    assert restored == second
    saved = respond(current(), name='Alex', person_id=first['person_id'])
    assert face_help.questions()['answered'] == 1
    assert image_library.image_bytes(identifier)[0] == raw


def test_skip_is_session_only_and_undo_can_restore_not_a_face():
    first, _, _ = analyzed('red')
    question = current()
    assert face_help.questions(skip_ids=[first['id']])['question'] is None
    assert current()['face_id'] == first['id']
    saved = respond(question, 'not-face')
    assert face_help.questions()['total'] == 0
    face_help.undo('all', first['id'], saved['undo_id'])
    assert current()['face_id'] == first['id']
    assert store.crop(first['id']).startswith(b'\xff\xd8')


def test_uncertain_faces_take_priority_and_confident_faces_can_be_single_view():
    first, _, _ = analyzed('red')
    store.rename_person(first['person_id'], 'Alex')
    store.correct_face(first['id'], first['person_id'])
    other, _, _ = analyzed('yellow', vector(0, 1))
    store.rename_person(other['person_id'], 'Jordan')
    store.correct_face(other['id'], other['person_id'])
    second, _, _ = analyzed('blue')
    third, _, _ = analyzed('green', vector(1, 1))
    question = current()
    assert question['face_id'] == third['id'] and question['view'] == 'comparison'
    confident = current(skip_ids=[first['id'], third['id'], other['id']])
    assert confident['face_id'] == second['id'] and confident['view'] == 'single'
    assert confident['suggestion']['reference_id'] == first['id']


def test_queue_and_references_filter_hidden_locked_missing_and_changed_photos(monkeypatch):
    first, first_id, _ = analyzed('red')
    store.rename_person(first['person_id'], 'Alex')
    second, second_id, _ = analyzed('blue', size=48)
    monkeypatch.setattr(image_vault, 'locked_hashes', lambda: {hashlib.sha256(photo('red')).hexdigest()})
    question = current()
    assert question['face_id'] == second['id']
    assert question['suggestion']['reference_id'] is None
    assert question['view'] == 'single'
    monkeypatch.setattr(image_vault, 'locked_hashes', lambda: set())
    index = image_library.read_index(); index['images'][0]['hidden'] = True; image_library.save_index(index)
    assert face_help.questions()['total'] == 1
    index['images'][0]['hidden'] = False; image_library.save_index(index)
    (image_library.ROOT / 'images' / (first_id + '.image')).unlink()
    assert face_help.questions()['total'] == 1
    (image_library.ROOT / 'images' / (second_id + '.image')).write_bytes(photo('green'))
    assert face_help.questions()['total'] == 0


def test_image_manager_sources_and_duplicate_content_are_scoped(tmp_path):
    first, _, raw = analyzed('red')
    second, _, _ = analyzed('red', source='image-manager', tmp_path=tmp_path)
    assert first['id'] == second['id']
    assert face_help.questions()['total'] == 1
    assert current('image-manager')['source']['source'] == 'image-manager'
    analyzed('blue', source='media-manager')
    assert face_help.questions()['total'] == 1
    (tmp_path / 'red' / 'photo.png').write_bytes(photo('green'))
    assert face_help.questions('image-manager')['total'] == 0


def test_failed_or_stale_answers_and_undo_leave_other_review_changes_intact():
    face, _, _ = analyzed('red')
    question = current()
    with pytest.raises(ValueError, match='Enter a name'):
        respond(question)
    assert face_help.questions()['answered'] == 0
    saved = respond(question, name='Alex')
    with pytest.raises(face_help.StaleAnswer):
        respond(question, name='Alex')
    store.correct_face(face['id'], name='New correction')
    with pytest.raises(face_help.StaleAnswer):
        face_help.undo('all', face['id'], saved['undo_id'])
    assert current()['suggestion']['name'] == 'New correction'
    with store.database() as db:
        assert db.execute('SELECT COUNT(*) FROM faces').fetchone()[0] == 1


def test_no_for_an_edited_new_name_preserves_a_different_existing_group():
    first, _, _ = analyzed('red')
    store.rename_person(first['person_id'], 'Alex')
    store.correct_face(first['id'], first['person_id'])
    analyzed('blue')
    question = current()
    saved = respond(question, 'no', name='Someone else')
    with store.database() as db:
        face = face_help._face(db, question['face_id'])
        feedback = face_help._feedback(db, question['face_id'])
        assert face['person_id'] == first['person_id']
        assert not face['uncertain']
        assert feedback['name'] == 'Someone else' and feedback['person_id'] is None
        assert db.execute('SELECT COUNT(*) FROM people').fetchone()[0] == 1
    face_help.undo('all', question['face_id'], saved['undo_id'])


def test_a_correction_failure_rolls_back_the_face_profile_and_answer(monkeypatch):
    face, _, _ = analyzed('red')
    question = current()
    def fail(*args):
        raise OSError('Simulated write failure')
    monkeypatch.setattr(store, 'recompute', fail)
    with pytest.raises(OSError, match='Simulated write failure'):
        respond(question, name='Alex')
    with store.database() as db:
        assert db.execute('SELECT COUNT(*) FROM people').fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM face_feedback').fetchone()[0] == 0
        assert face_help._face(db, face['id'])['person_id'] == face['person_id']


def test_api_validates_scope_and_returns_conflict_for_a_duplicate_answer():
    face, _, _ = analyzed('red')
    app = FastAPI(); app.include_router(router); client = TestClient(app)
    response = client.post('/visual-review/help/questions', json={'source': 'library'})
    assert response.status_code == 200
    question = response.json()['question']
    body = {'source': 'library', 'face_id': face['id'], 'version': question['version'], 'decision': 'yes', 'name': 'Alex'}
    saved = client.post('/visual-review/help/answer', json=body)
    assert saved.status_code == 200, saved.text
    assert client.post('/visual-review/help/answer', json=body).status_code == 409
    assert client.post('/visual-review/help/questions', json={'source': 'face-extractor'}).status_code == 422
    undone = client.post('/visual-review/help/undo', json={'source': 'library', 'face_id': face['id'], 'undo_id': saved.json()['undo_id']})
    assert undone.status_code == 200
    assert client.post('/visual-review/help/questions', json={'source': 'library'}).json()['question']['face_id'] == face['id']
