"""UI metadata and reversible single-file operations, independent of the host app."""
import json
import os
from pathlib import Path
import re
import time
import uuid

from . import manifest, mover, hashing

TRASH_NAME = '.media-manager-trash'


def metadata(reports):
    path = reports / 'ui-metadata.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'tags': [], 'assignments': {}}


def tag_action(state, payload):
    with state.lock:
        data = metadata(state.reports)
        if payload.get('action') == 'create':
            name = str(payload.get('name', '')).strip()
            if not name or len(name) > 60:
                raise ValueError('Enter a tag name of 1–60 characters.')
            existing = next((tag for tag in data['tags'] if tag['name'].casefold() == name.casefold()), None)
            if not existing:
                existing = dict(id=uuid.uuid4().hex, name=name)
                data['tags'].append(existing)
        else:
            tag_id = payload.get('tagId')
            if not any(tag['id'] == tag_id for tag in data['tags']):
                raise ValueError('Choose an existing tag.')
            rows = state.library(payload.get('runId'))['records']
            ids = payload.get('recordIds')
            if not isinstance(ids, list) or not ids or any(str(id) not in {r['RecordId'] for r in rows} for id in ids):
                raise ValueError('Select scanned items to tag.')
            for row in rows:
                if row['RecordId'] not in ids:
                    continue
                sha = row.get('SHA256')
                if not sha:
                    raise ValueError('Re-scan this item to compute its content hash before tagging.')
                assigned = set(data['assignments'].get(sha, []))
                if payload.get('action') == 'remove': assigned.discard(tag_id)
                elif payload.get('action') == 'assign': assigned.add(tag_id)
                else: raise ValueError('Unknown tag action.')
                data['assignments'][sha] = sorted(assigned)
        state.reports.mkdir(parents=True, exist_ok=True)
        manifest.write_json(str(state.reports / 'ui-metadata.json'), data)
        return {'tags': data['tags'], 'tag': existing if payload.get('action') == 'create' else None}


def filename(value):
    name = str(value or '').strip()
    if not name or len(name) > 200 or name.endswith(('.', ' ')) or re.search(r'[<>:"/\\|?*\x00-\x1f]', name):
        raise ValueError('Use a filename of 1–200 characters without path separators or reserved characters.')
    if name in ('.', '..') or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])', name.split('.')[0], re.I):
        raise ValueError('This filename is reserved by Windows.')
    if not name.lower().endswith('.mp4'): name += '.mp4'
    return name


def checked_path(value):
    path = Path(value).absolute()
    if any(part.is_symlink() or part.is_junction() for part in [path, *path.parents]):
        raise ValueError('Directory links and symbolic links are excluded from file actions.')
    if any('nvidia' in part.casefold() for part in path.parts): raise ValueError('NVIDIA paths are excluded.')
    return path


def current_row(state, payload):
    data = state.library(payload.get('runId'))
    row = next((r for r in data['records'] if r['RecordId'] == str(payload.get('recordId'))), None)
    if not row or not row['Available'] or not row.get('SHA256'):
        raise ValueError('This scanned file is unavailable. Reload or re-scan.')
    checked_path(row['CurrentPath'])
    source = state.media_path(payload['runId'], row['RecordId'], data)
    if str(source) != payload.get('expectedPath'):
        raise ValueError('The file location changed. Reload before trying again.')
    problem = mover._preflight(dict(row, OriginalPath=str(source)))
    if problem: raise ValueError(problem)
    return row, source


def apply_file_action(state, payload, source, target, sha, progress):
    # A thumbnail decoder or recently closed video preview can hold a Windows
    # sharing lock briefly. Retry only those locks, with identity/hash checks
    # on every attempt. Other errors remain visible; no file is overwritten.
    deadline = time.monotonic() + 12
    while True:
        if state.cancel_event.is_set(): raise ValueError('Stopped. This file was retained.')
        current_row(state, payload); checked_path(target)
        try:
            if payload['action'] != 'purge': return mover.safe_move(str(source), str(target), sha, verify='always')
            before = source.stat()
            actual, _ = hashing.sha256_file(str(source), stop_event=state.cancel_event)
            if actual != sha: raise ValueError('Trash file no longer matches its scanned SHA-256; nothing was deleted.')
            current_row(state, payload)
            after = source.stat()
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns):
                raise ValueError('Trash file changed; nothing was deleted.')
            if state.cancel_event.is_set(): raise ValueError('Stopped. This file was retained.')
            source.unlink()
            return dict(source_removed=True, method='permanent deletion from Trash', verification='SHA-256 matches the scanned file')
        except OSError as error:
            if getattr(error, 'winerror', None) not in (32, 33): raise
            if time.monotonic() >= deadline:
                raise ValueError('The file is still in use. Close its preview and try again; it was retained.') from error
            progress(phase='waiting for preview to finish', currentFile=str(source))
            state.cancel_event.wait(.15)


def execute(state, payload, progress):
    action = payload.get('action')
    if action not in ('rename', 'delete', 'restore', 'purge'): raise ValueError('Unknown file action.')
    row, source = current_row(state, payload)
    if action == 'delete':
        if row.get('Trashed'): raise ValueError('This item is already in Trash.')
        if payload.get('confirmation') != 'DELETE': raise ValueError('Type DELETE to move this file to recoverable Trash.')
        target = source.parent / TRASH_NAME / uuid.uuid4().hex / source.name
    elif action == 'purge':
        if not row.get('Trashed') or source.parent.parent.name != TRASH_NAME or not re.fullmatch('[a-f0-9]{32}', source.parent.name):
            raise ValueError('Only files in Media Manager’s recoverable Trash can be permanently deleted.')
        if payload.get('confirmation') != 'DELETE FOREVER': raise ValueError('Type DELETE FOREVER to permanently delete this Trash file.')
        target = source
    elif action == 'restore':
        if not row.get('Trashed') or not row.get('RestorePath'): raise ValueError('This item is not in Trash.')
        target = Path(row['RestorePath'])
    else:
        if row.get('Trashed'): raise ValueError('Restore this item before renaming it.')
        target = source.with_name(filename(payload.get('name')))
    target = checked_path(target)
    if action != 'purge' and os.path.lexists(target): raise ValueError('That filename already exists. Choose another name; nothing was overwritten.')
    progress(phase='moving', total=1, currentFile=str(source))
    directory = state.run_path(payload['runId']) / 'moves' / ('media_' + uuid.uuid4().hex)
    directory.mkdir(parents=True)
    log = mover.OpLog(str(directory / 'operations.jsonl'))
    entry = dict(type='op', op_id=1, record_id=row['RecordId'], source=str(source), destination=str(target),
                 final_destination=str(target), sha256=row['SHA256'], size=row['FileSize'],
                 media_action=action, original_filename=source.name, started=mover._now())
    log.write(dict(entry, phase='begin'))
    try:
        result = apply_file_action(state, payload, source, target, row['SHA256'], progress)
        log.write(dict(entry, phase='end', status='success' if result['source_removed'] else 'copied-source-kept',
                       method=result['method'], verification=result['verification'], finished=mover._now()))
    except Exception as exc:
        log.write(dict(entry, phase='end', status='failed', error=str(exc), finished=mover._now()))
        raise
    finally:
        log.close()
    progress(phase='moving', completed=1, total=1)
    return {'runId': payload['runId'], 'message': f"{ {'rename':'Renamed', 'delete':'Moved to recoverable Trash', 'restore':'Restored', 'purge':'Permanently deleted'}[action] }: {target.name}",
            'details': f'{source}\n→ {target}\nSHA-256 verified. Operation log: {directory}'}


def validate_batch(state, payload):
    items = payload.get('items')
    action = payload.get('action')
    if action not in ('delete', 'restore', 'purge') or not isinstance(items, list) or not 1 <= len(items) <= 1000 or any(not isinstance(item, dict) for item in items):
        raise ValueError('Select 1–1,000 files to delete or restore.')
    ids = [item.get('recordId') for item in items]
    if any(not isinstance(identifier, str) for identifier in ids) or len(set(ids)) != len(ids):
        raise ValueError('Select distinct scanned files.')
    phrase = f'{ {"delete":"DELETE", "restore":"RESTORE", "purge":"DELETE FOREVER"}[action]} {len(items)}'
    if payload.get('confirmation') != phrase: raise ValueError(f'Use the confirmation button for the reviewed selection.')
    paths = set()
    for item in items:
        row, source = current_row(state, dict(runId=payload.get('runId'), **item))
        key = os.path.normcase(str(source))
        if key in paths: raise ValueError('Two selected records refer to the same file. Reload the library.')
        paths.add(key)
        if bool(row.get('Trashed')) != (action != 'delete'): raise ValueError('The selection contains files with a different Trash status. Reload the library.')
        if action == 'restore' and (not row.get('RestorePath') or os.path.lexists(row['RestorePath'])):
            raise ValueError('An original filename already exists. Nothing was overwritten.')
        if action == 'restore': checked_path(row['RestorePath'])
    return items


def execute_batch(state, payload, progress):
    items = validate_batch(state, payload)
    for item in items:
        row, source = current_row(state, dict(runId=payload['runId'], **item))
        progress(phase='verifying selection', total=len(items), completed=0, currentFile=str(source))
        sha, _ = hashing.sha256_file(str(source), stop_event=state.cancel_event)
        if sha != row['SHA256']: raise ValueError('A selected file changed since scanning (SHA-256 mismatch). No files were moved.')
        if payload['action'] == 'purge' and (source.parent.parent.name != TRASH_NAME or not re.fullmatch('[a-f0-9]{32}', source.parent.name)):
            raise ValueError('A selected file is outside Media Manager’s Trash. No files were deleted.')
    details = []
    for index, item in enumerate(items):
        if state.cancel_event.is_set(): raise ValueError(f'Stopped after {index} of {len(items)} files. Completed moves remain recoverable.')
        def update(**values):
            values.update(total=len(items), completed=index + values.get('completed', 0))
            progress(**values)
        result = execute(state, dict(runId=payload['runId'], **item, action=payload['action'], confirmation='DELETE FOREVER' if payload['action'] == 'purge' else 'DELETE'), update)
        details.append(result['details'])
    return dict(runId=payload['runId'], message=f'{ {"delete":"Deleted to recoverable Trash", "restore":"Restored", "purge":"Permanently deleted"}[payload["action"]]}: {len(items)} files.', details='\n\n'.join(details))
