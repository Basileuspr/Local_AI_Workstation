import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import threading

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import hash_auditor as audit
from routes.hash_auditor import router


@pytest.fixture
def manager(tmp_path):
    return audit.HashAuditor(tmp_path / 'catalog' / 'audit.sqlite3')


def scan(manager, roots, excludes=()):
    started = manager.start([str(root) for root in roots], [str(root) for root in excludes])
    manager._thread.join(10)
    assert not manager.busy, 'Fixture scan did not finish'
    result = manager.status()['scans'][0]
    assert result['id'] == started['id']
    return result


def test_catalogue_is_idle_until_explicit_start_and_persists_across_roots(manager, tmp_path):
    one, two = tmp_path / 'one', tmp_path / 'two'
    one.mkdir(); two.mkdir()
    original = b'Full file contents\x00\xff'
    (one / 'a.txt').write_bytes(original)
    (two / 'different-name.bin').write_bytes(original)
    assert manager.status()['scans'] == [] and manager.groups()['total'] == 0
    assert scan(manager, [one])['hashed'] == 1
    assert manager.groups()['total'] == 0
    assert scan(manager, [two])['hashed'] == 1
    restored = audit.HashAuditor(manager.database)
    group = restored.groups()['groups'][0]
    assert group['file_count'] == group['physical_files'] == 2
    assert group['values']['sha256'] == hashlib.sha256(original).hexdigest()
    assert {row['path'] for row in group['files']} == {str(one/'a.txt'), str(two/'different-name.bin')}
    assert all(Path(row['path']).read_bytes() == original for row in group['files'])


def test_metadata_candidates_can_have_different_hashes_and_exact_timestamps(manager, tmp_path):
    roots = [tmp_path / 'a', tmp_path / 'b']
    for index, root in enumerate(roots):
        root.mkdir(); (root / 'same.txt').write_text('ABCD' if index else 'WXYZ')
        os.utime(root / 'same.txt', ns=(1700000000000000000, 1700000000000000000))
    scan(manager, roots)
    assert manager.groups('hash')['total'] == 0
    for mode in ('name_size', 'size_modified', 'name_size_modified'):
        result = manager.groups(mode)
        assert result['total'] == 1 and result['groups'][0]['file_count'] == 2
        assert len({row['sha256'] for row in result['groups'][0]['files']}) == 2
    os.utime(roots[1] / 'same.txt', ns=(1700000000000000000, 1700000000000000100))
    scan(manager, [roots[1]])
    assert manager.groups('name_size')['total'] == 1
    assert manager.groups('name_size_modified')['total'] == 0


def test_full_hash_distinguishes_files_that_only_differ_after_first_megabyte(manager, tmp_path):
    root = tmp_path / 'files'; root.mkdir()
    prefix = b'A' * (2 * 1024**2)
    (root/'one.bin').write_bytes(prefix + b'1')
    (root/'two.bin').write_bytes(prefix + b'2')
    result = scan(manager, [root])
    assert result['bytes_hashed'] == 2 * (len(prefix) + 1)
    assert manager.groups()['total'] == 0


def test_empty_files_are_hashed_and_external_excluded_paths_stay_untouched(manager, tmp_path):
    root = tmp_path/'root'; root.mkdir()
    for name in ('empty-a', 'empty-b'): (root/name).write_bytes(b'')
    result = scan(manager, [root])
    assert result['hashed'] == 2 and result['bytes_hashed'] == 0
    assert manager.groups()['groups'][0]['values']['sha256'] == hashlib.sha256(b'').hexdigest()
    with pytest.raises(ValueError, match='also excluded'): manager.start([str(root)], [str(root)])
    with pytest.raises(ValueError, match='network shares'): manager.start([r'\\server\share'])


def test_overlapping_roots_and_excludes_do_not_duplicate_paths_or_scan_own_database(manager, tmp_path):
    root = tmp_path / 'files'; nested = root / 'nested'; nested.mkdir(parents=True)
    (nested / 'one').write_text('one')
    excluded = root / 'skip'; excluded.mkdir(); (excluded/'secret').write_text('untouched')
    vendor = root / 'NVIDIA Corporation'; vendor.mkdir(); (vendor/'driver').write_text('untouched')
    result = scan(manager, [nested, root, root], [excluded])
    assert result['roots'] == [str(root)]
    assert result['hashed'] == 1 and result['skipped'] == 2
    assert manager.inventory()['items'][0]['path'] == str(nested/'one')
    result = scan(manager, [manager.database.parent])
    assert result['hashed'] == 0 and result['skipped'] == 1


def test_hard_links_are_identified_without_counting_them_as_independent_copies(manager, tmp_path):
    root = tmp_path / 'files'; root.mkdir()
    source = root/'first'; source.write_bytes(b'Identical')
    os.link(source, root/'hard-link')
    (root/'copy').write_bytes(source.read_bytes())
    scan(manager, [root])
    group = manager.groups()['groups'][0]
    assert group['file_count'] == 3 and group['physical_files'] == 2
    assert sum(row['links'] == 2 for row in group['files']) == 2


def test_links_are_skipped_without_traversing_targets(manager, tmp_path):
    root = tmp_path/'root'; root.mkdir()
    outside = tmp_path/'outside'; outside.mkdir(); (outside/'secret').write_text('outside')
    try: (root/'link').symlink_to(outside, target_is_directory=True)
    except OSError: pytest.skip('This host cannot create directory symlinks')
    result = scan(manager, [root])
    assert result['hashed'] == 0 and result['skipped'] == 1
    assert manager.inventory()['total'] == 0
    with pytest.raises(ValueError, match='real target'):
        manager.start([str(root/'link')])


def test_reparse_and_cloud_attribute_flags_are_excluded():
    from types import SimpleNamespace
    assert audit.linked(SimpleNamespace(st_mode=0, st_file_attributes=0x400))
    for flag in (0x1000, 0x40000, 0x400000):
        assert audit.unavailable_offline(SimpleNamespace(st_file_attributes=flag))


def test_changed_and_unreadable_files_are_recorded_without_a_verified_hash(manager, tmp_path, monkeypatch):
    root = tmp_path/'root'; root.mkdir()
    for name in ('changed', 'unreadable', 'good'): (root/name).write_bytes(b'abc')
    original = audit.hash_file
    def fake(path, before, cancel, progress):
        if path.name == 'changed': raise audit.FileChanged('Changed during read')
        if path.name == 'unreadable': raise PermissionError('Access denied')
        return original(path, before, cancel, progress)
    monkeypatch.setattr(audit, 'hash_file', fake)
    result = scan(manager, [root])
    assert result['status'] == 'completed_with_errors' and result['errors'] == 2
    files = {Path(row['path']).name: row for row in manager.inventory()['items']}
    assert files['changed']['sha256'] is None and files['unreadable']['sha256'] is None
    assert files['good']['sha256'] == hashlib.sha256(b'abc').hexdigest()
    assert manager.issues(result['id'])['total'] == 2
    assert manager.groups()['total'] == 0


def test_real_hash_discards_a_file_mutated_during_read(tmp_path):
    path = tmp_path/'changing'; path.write_bytes(b'x' * (2 * 1024**2))
    def mutate(_):
        with path.open('ab') as file: file.write(b'changed')
    with pytest.raises(audit.FileChanged):
        audit.hash_file(path, path.stat(), threading.Event(), mutate)


def test_completed_rescan_invalidates_unseen_files_but_keeps_other_roots(manager, tmp_path):
    roots = [tmp_path/'a', tmp_path/'b']
    for root in roots: root.mkdir(); (root/'file').write_text('same')
    scan(manager, roots)
    assert manager.groups()['total'] == 1
    (roots[0]/'file').unlink()
    result = scan(manager, [roots[0]])
    assert result['not_seen'] == 1
    assert manager.status()['counts'] == {'not_seen': 1, 'verified': 1}
    assert manager.groups()['total'] == 0
    assert manager.inventory()['total'] == 2


def test_cancel_keeps_finished_files_and_does_not_prune_unseen_paths(manager, tmp_path, monkeypatch):
    root = tmp_path/'root'; root.mkdir(); (root/'old').write_text('old')
    scan(manager, [root]); (root/'old').unlink(); (root/'slow').write_bytes(b'long')
    started, release = threading.Event(), threading.Event()
    def blocked(path, before, cancel, progress):
        started.set(); release.wait(5)
        if cancel.is_set(): raise audit.AuditCancelled()
        return 'a' * 64
    monkeypatch.setattr(audit, 'hash_file', blocked)
    job = manager.start([str(root)])
    assert started.wait(5)
    with pytest.raises(RuntimeError, match='already running'): manager.start([str(root)])
    assert not manager.cancel('wrong-id')['cancelled']
    assert manager.cancel(job['id'])['cancelled']
    release.set(); manager._thread.join(5)
    assert manager.status()['scans'][0]['status'] == 'cancelled'
    assert manager.status()['counts'] == {'interrupted': 1, 'verified': 1}
    assert not manager.cancel(job['id'])['cancelled']


def test_interrupted_scan_recovers_without_restarting_work(manager):
    with manager.connect() as db:
        db.execute("INSERT INTO scans(id,started_at,status,roots,excludes) VALUES ('old','2000','running','[]','[]')")
    restored = audit.HashAuditor(manager.database)
    assert restored.status()['scans'][0]['status'] == 'interrupted'
    assert restored.status()['active'] is None and not restored.busy


def test_group_and_inventory_pagination_and_complete_exports(manager, tmp_path):
    root = tmp_path/'root'; root.mkdir()
    for index in range(125): (root/f'file-{index:03d}').write_text('same')
    scan(manager, [root])
    group = manager.groups()['groups'][0]
    assert len(group['files']) == 30 and group['file_count'] == 125
    more = manager.group_files('hash', group['key'], offset=30)['items']
    assert len(more) == 95 and not ({file['path'] for file in more} & {file['path'] for file in group['files']})
    assert manager.inventory(offset=100)['total'] == 125
    assert len(manager.inventory(offset=100)['items']) == 25
    assert manager.inventory(search='file-00')['total'] == 10
    for scope in ('matches', 'inventory'):
        output = ''.join(manager.export_csv(scope)).lstrip('\ufeff')
        records = list(csv.DictReader(io.StringIO(output)))
        assert len(records) == 125 and all(len(row['sha256']) == 64 for row in records)
    with pytest.raises(ValueError): manager.group_files('hash', 'not a key')


@pytest.mark.parametrize('value', ['=cmd', '+formula', '-formula', '@formula', '\tformula'])
def test_csv_cells_cannot_be_interpreted_as_formulas(value):
    assert audit.csv_cell(value) == "'" + value


def test_api_validates_scope_and_match_modes(manager, tmp_path, monkeypatch):
    monkeypatch.setattr(audit, 'manager', lambda: manager)
    app = FastAPI(); app.include_router(router)
    client = TestClient(app)
    assert client.get('/hash-auditor/status').json()['active'] is None
    assert client.post('/hash-auditor/scans', json={'roots': []}).status_code == 422
    assert client.post('/hash-auditor/scans', json={'roots': ['relative/path']}).status_code == 400
    assert client.post('/hash-auditor/scans', json={'roots': [str(tmp_path/'missing')]}).status_code == 400
    assert client.get('/hash-auditor/groups?mode=sql').status_code == 422
    assert client.get('/hash-auditor/files?limit=100000').status_code == 422
    assert client.get('/hash-auditor/group-files?mode=hash&key=invalid').status_code == 400
    invalid_key = base64.urlsafe_b64encode(json.dumps(['a'*64, 2**80]).encode()).decode()
    assert client.get('/hash-auditor/group-files', params={'mode': 'hash', 'key': invalid_key}).status_code == 400
    assert client.get('/hash-auditor/export?scope=delete').status_code == 422
    root = tmp_path/'root'; root.mkdir(); (root/'file').write_text('ok')
    response = client.post('/hash-auditor/scans', json={'roots': [str(root)]})
    assert response.status_code == 202
    manager._thread.join(5)
    assert client.get('/hash-auditor/files').json()['total'] == 1
    exported = client.get('/hash-auditor/export')
    assert exported.status_code == 200 and 'attachment' in exported.headers['content-disposition']
    rows = list(csv.DictReader(io.StringIO(exported.content.decode('utf-8-sig'))))
    assert len(rows) == 1 and rows[0]['sha256'] == hashlib.sha256(b'ok').hexdigest()


def test_main_routes_require_session_auth_and_maintenance_sees_worker(monkeypatch, manager):
    import main
    from conftest import API_BASE_URL, AUTH_HEADERS
    from services import maintenance_gate
    monkeypatch.setattr(audit, '_instance', manager)
    assert TestClient(main.app, base_url=API_BASE_URL).get('/hash-auditor/status').status_code == 403
    assert TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS).get('/hash-auditor/status').status_code == 200
    monkeypatch.setattr(audit, 'is_busy', lambda: True)
    assert maintenance_gate.workers_busy()
