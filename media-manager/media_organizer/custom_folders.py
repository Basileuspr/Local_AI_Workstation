"""Saved custom folders and explicit, selected-file move plans."""
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import uuid

from . import constants as C, manifest, mover
from . import folder_browser


def create_folder(reports, name, parent=None):
    if parent is None:
        parent = folder_browser.media_root(reports) / 'Custom Folders'
        parent.mkdir(parents=True, exist_ok=True)
    destination = folder_browser.create(parent, name)
    return add_folder(reports, str(destination), name)


def folders(reports: Path) -> list:
    path = reports / 'custom-folders.json'
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, list):
        raise ValueError('The custom-folder catalog is invalid.')
    return data


def add_folder(reports: Path, path: str, name: str = '') -> dict:
    path = str(path or '').strip().strip('"')
    if not path or not Path(path).is_absolute():
        raise ValueError('Choose a folder or enter its full absolute path.')
    destination = Path(path).resolve()
    if destination.exists() and not destination.is_dir():
        raise ValueError('The custom destination must be a folder.')
    label = str(name or '').strip() or destination.name or str(destination)
    if len(label) > 100:
        raise ValueError('Use a folder label of 100 characters or fewer.')
    entries = folders(reports)
    existing = next((entry for entry in entries if Path(entry['path']).resolve() == destination), None)
    if existing:
        return existing
    destination.mkdir(parents=True, exist_ok=True)
    entry = dict(id=uuid.uuid4().hex, name=label, path=str(destination))
    entries.append(entry)
    reports.mkdir(parents=True, exist_ok=True)
    manifest.write_json(str(reports / 'custom-folders.json'), entries)
    return entry


def allocate_name(folder: Path, name: str, sha: str, reserved: set) -> Path:
    candidate = folder / Path(name).name
    counter = 1
    while str(candidate).lower() in reserved or candidate.exists():
        candidate = folder / f'{Path(name).stem[:180]}__{sha[:8]}__custom{counter}{Path(name).suffix}'
        counter += 1
    reserved.add(str(candidate).lower())
    return candidate


def prepare(state, run_id: str, folder_id: str, record_ids: list) -> dict:
    if not isinstance(record_ids, list) or not record_ids:
        raise ValueError('Select at least one clip first.')
    folder = next((entry for entry in folders(state.reports) if entry['id'] == folder_id), None)
    if not folder:
        raise ValueError('Choose a saved custom folder.')
    destination = Path(folder['path']).resolve()
    if not destination.is_dir():
        raise ValueError('The custom folder is unavailable. Reconnect the drive or choose another folder.')
    data = state.library(run_id)
    lookup = {str(row['RecordId']): row for row in data['records']}
    selected = list(dict.fromkeys(str(value) for value in record_ids))
    if any(record_id not in lookup for record_id in selected):
        raise ValueError('The selection contains a file outside this scan. Reload and select again.')
    records, skipped, reserved = [], [], set()
    for record_id in selected:
        row = lookup[record_id]
        reason = None
        if row.get('Trashed'):
            reason = 'Restore this item from Trash before moving it.'
        elif not row.get('Available'):
            reason = 'File is unavailable.'
        elif row.get('IntegrityStatus') not in C.MOVABLE_STATUSES or not row.get('SHA256'):
            reason = 'File did not pass the scan integrity checks.'
        if reason:
            skipped.append(dict(recordId=record_id, name=row['OriginalFilename'], reason=reason))
            continue
        source = state.media_path(run_id, record_id, data)
        if source.parent == destination:
            skipped.append(dict(recordId=record_id, name=row['OriginalFilename'], reason='Already in this folder.'))
            continue
        record = dict(row, OriginalPath=str(source), OriginalFilename=source.name)
        problem = mover._preflight(record)
        if problem:
            skipped.append(dict(recordId=record_id, name=source.name, reason=problem))
            continue
        target = allocate_name(destination, source.name, row['SHA256'], reserved)
        record['ProposedDestination'] = str(target)
        records.append(record)
    if not records:
        raise ValueError('Nothing to move. ' + ' '.join(item['reason'] for item in skipped[:3]))
    plan = dict(id=uuid.uuid4().hex, runId=run_id, folder=folder, records=records,
                skipped=skipped, status='preview', created=datetime.now().isoformat())
    directory = state.run_path(run_id) / 'custom-plans'
    directory.mkdir(parents=True, exist_ok=True)
    manifest.write_json(str(directory / f"{plan['id']}.json"), plan)
    return public_plan(plan)


def public_plan(plan):
    return dict(planId=plan['id'], runId=plan['runId'], folder=plan['folder'], skipped=plan['skipped'],
                files=[dict(recordId=r['RecordId'], source=r['OriginalPath'], destination=r['ProposedDestination'],
                            size=r.get('FileSize', 0)) for r in plan['records']])


def consume_plan(state, run_id, plan_id):
    if not re.fullmatch(r'[a-f0-9]{32}', str(plan_id or '')):
        raise ValueError('Preview the selected move first.')
    path = state.run_path(run_id) / 'custom-plans' / f'{plan_id}.json'
    plan = json.loads(path.read_text(encoding='utf-8'))
    if plan['status'] != 'preview' or plan['runId'] != run_id:
        raise ValueError('This move plan has already been used. Preview a new selection.')
    folder = next((item for item in folders(state.reports) if item['id'] == plan['folder']['id']), None)
    if folder != plan['folder'] or not Path(folder['path']).is_dir():
        raise ValueError('The destination folder changed or is unavailable. Preview again.')
    current = state.library(run_id)
    for row in plan['records']:
        if state.media_path(run_id, str(row['RecordId']), current) != Path(row['OriginalPath']).resolve():
            raise ValueError('A selected file changed location. Preview the selection again.')
    plan['status'] = 'started'
    manifest.write_json(str(path), plan)
    return plan


def execute(state, plan, on_progress):
    """Reuse the existing no-overwrite primitive and undo-compatible write-ahead log."""
    stamp = datetime.now().strftime('%Y-%m-%d_%H%M%S')
    directory = state.run_path(plan['runId']) / 'moves' / f"move_{stamp}_custom_{plan['id'][:8]}"
    directory.mkdir(parents=True)
    log = mover.OpLog(str(directory / 'operations.jsonl'))
    counts = dict(success=0, skipped=0, failed=0, source_kept=0)
    completed = []
    log.write(dict(type='session', format=C.OPLOG_FORMAT, action='move', mode='custom-selection',
                   plan_id=plan['id'], destination_root=plan['folder']['path'], started=mover._now()))
    total = len(plan['records'])
    try:
        for index, row in enumerate(plan['records'], 1):
            on_progress(phase='moving', completed=index - 1, total=total, currentFile=row['OriginalPath'])
            entry = dict(type='op', op_id=index, record_id=row['RecordId'], source=row['OriginalPath'],
                         destination=row['ProposedDestination'], original_filename=row['OriginalFilename'],
                         sha256=row['SHA256'], size=row['FileSize'], mtime_ns=row.get('MtimeNs'),
                         custom_folder_id=plan['folder']['id'], started=mover._now())
            problem = mover._preflight(row)
            if problem:
                entry.update(status='skipped', note=problem)
                counts['skipped'] += 1
            else:
                target = row['ProposedDestination']
                if os.path.lexists(target):
                    target = mover._free_name(target, row['SHA256'])
                    entry['note'] = 'A new file appeared at the planned destination; a free name was used.'
                entry.update(final_destination=target, destination_filename=Path(target).name)
                log.write(dict(entry, phase='begin'))
                try:
                    result = mover.safe_move(row['OriginalPath'], target, row['SHA256'], verify='always', tmp_tag=f'custom{index}')
                    entry.update(status='success' if result['source_removed'] else 'copied-source-kept',
                                 method=result['method'], verification=result['verification'])
                    counts['success' if result['source_removed'] else 'source_kept'] += 1
                except Exception as exc:
                    entry.update(status='failed', error=str(exc))
                    counts['failed'] += 1
            entry.update(phase='end', finished=mover._now())
            log.write(entry)
            completed.append(entry)
            on_progress(phase='moving', completed=index, total=total)
    finally:
        log.write(dict(type='session_end', counts=counts, finished=mover._now()))
        log.close()
    on_progress(phase='finalizing', completed=total, total=total)
    manifest.write_csv(str(directory / 'operations.csv'), [mover._ops_row(entry) for entry in completed], mover.OPS_CSV_COLUMNS)
    message = f"Custom folder: {counts['success']} moved, {counts['skipped']} skipped, {counts['failed']} failed, {counts['source_kept']} copied with source kept."
    details = message + '\n' + '\n'.join(f"{entry['status']}: {entry['source']} -> {entry.get('final_destination', entry['destination'])}\n{entry.get('error') or entry.get('note') or ''}" for entry in completed)
    details += f'\nUndo preview: .\\media-organizer undo "{directory}"\nUndo: .\\media-organizer undo "{directory}" --execute'
    (directory / 'move_summary.txt').write_text(details, encoding='utf-8')
    try:
        backup = Path(plan['folder']['path']) / C.LOGS_FOLDER / directory.name
        backup.mkdir(parents=True, exist_ok=True)
        for name in ('operations.jsonl', 'operations.csv', 'move_summary.txt'):
            shutil.copy2(directory / name, backup / name)
    except OSError as exc:
        details += f'\nCould not copy the log to the custom folder: {exc}. The original log is at {directory}.'
    return dict(runId=plan['runId'], status='error' if counts['failed'] else 'complete', message=message, details=details,
                customFolderId=plan['folder']['id'])
