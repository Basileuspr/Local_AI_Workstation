"""Human answers over existing REVIEW crops. Opening this never runs inference."""
from __future__ import annotations

import hashlib
import io
import json
import re
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image

from services import image_library, image_vault, visual_review as store
from services.faces.crops import sharpness

SOURCES = ('all', 'library', 'image-manager')
STATE_FIELDS = ('id', 'digest', 'person_id', 'excluded', 'uncertain', 'similarity', 'name')


class StaleAnswer(ValueError):
    pass


def _named(name):
    return not re.fullmatch(r'Person [1-9]\d*', name)


@lru_cache(maxsize=2048)
def _library_current(identifier, digest, path, signature):
    # Owned library images normally never change. Check their content once per
    # file signature and keep only the boolean, never image bytes in this cache.
    try:
        raw, _ = image_library.image_bytes(identifier)
        return hashlib.sha256(raw).hexdigest() == digest
    except ValueError as error:
        if str(error) == 'Stored image has changed':
            return False
        raise


def _visible_sources(db, source):
    """Apply the same source, privacy and file-state boundaries as REVIEW."""
    if source not in SOURCES:
        raise ValueError('Choose analyzed images from the Image Library or Image Manager.')
    locked = image_vault.locked_hashes()
    native = {}
    if source in ('all', 'library'):
        native['library'] = {item['id']: item for item in image_library.public_index()['images']}
    if source in ('all', 'image-manager'):
        from services.image_manager import manager
        with manager.database() as connection:
            native['image-manager'] = {row['id']: dict(row) for row in connection.execute(
                'SELECT id,signature,hidden,available FROM images')}
    visible = {}
    for row in db.execute('SELECT source,id,digest,name,stamp FROM sources ORDER BY source,id'):
        item = native.get(row['source'], {}).get(row['id'])
        if not item or item.get('hidden') or row['digest'] in locked:
            continue
        if row['source'] == 'library' and item['sha256'] != row['digest']:
            continue
        if row['source'] == 'image-manager' and (not item['available'] or item['signature'] != row['stamp']):
            continue
        try:
            record = store.media_record(row['source'], row['id'])
            if record['file_state'] != 'present':
                continue
            if row['source'] == 'library':
                stamp = Path(record['path']).stat()
                signature = (stamp.st_size, stamp.st_mtime_ns, stamp.st_ctime_ns)
                if not _library_current(row['id'], row['digest'], record['path'], signature):
                    continue
        except (ValueError, OSError, KeyError):
            continue
        # Copies share classification, so ask about each crop only once.
        visible.setdefault(row['digest'], {key: row[key] for key in ('source', 'id', 'name')})
    return visible


def _face(db, identifier):
    row = db.execute('SELECT f.*,p.name FROM faces f JOIN people p ON p.id=f.person_id WHERE f.id=?',
                     (identifier,)).fetchone()
    if not row:
        raise ValueError('Face no longer exists. Refresh the questions.')
    return dict(row)


def _state(face):
    return {key: face[key] for key in STATE_FIELDS}


def _fingerprint(face):
    return hashlib.sha256(json.dumps(_state(face), sort_keys=True).encode()).hexdigest()


def _feedback(db, identifier):
    row = db.execute('SELECT value FROM face_feedback WHERE face_id=?', (identifier,)).fetchone()
    return json.loads(row['value']) if row else None


def _version(face, feedback):
    return _fingerprint(face) + ':' + (feedback['revision'] if feedback else '')


def _answered(face, feedback):
    return bool(feedback and feedback['after'] == _fingerprint(face))


def _vector(face):
    try:
        return store.normalized(json.loads(face['embedding']))
    except (ValueError, TypeError):
        return None


def _area(face):
    box = json.loads(face['box'])
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def _people(faces, feedback):
    groups = {}
    for face in faces:
        groups.setdefault(face['person_id'], []).append(face)
    result = []
    for identifier, members in groups.items():
        ranked = sorted(members, key=lambda item: (-int(_answered(item, feedback.get(item['id']))
                         and feedback[item['id']]['answer'] == 'yes'), -_area(item), item['id']))
        result.append({'id': identifier, 'name': members[0]['name'], 'count': len(members),
                       'named': _named(members[0]['name']), 'reference_ids': [item['id'] for item in ranked[:2]]})
    return sorted(result, key=lambda item: (item['name'].casefold(), item['id']))


def questions(source='all', skip_ids=(), include_answered=False):
    with store.database() as db:
        visible = _visible_sources(db, source)
        faces = [dict(row) for row in db.execute('''SELECT f.id,f.digest,f.person_id,f.box,f.embedding,
          f.similarity,f.uncertain,f.excluded,p.name FROM faces f JOIN people p ON p.id=f.person_id
          JOIN assets a ON a.digest=f.digest WHERE f.excluded=0 AND a.faces_done=1''')
                 if row['digest'] in visible]
        feedback = {row['face_id']: json.loads(row['value']) for row in db.execute('SELECT * FROM face_feedback')}
        people = _people(faces, feedback)
        pending = [face for face in faces if include_answered or not _answered(face, feedback.get(face['id']))]
        skipped = set(skip_ids)
        available = sorted((face for face in pending if face['id'] not in skipped),
                           key=lambda face: (-face['uncertain'], _area(face), face['id']))
        result = {'question': None, 'people': people, 'total': len(faces), 'remaining': len(available),
                  'answered': sum(_answered(face, feedback.get(face['id'])) for face in faces),
                  'skipped': sum(face['id'] in skipped for face in pending)}
        if not available:
            return result
        face = available[0]
        vector = _vector(face)
        candidates = []
        for person in people:
            if not person['named']:
                continue
            members = [item for item in faces if item['person_id'] == person['id'] and item['id'] != face['id']]
            vectors = [_vector(item) for item in members]
            vectors = [value for value in vectors if value is not None and vector is not None and value.shape == vector.shape]
            score = None
            if vectors:
                try:
                    score = float(vector @ store.normalized(np.asarray(vectors).mean(axis=0)))
                except ValueError:
                    pass
            if person['id'] == face['person_id'] or (score is not None and score >= .45):
                candidates.append((person, score))
        candidates.sort(key=lambda item: (item[0]['id'] != face['person_id'], -(item[1] if item[1] is not None else -1)))
        suggestion = None
        reasons = []
        box = json.loads(face['box'])
        width, height = box[2] - box[0], box[3] - box[1]
        if min(width, height) < 64:
            reasons.append(f'Small face: {width} × {height} pixels in the photo.')
        try:
            with Image.open(io.BytesIO(db.execute('SELECT crop FROM faces WHERE id=?', (face['id'],)).fetchone()[0])) as crop:
                if sharpness(crop) < 12:
                    reasons.append('The face crop has little detail; a comparison may help.')
        except OSError:
            reasons.append('The saved crop could not be read. Skip it or check this photo in REVIEW.')
        if face['uncertain']:
            reasons.append('The original grouping was uncertain.')
        if candidates:
            person, score = candidates[0]
            reference_id = next((identifier for identifier in person['reference_ids'] if identifier != face['id']), None)
            if len(candidates) > 1 and score is not None and candidates[1][1] is not None and abs(score - candidates[1][1]) < .08:
                reasons.append('Two possible matches have similar scores.')
            suggestion = {**person, 'reference_id': reference_id,
                          'similarity': round(score, 4) if score is not None else None}
        result['question'] = {'face_id': face['id'], 'person_id': face['person_id'],
                              'version': _version(face, feedback.get(face['id'])),
                              'source': visible[face['digest']], 'suggestion': suggestion, 'reasons': reasons,
                              'view': 'comparison' if suggestion and suggestion['reference_id']
                              and (reasons or suggestion['similarity'] is None or suggestion['similarity'] < .75) else 'single'}
        return result


def answer(source, identifier, version, decision, name='', person_id=None, suggestion_id=None):
    if decision not in ('yes', 'no', 'not-face'):
        raise ValueError('Choose Yes, No, or Not a face.')
    name = name.strip()
    if len(name) > 120:
        raise ValueError('Use a person label of 1 to 120 characters.')
    with store.database() as db:
        visible = _visible_sources(db, source)
        face = _face(db, identifier)
        if face['digest'] not in visible or face['excluded']:
            raise ValueError('This photo is no longer available for these questions. Refresh to continue.')
        previous = _feedback(db, identifier)
        if version != _version(face, previous):
            raise StaleAnswer('This face changed in REVIEW. Refresh before answering.')
        visible_people = {row['person_id'] for row in db.execute('SELECT digest,person_id FROM faces WHERE excluded=0')
                          if row['digest'] in visible}
        if person_id and person_id not in visible_people:
            raise ValueError('Choose a person from the visible analyzed images.')
        if suggestion_id and suggestion_id not in visible_people:
            raise StaleAnswer('The suggested group changed. Refresh before answering.')
        target = person_id
        if name and not target:
            matches = [row['id'] for row in db.execute('SELECT id,name FROM people')
                       if row['id'] in visible_people and row['name'].casefold() == name.casefold()]
            if len(matches) > 1:
                raise ValueError('Several groups use this name. Choose one from the existing people list.')
            target = matches[0] if matches else None
        if target and name:
            target_name = db.execute('SELECT name FROM people WHERE id=?', (target,)).fetchone()[0]
            if target_name.casefold() != name.casefold():
                raise StaleAnswer('The person label changed. Refresh before answering.')
        before = _state(face)
        created = None
        if decision == 'yes':
            if not target and not name:
                raise ValueError('Enter a name or choose an existing person before Yes.')
            corrected = store._correct_face(db, identifier, target, name=name if not target else None)
            if not target:
                created = corrected['person_id']
            message = f'Saved this face as {name or _face(db, identifier)["name"]}.'
        elif decision == 'no':
            target = target or suggestion_id or (face['person_id'] if not name else None)
            count = db.execute('SELECT count FROM people WHERE id=?', (face['person_id'],)).fetchone()[0]
            if target == face['person_id'] and (count > 1 or _named(face['name'])):
                created = store._correct_face(db, identifier)['person_id']
            if target == face['person_id'] or not _named(face['name']):
                db.execute('UPDATE faces SET uncertain=1 WHERE id=?', (identifier,))
            message = ('Saved No. This face is left unidentified for later review.'
                       if target == face['person_id'] or not _named(face['name'])
                       else 'Saved No for this proposed match.')
        else:
            store._correct_face(db, identifier, face['person_id'], exclude=True)
            message = 'Removed this crop from people grouping.'
        revision = uuid4().hex
        value = {'revision': revision, 'answer': decision, 'person_id': target, 'name': name,
                 'at': datetime.now(timezone.utc).isoformat(), 'after': _fingerprint(_face(db, identifier)),
                 'undo': {'before': before, 'created_person_id': created,
                          'previous': {key: value for key, value in previous.items() if key != 'undo'} if previous else None}}
        db.execute('INSERT INTO face_feedback VALUES (?,?) ON CONFLICT(face_id) DO UPDATE SET value=excluded.value',
                   (identifier, json.dumps(value)))
        return {'face_id': identifier, 'undo_id': revision, 'message': message}


def undo(source, identifier, revision):
    with store.database() as db:
        face = _face(db, identifier)
        if face['digest'] not in _visible_sources(db, source):
            raise ValueError('This photo is no longer available. Its answer was preserved.')
        feedback = _feedback(db, identifier)
        if not feedback or feedback['revision'] != revision or not feedback.get('undo') or not _answered(face, feedback):
            raise StaleAnswer('This answer changed in REVIEW. Refresh to see the current face.')
        snapshot = feedback['undo']
        before = snapshot['before']
        if not db.execute('SELECT 1 FROM people WHERE id=?', (before['person_id'],)).fetchone():
            raise StaleAnswer('The original person group changed. Review this face in REVIEW.')
        db.execute('UPDATE faces SET person_id=?,excluded=?,uncertain=?,similarity=? WHERE id=?',
                   (before['person_id'], before['excluded'], before['uncertain'], before['similarity'], identifier))
        store.recompute(db, face['person_id'])
        store.recompute(db, before['person_id'])
        created = snapshot['created_person_id']
        if created and not db.execute('SELECT 1 FROM faces WHERE person_id=?', (created,)).fetchone():
            db.execute('DELETE FROM people WHERE id=?', (created,))
        if snapshot['previous']:
            db.execute('UPDATE face_feedback SET value=? WHERE face_id=?', (json.dumps(snapshot['previous']), identifier))
        else:
            db.execute('DELETE FROM face_feedback WHERE face_id=?', (identifier,))
        return {'message': 'Last answer undone.', 'face_id': identifier}
