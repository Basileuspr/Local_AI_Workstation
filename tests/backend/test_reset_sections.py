import json
from pathlib import Path
import sqlite3

import pytest
import maintenance
from services.reset_scope import SECTIONS
from services.bridge_store import BridgeStore
from mobile_companion.connection_setup import MobileListen, read_setup


def options(*sections, keep=False):
    return {'sections': list(sections), 'keep_mobile_setup': keep}


@pytest.fixture
def data(tmp_path):
    root = tmp_path / 'app-data'
    for name in ('sessions', 'knowledge_base', 'generated_images', 'backups', 'storage', 'unknown-future-data'):
        (root / name).mkdir(parents=True)
        (root / name / 'private.txt').write_text('private content')
    for name in ('memory.db', 'memory.db-wal', 'memory.db-shm', 'memory.db-journal'):
        (root / name).write_bytes(b'memory')
    mobile = BridgeStore(root / 'mobile')
    mobile.set_setting('listen', MobileListen(origin='https://desktop.example.ts.net').model_dump())
    mobile.set_setting('secret', 'private credential')
    mobile.save_peer({'id': 'phone', 'name': 'private phone'})
    mobile.insert('incoming', 'receipt', 'phone', {'prompt': 'private prompt'})
    return root


def reset(root, selected):
    return maintenance.reset_data(root=root, confirmation='RESET', options=selected)


def test_selected_memory_clears_sidecars_and_preserves_other_sections(data):
    before = {p.relative_to(data): p.read_bytes() for p in data.rglob('*') if p.is_file()}
    reset(data, options('memory'))
    for name, content in before.items():
        if str(name).startswith('memory.db'):
            assert not (data / name).exists()
        else:
            assert (data / name).read_bytes() == content


def test_full_reset_with_reconnect_keeps_only_setup_not_access_or_jobs(data):
    setup = read_setup(data)
    reset(data, options(*SECTIONS, keep=True))
    assert read_setup(data) == setup
    assert set(p.relative_to(data).as_posix() for p in data.rglob('*') if p.is_file()) == {'mobile/bridge.sqlite3'}
    mobile = BridgeStore(data / 'mobile')
    assert mobile.peers() == [] and mobile.jobs() == []
    assert mobile.setting('secret') is None
    assert mobile.setting('listen') == setup


def test_full_reset_without_retention_removes_setup_unknown_data_and_keeps_external_files(data):
    external = data.parent / 'external-original.jpg'
    external.write_bytes(b'original')
    reset(data, options(*SECTIONS))
    assert list(data.iterdir()) == []
    assert external.read_bytes() == b'original'


def test_phone_only_reset_preserves_chats_and_can_retain_setup(data):
    reset(data, options('mobile', keep=True))
    assert (data / 'sessions/private.txt').read_text() == 'private content'
    assert read_setup(data)['origin'] == 'https://desktop.example.ts.net'
    assert BridgeStore(data / 'mobile').peers() == []


@pytest.mark.parametrize('selected', [options(), options('../sessions'), options('chats', 'chats'),
    {'sections': 'chats', 'keep_mobile_setup': False}, options('chats', keep=True),
    {'sections': ['chats'], 'keep_mobile_setup': 'false'}, {'sections': ['chats'], 'keep_mobile_setup': False, 'path': '/'}])
def test_invalid_scope_fails_without_deletion(data, selected):
    with pytest.raises(ValueError):
        reset(data, selected)
    assert (data / 'sessions/private.txt').exists()
    assert not (data / maintenance.MARKER).exists()


def test_interrupted_scoped_reset_locks_choices_and_retains_setup_for_retry(data, monkeypatch):
    original = maintenance.shutil.rmtree
    def fail(path):
        original(path)
        if path.name == 'mobile':
            raise OSError('simulated interruption after removing phone data')
    monkeypatch.setattr(maintenance.shutil, 'rmtree', fail)
    selected = options('mobile', keep=True)
    with pytest.raises(RuntimeError, match='incomplete'):
        reset(data, selected)
    report = maintenance.inventory(data)
    assert report['reset_pending'] and report['reset_options'] == selected
    assert 'example.ts.net' not in json.dumps(report)
    with pytest.raises(ValueError, match='original section'):
        reset(data, options('chats'))
    monkeypatch.setattr(maintenance.shutil, 'rmtree', original)
    reset(data, selected)
    assert read_setup(data)['origin'] == 'https://desktop.example.ts.net'
    assert (data / 'sessions/private.txt').exists()
    assert not (data / maintenance.MARKER).exists()


def test_invalid_retained_setup_and_links_fail_before_deleting(data, monkeypatch):
    selected = options('mobile', keep=True)
    maintenance.write_atomic(data / maintenance.MARKER, {'version': 4, 'sanitize': True, 'reset_options': selected, 'mobile_setup': {'origin': 'http://invalid'}})
    with pytest.raises(ValueError, match='retained phone setup'):
        reset(data, selected)
    assert (data / 'mobile/bridge.sqlite3').exists()
    (data / maintenance.MARKER).unlink()
    original = maintenance.is_link
    monkeypatch.setattr(maintenance, 'is_link', lambda p: p == data / 'mobile' or original(p))
    with pytest.raises(ValueError, match='linked'):
        reset(data, selected)
    assert (data / 'sessions/private.txt').exists()


def test_corrupt_phone_setup_can_be_forgotten_without_reading_it(data):
    (data / 'mobile/bridge.sqlite3').write_bytes(b'broken')
    with pytest.raises(ValueError, match='could not be read'):
        reset(data, options('mobile', keep=True))
    reset(data, options('mobile'))
    assert not (data / 'mobile').exists()


def test_inventory_and_desktop_only_reset_have_no_content_and_preserve_backend_files(data):
    report = maintenance.inventory(data)
    groups = {group['id']: group for group in report['reset_sections']}
    assert set(groups) == set(SECTIONS)
    assert groups['memory']['files'] == 4 and groups['other']['files'] == 1
    assert 'private.txt' not in json.dumps(report) and 'example.ts.net' not in json.dumps(report)
    before = {p.relative_to(data): p.read_bytes() for p in data.rglob('*') if p.is_file()}
    reset(data, options('desktop'))
    assert before == {p.relative_to(data): p.read_bytes() for p in data.rglob('*') if p.is_file()}


def test_worker_supports_scoped_reset_and_recovery(data):
    import os
    import subprocess
    import sys
    env = {**os.environ, 'LAW_DATA_DIR': str(data), 'PYTHONUTF8': '1'}
    selected = options('mobile', keep=True)
    result = subprocess.run([sys.executable, str(Path(maintenance.__file__))],
        input=json.dumps({'action': 'reset', 'confirmation': 'RESET', 'options': selected}), text=True, capture_output=True, env=env, timeout=30)
    assert result.returncode == 0, result.stdout
    assert maintenance.inventory(data)['reset_options'] == selected
    assert read_setup(data)['origin'] == 'https://desktop.example.ts.net'
