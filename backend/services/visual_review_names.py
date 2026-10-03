"""Project user-supplied person names into source tag filters.

Manual tags stay in their source catalog. Linked names are read from the face
catalog, so corrections and merges cannot leave stale name tags behind.
"""
import json
import re
import sqlite3


def name_key(name):
    return ' '.join(name.split()).casefold()


def named(name):
    return bool(name.strip()) and not re.fullmatch(r'Person [0-9]+', name)


def tags(manual, people):
    linked = {name_key(person['name']): person['name'] for person in people}
    return [name for name in manual if name_key(name) not in linked] + list(linked.values())


def sources(source):
    # Listing an unclassified workspace must not create the review database.
    # Use a separate read connection without taking a second catalog's lock.
    from services import visual_review, image_vault
    from services.storage_libraries import no_links
    path = no_links(visual_review.ROOT / 'catalog.sqlite3')
    if not path.is_file():
        return {}
    locked = image_vault.locked_hashes()
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=15)
    db.row_factory = sqlite3.Row
    try:
        if not {'sources', 'faces', 'people'} <= {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
            return {}
        stamp = 's.stamp' if 'stamp' in {row['name'] for row in db.execute('PRAGMA table_info(sources)')} else "''"
        result = {}
        for row in db.execute(f'''SELECT DISTINCT s.id,s.digest,{stamp} AS stamp,p.id AS person_id,p.name
          FROM sources s JOIN faces f ON f.digest=s.digest JOIN people p ON p.id=f.person_id
          WHERE s.source=? AND f.excluded=0 ORDER BY s.id,p.name,p.id''', (source,)):
            if row['digest'] in locked or not named(row['name']):
                continue
            entry = result.setdefault(row['id'], {'digest': row['digest'], 'stamp': row['stamp'], 'people': []})
            entry['people'].append({'id': row['person_id'], 'name': row['name']})
        return result
    finally:
        db.close()


def image_table(db):
    """A connection-local view used before filtering/counting/pagination."""
    linked = sources('image-manager')
    if not linked:
        return '(SELECT *,tags AS filter_tags FROM images)', linked
    db.execute('CREATE TEMP TABLE review_names(id TEXT PRIMARY KEY,stamp TEXT,names TEXT)')
    db.executemany('INSERT INTO review_names VALUES (?,?,?)',
                   [(identifier, entry['stamp'], json.dumps(entry['people'])) for identifier, entry in linked.items()])
    db.create_function('review_tags', 2, lambda manual, people: json.dumps(tags(json.loads(manual), json.loads(people or '[]'))), deterministic=True)
    return '''(SELECT original.*,review_tags(original.tags,n.names) AS filter_tags FROM images original
      LEFT JOIN review_names n ON n.id=original.id AND n.stamp=original.signature)''', linked


def library_index(index):
    """Reuse saved tag IDs; expose an unsaved name through its stable person ID."""
    linked = sources('library')
    choices = [dict(tag) for tag in index['tags']]
    known = {name_key(tag['name']): tag for tag in choices}
    images = []
    for item in index['images']:
        entry = linked.get(item['id'])
        people = entry['people'] if entry and entry['digest'] == item['sha256'] else []
        identifiers = []
        for person in people:
            key = name_key(person['name'])
            if key not in known:
                known[key] = {'id': person['id'], 'name': person['name'], 'person_id': person['id']}
                choices.append(known[key])
            identifiers.append(known[key]['id'])
        manual = item.get('manual_tag_ids', item.get('tag_ids', []))
        images.append({**item, 'manual_tag_ids': manual, 'person_tag_ids': list(dict.fromkeys(identifiers)),
                       'tag_ids': list(dict.fromkeys([*manual, *identifiers]))})
    return {**index, 'images': images, 'tags': choices}
