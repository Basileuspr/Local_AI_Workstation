"""A derived library across saved scans; scan manifests remain unchanged."""
import os
from pathlib import Path

from . import custom_folders, media_actions, planner

ALL_SCANS = 'all-scans'


def path_key(path):
    return os.path.normcase(str(Path(path).resolve()))


def split_record(record_id):
    run_id, separator, source_id = str(record_id).partition('~')
    if not separator or not source_id or run_id == ALL_SCANS:
        raise ValueError('This library item is invalid. Reload All scans.')
    return run_id, source_id


def library(state):
    scans, errors = [], []
    for file in state.reports.glob('*/manifest.json'):
        if file.parent.name == ALL_SCANS: continue
        try:
            data = state.library(file.parent.name)
            data['_scanModified'] = file.stat().st_mtime_ns
            scans.append(data)
        except (OSError, ValueError, KeyError, TypeError) as error:
            errors.append(dict(scan=file.parent.name, error=str(error)))
    scans.sort(key=lambda data: (data['run'].get('finished', ''), data['_scanModified'], data['uiRunId']), reverse=True)
    rows, aliases = [], {}
    for data in scans:
        for record in data['records']:
            row = dict(record, OriginRunId=data['uiRunId'], OriginRecordId=record['RecordId'],
                       ScanSource=data['run']['source_root'], ScanDestination=data['run']['destination_root'],
                       ScanFinished=data['run'].get('finished', ''), RecordId=f"{data['uiRunId']}~{record['RecordId']}")
            rows.append(row)
            if row['Available'] and row.get('SHA256'):
                current = path_key(row['CurrentPath'])
                for previous in row.get('KnownPaths', []):
                    old = path_key(previous)
                    if old != current and not os.path.exists(previous):
                        aliases.setdefault((old, row['SHA256']), current)
    locations = {}
    for row in rows:
        key = path_key(row['CurrentPath']); visited = set()
        while (key, row.get('SHA256')) in aliases and key not in visited:
            visited.add(key); key = aliases[(key, row['SHA256'])]
        # Actual available locations win over historical paths that have moved.
        # Otherwise the newest scan supplies the metadata for a repeated path.
        existing = locations.get(key)
        if existing is None or (row['Available'] and not existing['Available']):
            row['SeenInScans'] = list(existing['SeenInScans']) if existing else []
            locations[key] = row
        chosen = locations[key]
        if row['OriginRunId'] not in chosen['SeenInScans']: chosen['SeenInScans'].append(row['OriginRunId'])
    records = list(locations.values())
    groups = {}
    for row in records:
        row.update(DuplicateGroup='', DuplicatePrimary='', DuplicateCount=1, DuplicateOtherPaths='', DuplicateStatus='Unique' if row.get('SHA256') else 'Not checked (no hash)')
        if row.get('SHA256'): groups.setdefault(row['SHA256'], []).append(row)
    for sha, copies in groups.items():
        active = [r for r in copies if not r['Trashed']]
        primary = min((r for r in active if r['Available']), key=planner._primary_key, default=None)
        for row in copies:
            row['ActiveCopies'] = sum(r['Available'] for r in active)
            if len(active) > 1 and not row['Trashed']:
                row.update(DuplicateGroup='sha256-' + sha[:16], DuplicateCount=len(active), DuplicateStatus='Duplicate',
                           DuplicatePrimary='yes' if row is primary else 'no',
                           DuplicateOtherPaths=' | '.join(r['CurrentPath'] for r in active if r is not row))
    metadata = media_actions.metadata(state.reports)
    return dict(uiRunId=ALL_SCANS, aggregate=True, records=records, scanCount=len(scans),
                folderCount=len({path_key(s['run']['source_root']) for s in scans}),
                scans=[dict(id=s['uiRunId'], source=s['run']['source_root'], finished=s['run'].get('finished', '')) for s in scans],
                readErrors=errors, customFolders=custom_folders.folders(state.reports), tags=metadata['tags'],
                run=dict(source_root='', destination_root='', options={}))
