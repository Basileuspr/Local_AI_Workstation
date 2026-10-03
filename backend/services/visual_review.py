"""Content-addressed review classifications, independent of source-file locations.

Faces are anonymous clusters until the user supplies a name. No identity names,
sensitive attributes, or Face Bank associations are inferred by a vision model.
"""
from contextlib import contextmanager
import base64
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import threading
from uuid import uuid4

import numpy as np
from PIL import Image, ImageOps
from config import settings
from services import image_vault
from services import review_metadata
from services.visual_review_names import name_key, named

ROOT = settings.data_dir / 'visual_review'
LOCK = threading.RLock()
SCENES = ('indoors', 'outdoors', 'beach', 'forest', 'mountains', 'park', 'garden',
          'street', 'city', 'countryside', 'desert', 'snow', 'water', 'sky', 'home',
          'kitchen', 'bedroom', 'office', 'classroom', 'restaurant', 'shop', 'vehicle',
          'stadium', 'stage', 'studio', 'architecture', 'night', 'sunset', 'animals',
          'food', 'flowers', 'documents', 'screenshots', 'illustration')


@contextmanager
def database():
    from services.storage_libraries import no_links
    with LOCK:
        no_links(ROOT).mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(no_links(ROOT/'catalog.sqlite3'), timeout=15)
        db.row_factory = sqlite3.Row
        try:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS assets(digest TEXT PRIMARY KEY, faces_done INTEGER DEFAULT 0,
                  scenes_done INTEGER DEFAULT 0, scenes TEXT DEFAULT '[]', model TEXT DEFAULT '', error TEXT DEFAULT '');
                CREATE TABLE IF NOT EXISTS sources(source TEXT, id TEXT, digest TEXT, name TEXT,
                  PRIMARY KEY(source,id));
                CREATE INDEX IF NOT EXISTS sources_digest ON sources(digest);
                CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY, name TEXT, centroid TEXT, count INTEGER);
                CREATE TABLE IF NOT EXISTS faces(id TEXT PRIMARY KEY, digest TEXT, person_id TEXT, box TEXT,
                  embedding TEXT, crop BLOB, similarity REAL, uncertain INTEGER, excluded INTEGER DEFAULT 0);
                CREATE INDEX IF NOT EXISTS faces_asset ON faces(digest);
                CREATE INDEX IF NOT EXISTS faces_person ON faces(person_id);
                CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE IF NOT EXISTS reviews(digest TEXT PRIMARY KEY, rating TEXT, caption TEXT DEFAULT '', tags TEXT DEFAULT '[]');
                CREATE TABLE IF NOT EXISTS source_reviews(source TEXT, id TEXT, digest TEXT, value TEXT NOT NULL,
                  PRIMARY KEY(source,id,digest));
                CREATE TABLE IF NOT EXISTS face_feedback(face_id TEXT PRIMARY KEY, value TEXT NOT NULL);
            ''')
            if 'stamp' not in {row['name'] for row in db.execute('PRAGMA table_info(sources)')}:
                db.execute("ALTER TABLE sources ADD COLUMN stamp TEXT DEFAULT ''")
            if 'record' not in {row['name'] for row in db.execute('PRAGMA table_info(sources)')}:
                db.execute("ALTER TABLE sources ADD COLUMN record TEXT DEFAULT '{}'")
            with db: yield db
        finally: db.close()


def public(digest):
    image_vault.require_public(digest)


def image(raw):
    if not raw or len(raw) > 40*1024*1024: raise ValueError('Choose an image up to 40 MiB.')
    with Image.open(io.BytesIO(raw)) as source:
        if source.width*source.height > 40_000_000 or getattr(source, 'n_frames', 1) != 1:
            raise ValueError('Choose a single-frame image up to 40 megapixels.')
        return ImageOps.exif_transpose(source).convert('RGB')


def register(source, identifier, name, digest, stamp='', record=None):
    public(digest)
    with database() as db:
        db.execute('INSERT OR IGNORE INTO assets(digest) VALUES (?)', (digest,))
        db.execute('INSERT INTO sources(source,id,digest,name,stamp) VALUES (?,?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET digest=excluded.digest,name=excluded.name,stamp=excluded.stamp',
                   (source, identifier, digest, name[:240],stamp))
        if record is not None:
            db.execute('UPDATE sources SET record=? WHERE source=? AND id=?',(json.dumps(record),source,identifier))
    return digest


def read_source(source, identifier):
    if source == 'library':
        from services import image_library
        raw, item = image_library.image_bytes(identifier)
        name = item['name']
        stamp=item['sha256']
    elif source == 'image-manager':
        from services.image_manager import manager, signature
        item = manager.image(identifier)
        item, path = manager.image_path(identifier)
        if path.stat().st_size > 40*1024*1024: raise ValueError('Image exceeds the 40 MiB analysis limit.')
        before = signature(path.stat())
        raw = path.read_bytes()
        if before != signature(path.stat()): raise ValueError('Image changed while reading. Rescan and retry.')
        name = item['relative']
        stamp=json.dumps(item['signature'])
    else: raise ValueError('Choose a supported image source.')
    digest = hashlib.sha256(raw).hexdigest()
    register(source, identifier, name, digest,stamp,media_record(source,identifier))
    return raw, digest, name


def media_record(source, identifier, manual=None):
    """Resolve current locations through existing adapters, never request paths."""
    if source=='library':
        from services import image_library
        with image_library.LOCK: index=image_library.read_index()
        item=next((item for item in index['images'] if item['id']==identifier),None)
        if not item: raise ValueError('Image unavailable.')
        public(item['sha256'])
        names={tag['id']:tag['name'] for tag in index['tags']}
        value=manual if manual is not None else library_review(item,names)
        record=image_library.media_record(item)
        return {**record,**value}
    if source=='image-manager':
        from services.image_manager import manager,no_links,signature
        item=manager.image(identifier)
        root=Path(item['folder_path']).absolute()
        def resolve():
            path=no_links(no_links(root)/item['relative'])
            if not path.is_relative_to(root): raise ValueError('Image path escapes its folder.')
            return path
        location=review_metadata.location(resolve,expected_signature=item['signature'],signature=signature)
        if not item['available'] and location['file_state']=='present': location['file_state']='unavailable'
        details={key:item[key] for key in ('sha256','signature','width','height','format','bytes','date','folder_id','relative') if key in item}
        return review_metadata.media_record(source,identifier,manual=manual,details=details,**location)
    if source=='media-manager':
        # Video paths belong to the isolated Media Manager server. A preview
        # bridge cannot prove current source-file availability on this host.
        return review_metadata.media_record(source,identifier,media_type='video',manual=manual)
    raise ValueError('Choose a supported media source.')


def tag_names(source):
    """Reuse the source's complete tag palette, independent of review filters."""
    if source == 'image-manager':
        from services.image_manager import manager
        return manager.query(limit=1)['tags']
    if source == 'library':
        from services import image_library
        return sorted({tag['name'] for tag in image_library.public_index()['tags']}, key=str.casefold)
    return []


def open_item(source, identifier):
    record=media_record(source,identifier)
    if record['file_state']=='present':
        _,digest,name=read_source(source,identifier)
    else:
        with database() as db:
            saved=db.execute('SELECT * FROM sources WHERE source=? AND id=?',(source,identifier)).fetchone()
        if source=='library':
            digest=record['metadata']['sha256']
            from services import image_library
            item=next(item for item in image_library.public_index()['images'] if item['id']==identifier)
            name=item['name']
            register(source,identifier,name,digest,digest,record)
        elif saved:
            digest,name=saved['digest'],saved['name']
        else: raise ValueError('Open this source once while available before reviewing its saved metadata.')
        public(digest)
    value=review(source,identifier)
    classification=result(digest)
    return {'digest':digest,'name':name,'review':value,'media':media_record(source,identifier,value),
            'classification':classification, 'available_tags':tag_names(source),
            'person_tags':list(dict.fromkeys(face['name'] for face in classification['faces'] if named(face['name'])))}


def result(digest):
    public(digest)
    with database() as db:
        return _result(db, digest)


def _result(db, digest):
    row = db.execute('SELECT * FROM assets WHERE digest=?', (digest,)).fetchone()
    if not row: return None
    faces = [dict(face) for face in db.execute('''SELECT f.id,f.person_id,p.name,f.box,f.similarity,f.uncertain
      FROM faces f JOIN people p ON p.id=f.person_id WHERE f.digest=? AND f.excluded=0 ORDER BY f.id''', (digest,))]
    for face in faces: face['box'] = json.loads(face['box'])
    faces.sort(key=lambda face:(face['box'][0],face['box'][1],face['id']))
    return {**dict(row), 'scenes':json.loads(row['scenes']), 'faces':faces}


def saved_review(db, source, identifier, digest, favorite=None):
    row = db.execute('SELECT value FROM source_reviews WHERE source=? AND id=? AND digest=?',
                     (source, identifier, digest)).fetchone()
    if row: return review_metadata.metadata(json.loads(row['value']))
    # Copy old content-keyed notes on first use, keeping the legacy table intact.
    legacy = db.execute('SELECT * FROM reviews WHERE digest=?', (digest,)).fetchone()
    if legacy:
        value = dict(legacy); value['tags'] = json.loads(value['tags'])
        value = review_metadata.metadata(value)
    else:
        value = review_metadata.metadata()
        # Native favorites previously acted as Like. Migrate once, then keep
        # later favorite changes and replacement content independent of status.
        if favorite and not db.execute('SELECT 1 FROM source_reviews WHERE source=? AND id=?',
                                       (source,identifier)).fetchone():
            value.update(rating='liked',review_status='accepted')
    if favorite is not None: value['favorite'] = favorite
    db.execute('INSERT INTO source_reviews(source,id,digest,value) VALUES (?,?,?,?)',
               (source, identifier, digest, json.dumps(value)))
    return value


def library_review(item, names):
    return {**review_metadata.metadata(item), 'caption': item.get('annotations', {}).get('caption', ''),
            'tags': [names[tag] for tag in item.get('manual_tag_ids', item.get('tag_ids', [])) if tag in names]}


def catalog(source, person='', scene='', offset=0, limit=48, rating='', query='', category='', project='', favorite=None, review_status=''):
    # Only names and classification metadata are returned; images still use each
    # source's existing validated serving route. Locked images are omitted.
    with database() as db:
        native={}; library_tags={}; locked=image_vault.locked_hashes()
        if source=='library':
            from services import image_library
            index=image_library.public_index()
            native={row['id']:row for row in index['images']}
            library_tags={row['id']:row['name'] for row in index['tags']}
        elif source=='image-manager':
            from services.image_manager import manager
            with manager.database() as connection:
                native={row['id']:dict(row) for row in connection.execute('SELECT id,tags,favorite,hidden,signature,available FROM images')}
        rows = db.execute('SELECT * FROM sources WHERE source=? ORDER BY name COLLATE NOCASE,id', (source,)).fetchall()
        items = []; classifications={}; groups = {}; scenes = {}
        for row in rows:
            if source!='media-manager' and (row['id'] not in native or native[row['id']].get('hidden')): continue
            if source=='image-manager' and row['stamp']!=native[row['id']]['signature']: continue
            if row['digest'] in locked: continue
            media=image_library.media_record(native[row['id']]) if source=='library' else media_record(source,row['id'])
            if row['digest'] not in classifications: classifications[row['digest']]=_result(db,row['digest'])
            info = classifications[row['digest']]
            # Keep correction destinations and their counts stable while browsing
            # one person, searching, or filtering photos. Only visible, current,
            # unlocked sources from this workspace contribute to these facets.
            for face in {f['person_id']:f for f in info['faces']}.values():
                group = groups.setdefault(face['person_id'], {'id':face['person_id'], 'name':face['name'], 'count':0, 'face_id':face['id']})
                group['count'] += 1
            for label in info['scenes']: scenes[label] = scenes.get(label,0)+1
            if source=='library':
                metadata=library_review(native[row['id']],library_tags)
            else:
                metadata=saved_review(db,source,row['id'],row['digest'],
                    favorite=bool(native[row['id']]['favorite']) if source=='image-manager' else None)
            if source=='image-manager':
                entry=native[row['id']]; metadata['tags']=json.loads(entry['tags'])
                metadata['favorite']=bool(entry['favorite'])
            if person and not any(face['person_id'] == person for face in info['faces']): continue
            if scene and scene not in info['scenes']: continue
            if rating and (metadata['rating'] or 'pending')!=rating: continue
            if category and metadata['category'].casefold()!=category.strip().casefold(): continue
            if project and metadata['project'].casefold()!=project.strip().casefold(): continue
            if favorite is not None and metadata['favorite']!=favorite: continue
            if review_status and metadata['review_status']!=review_status: continue
            searchable = [row['name'], metadata['caption'], metadata['category'], metadata['project'], *metadata['tags'], *(f['name'] for f in info['faces'])]
            if query and query.casefold() not in ' '.join(searchable).casefold(): continue
            items.append({**{key:row[key] for key in ('source','id','digest','name','stamp')}, 'classification':info, 'review':metadata,
                          'media':{**media,**metadata}})
        value={'items':items[offset:offset+limit], 'total':len(items),
               'people':sorted(groups.values(), key=lambda group:(group['name'].casefold(),group['id'])), 'scenes':scenes}
    value['available_tags']=tag_names(source)
    return value


def normalized(vector):
    value = np.asarray(vector, dtype=np.float32)
    if value.ndim != 1 or value.size < 16 or not np.isfinite(value).all() or np.linalg.norm(value) < 1e-8:
        raise ValueError('Face model returned an invalid embedding.')
    return value / np.linalg.norm(value)


def unnamed_person(db):
    names = {row[0] for row in db.execute('SELECT name FROM people')}
    number = 1
    while f'Person {number}' in names: number += 1
    return f'Person {number}'


def add_faces(digest, raw, detected):
    public(digest)
    picture = image(raw)
    with database() as db:
        if db.execute('SELECT faces_done FROM assets WHERE digest=?', (digest,)).fetchone()[0]: return
        used = set()
        for detected_face in detected[:100]:
            if detected_face.confidence < .6 or min(detected_face.width, detected_face.height) < 32 or not detected_face.embedding: continue
            embedding = normalized(detected_face.embedding)
            candidates = []
            for person in db.execute('SELECT * FROM people WHERE count>0').fetchall():
                prototype = np.asarray(json.loads(person['centroid']), dtype=np.float32)
                if prototype.shape == embedding.shape and person['id'] not in used:
                    candidates.append((float(np.dot(embedding, prototype)), person['id']))
            candidates.sort(reverse=True)
            best = candidates[0][0] if candidates else 0.0
            gap = best-(candidates[1][0] if len(candidates)>1 else 0)
            matched = best >= .60 and gap >= .08
            if matched: person_id = candidates[0][1]
            else:
                person_id = uuid4().hex
                db.execute('INSERT INTO people VALUES (?,?,?,0)', (person_id, unnamed_person(db), json.dumps(embedding.tolist())))
            used.add(person_id)
            x1,y1,x2,y2 = detected_face.box
            box = [max(0,int(x1)), max(0,int(y1)), min(picture.width,int(x2)), min(picture.height,int(y2))]
            if box[2] <= box[0] or box[3] <= box[1]: continue
            crop = picture.crop(box); crop.thumbnail((112,112)); output=io.BytesIO(); crop.save(output,'JPEG',quality=85)
            db.execute('INSERT INTO faces VALUES (?,?,?,?,?,?,?,?,0)', (uuid4().hex,digest,person_id,json.dumps(box),json.dumps(embedding.tolist()),output.getvalue(),best,int(not matched)))
            recompute(db, person_id)
        db.execute('UPDATE assets SET faces_done=1 WHERE digest=?', (digest,))


def recompute(db, identifier):
    vectors = [json.loads(row[0]) for row in db.execute('SELECT embedding FROM faces WHERE person_id=? AND excluded=0', (identifier,))]
    if vectors:
        mean = normalized(np.asarray(vectors).mean(axis=0)).tolist()
        db.execute('UPDATE people SET centroid=?,count=? WHERE id=?', (json.dumps(mean),len(vectors),identifier))
    else: db.execute('UPDATE people SET count=0 WHERE id=?', (identifier,))


def rename_person(identifier, name):
    name = ' '.join(name.split())
    if not name or len(name)>120: raise ValueError('Use a person label of 1 to 120 characters.')
    with database() as db:
        if not db.execute('SELECT 1 FROM people WHERE id=?', (identifier,)).fetchone(): raise ValueError('Person group no longer exists.')
        matches=[row for row in db.execute('SELECT id,name,count FROM people ORDER BY count DESC,id')
                 if row['id']!=identifier and name_key(row['name'])==name_key(name)]
        target=matches[0]['id'] if matches else identifier
        if matches:
            name=' '.join(matches[0]['name'].split())
        db.execute('UPDATE people SET name=? WHERE id=?', (name,target))
        merged=0
        for other in [identifier, *(row['id'] for row in matches)]:
            if other!=target:
                _merge_people(db,other,target); merged+=1
        return {'ok':True,'person_id':target,'name':name,'merged':merged}


def pending_ids(source,faces=True,model=''):
    """Bounded continuation batches over explicitly cataloged, visible images."""
    if source=='library':
        from services import image_library
        entries=[(row['id'],row['sha256']) for row in image_library.public_index()['images'] if not row.get('hidden')]
    elif source=='image-manager':
        from services.image_manager import manager
        with manager.database() as db:
            entries=[(row['id'],row['signature']) for row in db.execute('SELECT id,signature FROM images WHERE available=1 AND hidden=0 ORDER BY relative')]
    else: raise ValueError('Choose an image catalog.')
    with database() as db:
        existing={row['id']:dict(row) for row in db.execute('SELECT s.id,s.stamp,a.faces_done,a.scenes_done FROM sources s JOIN assets a ON a.digest=s.digest WHERE s.source=?',(source,))}
    result=[]
    for identifier,stamp in entries:
        saved=existing.get(identifier)
        if not saved or saved['stamp']!=stamp or (faces and not saved['faces_done']) or (model and not saved['scenes_done']): result.append(identifier)
    return result[:1000],len(result)


def correct_face(identifier, person_id=None, exclude=False, name=None):
    if name is not None:
        name = ' '.join(name.split())
        if not name or len(name)>120: raise ValueError('Use a person label of 1 to 120 characters.')
        if person_id or exclude: raise ValueError('A new name is only used when separating a face into a new person.')
    with database() as db:
        return _correct_face(db, identifier, person_id, exclude, name)


def _correct_face(db, identifier, person_id=None, exclude=False, name=None):
    """Share the correction transaction with the Break Room answer and undo."""
    row = db.execute('SELECT * FROM faces WHERE id=?', (identifier,)).fetchone()
    if not row: raise ValueError('Face no longer exists.')
    public(row['digest'])
    if person_id and not db.execute('SELECT 1 FROM people WHERE id=?', (person_id,)).fetchone(): raise ValueError('Choose an existing person group.')
    if exclude and not person_id: person_id = row['person_id']
    if not person_id and name:
        matches=[person['id'] for person in db.execute('SELECT id,name FROM people ORDER BY count DESC,id')
                 if name_key(person['name'])==name_key(name)]
        if matches:
            person_id=matches[0]
            for other in matches[1:]: _merge_people(db,other,person_id)
            # A legacy duplicate may have been the face's previous group.
            row=db.execute('SELECT * FROM faces WHERE id=?',(identifier,)).fetchone()
    if not person_id:
        person_id = uuid4().hex
        db.execute('INSERT INTO people VALUES (?,?,?,0)', (person_id,name or unnamed_person(db),row['embedding']))
    db.execute('UPDATE faces SET person_id=?,excluded=?,uncertain=0 WHERE id=?', (person_id,int(exclude),identifier))
    recompute(db,row['person_id']); recompute(db,person_id)
    return {'ok':True,'person_id':person_id}


def merge_people(source_id, target_id):
    if source_id == target_id: raise ValueError('Choose two different groups.')
    with database() as db:
        if db.execute('SELECT COUNT(*) FROM people WHERE id IN (?,?)', (source_id,target_id)).fetchone()[0] != 2: raise ValueError('Person group no longer exists.')
        target=db.execute('SELECT name FROM people WHERE id=?',(target_id,)).fetchone()['name']
        others=[row['id'] for row in db.execute('SELECT id,name FROM people')
                if row['id']!=target_id and (row['id']==source_id or (named(target) and name_key(row['name'])==name_key(target)))]
        for other in others: _merge_people(db,other,target_id)
    return {'ok':True,'person_id':target_id,'name':target}


def _merge_people(db, source_id, target_id):
    # Saving an existing name or choosing Merge is an explicit user correction.
    db.execute('UPDATE faces SET person_id=?,uncertain=0 WHERE person_id=?', (target_id,source_id))
    db.execute('DELETE FROM people WHERE id=?', (source_id,)); recompute(db,target_id)


def set_scenes(digest, labels, model='manual'):
    public(digest)
    labels = sorted(set(labels))
    if any(label not in SCENES for label in labels): raise ValueError('Choose supported scene labels.')
    with database() as db:
        db.execute('UPDATE assets SET scenes=?,scenes_done=1,model=? WHERE digest=?', (json.dumps(labels),model,digest))
    return result(digest)


def crop(identifier):
    with database() as db:
        row = db.execute('SELECT digest,crop FROM faces WHERE id=? AND excluded=0', (identifier,)).fetchone()
        if not row: raise ValueError('Face preview is unavailable.')
        public(row['digest']); return row['crop']


def review(source, identifier, change=None):
    """Keep each workspace's existing review metadata and originals intact."""
    if source == 'library':
        from services import image_library as lib
        item = next((row for row in lib.public_index()['images'] if row['id']==identifier), None)
        if not item: raise ValueError('Image unavailable.')
        names = {tag['id']:tag['name'] for tag in lib.read_index()['tags']}
        if change is not None:
            value = review_metadata.patch(library_review(item,names),change)
            # Validate all fields before creating tags or writing source metadata.
            tags = None
            if 'tags' in change:
                tags = []
                with lib.LOCK:
                    known = {tag['name'].casefold():tag['id'] for tag in lib.read_index()['tags']}
                    for label in value['tags']:
                        key = label.casefold()
                        if key not in known: known[key] = lib.tag(label)['id']
                        if known[key] not in tags: tags.append(known[key])
            item = lib.edit_image(identifier, rating=value['rating'], set_rating='rating' in change or 'review_status' in change,
                                  caption=value['caption'] if 'caption' in change else None, tag_ids=tags,
                                  **{key:value[key] for key in ('category','project','favorite','review_status') if key in change})
        names = {tag['id']:tag['name'] for tag in lib.read_index()['tags']}
        return library_review(item,names)
    if source not in ('image-manager','media-manager'): raise ValueError('Choose a supported media source.')
    if source == 'image-manager':
        from services.image_manager import manager
        record=media_record(source,identifier)
        if record['file_state']=='present':
            read_source(source,identifier)  # Validate content and privacy before changing metadata.
        elif record['file_state']=='changed' and change is not None:
            raise ValueError('Image changed since scanning. Scan again before saving its review.')
    with database() as db:
        row = db.execute('SELECT digest FROM sources WHERE source=? AND id=?', (source,identifier)).fetchone()
        if not row: raise ValueError('Open or classify this item first.')
        digest = row['digest']; public(digest)
        item=manager.image(identifier) if source=='image-manager' else None
        value = saved_review(db,source,identifier,digest,favorite=bool(item['favorite']) if item else None)
        if source=='image-manager':
            value['tags']=item['tags']; value['favorite']=bool(item['favorite'])
        if change is not None:
            value=review_metadata.patch(value,change)
            if source=='image-manager':
                # Preserve the old Like button contract for clients without a
                # favorite field. New clients can set status/favorite separately.
                favorite=value['favorite'] if 'favorite' in change else (change['rating']=='liked' if 'rating' in change else None)
                manager.metadata([identifier],tags=value['tags'] if 'tags' in change else None,favorite=favorite)
                if favorite is not None: value['favorite']=favorite
            db.execute('INSERT INTO source_reviews(source,id,digest,value) VALUES (?,?,?,?) ON CONFLICT(source,id,digest) DO UPDATE SET value=excluded.value',
                       (source,identifier,digest,json.dumps(value)))
        return value
