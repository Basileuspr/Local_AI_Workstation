"""Reviewed, recoverable deletion of selected catalog files; no host/media imports."""
import hashlib
import json
import os
import shutil
import time
import uuid
from pathlib import Path

TRASH_NAME = '.image-manager-trash'
MAX_ITEMS = 1000


def digest(manager, path, expected, *, cancellable=False):
    from .image_manager import no_links, signature
    no_links(path)
    value = hashlib.sha256()
    with path.open('rb') as stream:
        if signature(os.fstat(stream.fileno())) != expected:
            raise ValueError('A selected image changed. Review the files again.')
        while chunk := stream.read(1024 * 1024):
            if cancellable: manager._check()
            value.update(chunk)
        if signature(os.fstat(stream.fileno())) != expected:
            raise ValueError('A selected image changed while being read.')
    if signature(no_links(path).stat()) != expected:
        raise ValueError('A selected image was replaced. Review the files again.')
    return value.hexdigest()


def write_entry(manager, entry):
    with manager.database() as db:
        db.execute('INSERT INTO trash VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', (entry['id'], json.dumps(entry)))


def entries(manager):
    # Recover catalog bookkeeping after an interrupted move. Recovery never
    # moves/removes any file, and ambiguous copies remain available for review.
    from .image_manager import no_links, signature
    with manager.database() as db:
        rows = [json.loads(row[0]) for row in db.execute('SELECT value FROM trash ORDER BY rowid DESC')]
    result = []
    for entry in rows:
        source, target = Path(entry['original_path']), Path(entry['trash_path'])
        if entry['phase'] in ('restored', 'purged'): continue
        try:
            no_links(target); no_links(source)
            with manager.lock:
                running = bool(manager.job and manager.job['status'] == 'running')
            if running and entry['phase'] not in ('trashed', 'copy-kept'):
                # A live worker owns these phases. Polling must never interpret
                # an in-progress hard link/copy as an interrupted operation.
                if target.is_file(): result.append(entry)
                continue
            if not target.is_file():
                if entry['phase'] == 'purging':
                    entry['phase'] = 'purged'; write_entry(manager, entry)
                if entry['phase'] == 'restoring' and source.is_file() and digest(manager, source, signature(source.stat())) == entry['sha256']:
                    with manager.database() as db:
                        db.execute('UPDATE images SET available=1,signature=? WHERE id=?', (json.dumps(signature(source.stat())), entry['image']['id']))
                        entry['phase'] = 'restored'; db.execute('UPDATE trash SET value=? WHERE id=?', (json.dumps(entry), entry['id']))
                continue
            if entry['phase'] not in ('trashed', 'copy-kept'):
                if digest(manager, target, signature(target.stat())) != entry['sha256']: continue
                entry['phase'] = 'copy-kept' if source.exists() else 'trashed'
                with manager.database() as db:
                    if entry['phase'] == 'trashed': db.execute('UPDATE images SET available=0 WHERE id=?', (entry['image']['id'],))
                    db.execute('UPDATE trash SET value=? WHERE id=?', (json.dumps(entry), entry['id']))
            result.append(entry)
        except (OSError, ValueError):
            # Keep the journal for later recovery when a drive is unavailable.
            continue
    return result


def prepare(manager, action, ids):
    from .image_manager import no_links, signature, now
    if action not in ('delete', 'restore', 'purge') or not isinstance(ids, list) or not 1 <= len(ids) <= MAX_ITEMS or len(set(ids)) != len(ids):
        raise ValueError('Select 1–1,000 distinct files to delete, restore or permanently delete from Trash.')
    reviewed = []
    trashed = {entry['id']: entry for entry in entries(manager)} if action != 'delete' else {}
    for identifier in ids:
        if action == 'delete':
            record, source = manager.image_path(identifier)
            sha = digest(manager, source, record['signature'])
            if record.get('sha256') and sha != record['sha256']:
                raise ValueError('An image no longer matches its scanned hash. Scan again.')
            entry_id = uuid.uuid4().hex
            target = no_links(Path(record['folder_path']) / TRASH_NAME / entry_id / source.name)
            entry = dict(id=entry_id, image=record, original_path=str(source), trash_path=str(target), sha256=sha, deleted_at=now(), phase='pending')
            expected = record['signature']
        else:
            entry = trashed.get(identifier)
            if not entry: raise ValueError('A selected file is no longer in Trash.')
            source = no_links(Path(entry['trash_path']))
            expected_trash = no_links(Path(entry['image']['folder_path']) / TRASH_NAME / entry['id'])
            if source.parent != expected_trash: raise ValueError('The file is outside this manager’s Trash.')
            target = no_links(Path(entry['original_path'])) if action == 'restore' else source
            if action == 'restore':
                if os.path.lexists(target): raise ValueError(f'An existing file would be overwritten: {target}. Move or rename it before restoring.')
                if not target.parent.is_dir(): raise ValueError('The original folder is unavailable. Reconnect it before restoring.')
            expected = signature(source.stat())
            if digest(manager, source, expected) != entry['sha256']: raise ValueError('A file in Trash changed. Nothing was restored.')
        reviewed.append(dict(entry=entry, source=str(source), target=str(target), signature=expected))
    ticket = uuid.uuid4().hex
    review = dict(id=ticket, action=action, expires=time.time() + 600, entries=reviewed,
                  confirmation=f'{ {"delete":"DELETE", "restore":"RESTORE", "purge":"DELETE FOREVER"}[action]} {len(reviewed)}')
    with manager.lock:
        manager.trash_reviews = {key: value for key, value in manager.trash_reviews.items() if value['expires'] > time.time()}
        if len(manager.trash_reviews) >= 32: raise ValueError('Too many file reviews are open. Close them and try again shortly.')
        manager.trash_reviews[ticket] = review
    return {key: review[key] for key in ('id', 'action', 'confirmation')} | {'bytes': sum(item['entry']['image']['bytes'] for item in reviewed),
            'entries': [dict(id=item['entry']['id'], name=item['entry']['image']['relative'], source=item['source'], target=item['target'], bytes=item['entry']['image']['bytes']) for item in reviewed]}


def consume(manager, payload):
    review = manager.trash_reviews.get(payload.get('review_id'))
    if not review or review['expires'] <= time.time() or payload.get('confirmation') != review['confirmation']:
        raise ValueError('The confirmation does not match the reviewed files. Expired reviews must be reopened.')
    return review


def transfer(manager, source, target, expected, sha):
    from .image_manager import no_links, signature
    no_links(source); no_links(target)
    if os.path.lexists(target): raise ValueError('The destination exists; nothing was overwritten.')
    target.parent.mkdir(parents=True, exist_ok=True); no_links(target.parent)
    # An exclusive hard link avoids copying large files on supported volumes.
    # Unsupported volumes use an exclusive, hash-verified copy instead.
    try:
        os.link(source, target, follow_symlinks=False)
    except OSError:
        if os.path.lexists(target): raise
        with target.open('xb') as output:
            with source.open('rb') as stream:
                while chunk := stream.read(1024 * 1024):
                    manager._check(); output.write(chunk)
            output.flush(); os.fsync(output.fileno())
        shutil.copystat(source, target, follow_symlinks=False)
    if digest(manager, target, signature(target.stat()), cancellable=True) != sha or digest(manager, source, expected, cancellable=True) != sha:
        raise ValueError('File verification failed. The original was retained.')
    manager._check(); no_links(source); no_links(target)
    if signature(source.stat()) != expected: raise ValueError('The original changed; it was retained.')
    source.unlink()


def execute(manager, review):
    from .image_manager import no_links, signature, now
    items = review['entries']; action = review['action']
    # Validate the entire selection before the first move, and again per file.
    for index, item in enumerate(items):
        manager._progress(current=index, total=len(items), message=f'Checking reviewed file {index + 1} of {len(items)}…')
        source, target = no_links(Path(item['source'])), no_links(Path(item['target']))
        if digest(manager, source, item['signature'], cancellable=True) != item['entry']['sha256']:
            raise ValueError('A reviewed file changed. No files were moved.')
        if action != 'purge' and os.path.lexists(target): raise ValueError('A reviewed destination now exists. No files were moved.')
    manager.trash_reviews.pop(review['id'], None)
    receipt = dict(id=uuid.uuid4().hex, kind=action, mode=action, status='running', started=now(), entries=[])
    manager._receipt(receipt)
    try:
        for index, item in enumerate(items):
            manager._check(); entry = dict(item['entry']); entry['phase'] = {'delete':'pending', 'restore':'restoring', 'purge':'purging'}[action]; write_entry(manager, entry)
            row = dict(id=entry['image']['id'], source=item['source'], target=item['target'], status='pending'); receipt['entries'].append(row); manager._receipt(receipt)
            source, target = Path(item['source']), Path(item['target'])
            if action == 'purge':
                if digest(manager, source, item['signature'], cancellable=True) != entry['sha256']: raise ValueError('The Trash file changed; it was retained.')
                no_links(source); manager._check()
                if signature(source.stat()) != item['signature']: raise ValueError('The Trash file was replaced; it was retained.')
                source.unlink()
            else: transfer(manager, source, target, item['signature'], entry['sha256'])
            entry['phase'] = {'delete':'trashed', 'restore':'restored', 'purge':'purged'}[action]
            with manager.database() as db:
                if action != 'purge': db.execute('UPDATE images SET available=?,signature=? WHERE id=?', (0 if action == 'delete' else 1, json.dumps(signature(target.stat())), entry['image']['id']))
                db.execute('UPDATE trash SET value=? WHERE id=?', (json.dumps(entry), entry['id']))
            row['status'] = entry['phase']; manager._receipt(receipt)
            manager._progress(current=index + 1, total=len(items), message=f'{ {"delete":"Deleted to Trash", "restore":"Restored", "purge":"Permanently deleted"}[action]}: {index + 1} of {len(items)}')
        receipt['status'] = 'complete'
        return receipt['id']
    except BaseException as error:
        receipt['status'] = 'stopped' if manager.cancel.is_set() else 'failed'; receipt['error'] = str(error)
        raise
    finally:
        receipt['finished'] = now(); manager._receipt(receipt)
