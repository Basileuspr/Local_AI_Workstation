"""UI metadata and reversible single-file operations, independent of the host app."""
import json
import os
from pathlib import Path
import re
import uuid

from . import manifest, mover

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


def current_row(state, payload):
    data = state.library(payload.get('runId'))
    row = next((r for r in data['records'] if r['RecordId'] == str(payload.get('recordId'))), None)
    if not row or not row['Available'] or not row.get('SHA256'):
        raise ValueError('This scanned file is unavailable. Reload or re-scan.')
    source = state.media_path(payload['runId'], row['RecordId'], data)
    if str(source) != payload.get('expectedPath'):
        raise ValueError('The file location changed. Reload before trying again.')
    problem = mover._preflight(dict(row, OriginalPath=str(source)))
    if problem: raise ValueError(problem)
    return row, source


def execute(state, payload, progress):
    action = payload.get('action')
    if action not in ('rename', 'delete', 'restore'): raise ValueError('Unknown file action.')
    row, source = current_row(state, payload)
    if action == 'delete':
        if row.get('Trashed'): raise ValueError('This item is already in Trash.')
        if payload.get('confirmation') != 'DELETE': raise ValueError('Type DELETE to move this file to recoverable Trash.')
        target = source.parent / TRASH_NAME / uuid.uuid4().hex / source.name
    elif action == 'restore':
        if not row.get('Trashed') or not row.get('RestorePath'): raise ValueError('This item is not in Trash.')
        target = Path(row['RestorePath'])
    else:
        if row.get('Trashed'): raise ValueError('Restore this item before renaming it.')
        target = source.with_name(filename(payload.get('name')))
    if os.path.lexists(target): raise ValueError('That filename already exists. Choose another name; nothing was overwritten.')
    progress(phase='moving', total=1, currentFile=str(source))
    directory = state.run_path(payload['runId']) / 'moves' / ('media_' + uuid.uuid4().hex)
    directory.mkdir(parents=True)
    log = mover.OpLog(str(directory / 'operations.jsonl'))
    entry = dict(type='op', op_id=1, record_id=row['RecordId'], source=str(source), destination=str(target),
                 final_destination=str(target), sha256=row['SHA256'], size=row['FileSize'],
                 media_action=action, original_filename=source.name, started=mover._now())
    log.write(dict(entry, phase='begin'))
    try:
        result = mover.safe_move(str(source), str(target), row['SHA256'], verify='always')
        log.write(dict(entry, phase='end', status='success' if result['source_removed'] else 'copied-source-kept',
                       method=result['method'], verification=result['verification'], finished=mover._now()))
    except Exception as exc:
        log.write(dict(entry, phase='end', status='failed', error=str(exc), finished=mover._now()))
        raise
    finally:
        log.close()
    progress(phase='moving', completed=1, total=1)
    return {'runId': payload['runId'], 'message': f"{ {'rename':'Renamed', 'delete':'Moved to recoverable Trash', 'restore':'Restored'}[action] }: {target.name}",
            'details': f'{source}\n→ {target}\nSHA-256 verified. Operation log: {directory}'}
