"""App-owned media libraries. Metadata stays local; existing files never move.

Allocations bind an object to a library before its first write. Changing the
default affects new objects only, and a missing drive never triggers fallback.
"""
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import threading
from uuid import uuid4

from config import settings

MARKER = '.law-library.json'
FORMAT = 'local-ai-workstation-library-v1'
DATABASE = Path('storage') / 'libraries.sqlite3'
PRIMARY = 'primary'
_lock = threading.RLock()


class StorageUnavailable(ValueError):
    pass


def no_links(path):
    path = Path(path).absolute()
    if '..' in path.parts: raise StorageUnavailable('Storage path escapes its owned folder.')
    for item in [path, *path.parents]:
        if item.is_symlink() or item.is_junction():
            raise StorageUnavailable('Storage paths cannot contain links or junctions.')
    return path


def owned_unit(relative):
    """Only media files and self-contained media projects may leave app data."""
    parts = relative.parts
    if not parts or any(part in ('..', '.') for part in parts): return None
    first = parts[0]
    if first in ('blobs', 'generated_images') and len(parts) == 2:
        return relative.as_posix()
    if first in ('face_datasets', 'image_workflows') and len(parts) >= 2:
        return '/'.join(parts[:2])
    if first == 'artifacts' and len(parts) >= 2:
        if parts[1] == 'conversions' and len(parts) >= 3:
            return '/'.join(parts[:2]) + '/' + Path(parts[2]).stem
        if re.fullmatch('[a-f0-9]{32}', parts[1]): return '/'.join(parts[:2])
    if len(parts) >= 3:
        if parts[:2] == ('image_library', 'images'): return '/'.join(parts[:3])
        if parts[:2] == ('face_bank', 'assets'):
            return '/'.join(parts[:2]) + '/' + Path(parts[2]).stem
        if parts[:2] in (('character_datasets', 'datasets'), ('character_datasets', 'sources')):
            return '/'.join(parts[:3])
    return None


class Libraries:
    def __init__(self, data_root):
        self.root = Path(data_root).absolute()
        self.database = self.root / DATABASE

    @contextmanager
    def connect(self):
        no_links(self.database)
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.database, timeout=15)) as db, db:
            db.row_factory = sqlite3.Row
            db.executescript('''
                CREATE TABLE IF NOT EXISTS libraries(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS allocations(unit TEXT PRIMARY KEY, library_id TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS allocations_library ON allocations(library_id);
            ''')
            yield db

    def records(self):
        if not self.database.exists(): return [], PRIMARY
        with self.connect() as db:
            rows = [dict(row) for row in db.execute('SELECT * FROM libraries ORDER BY created_at,id')]
            selected = db.execute("SELECT value FROM preferences WHERE key='default'").fetchone()
        return rows, selected[0] if selected else PRIMARY

    def library_root(self, record):
        try:
            root = no_links(record['path'])
            marker = no_links(root / MARKER)
            value = json.loads(marker.read_text(encoding='utf-8'))
            if not isinstance(value, dict) or value.get('format') != FORMAT or value.get('id') != record['id']:
                raise ValueError('Library identity does not match')
            if not root.is_dir(): raise ValueError('Library folder is missing')
            no_links(root / 'files')
            return root
        except (OSError, ValueError) as exc:
            raise StorageUnavailable(f"Library '{record['label']}' is unavailable or its identity changed. Reconnect the original drive and refresh Storage libraries.") from exc

    def status(self):
        records, selected = self.records()
        result = []
        for record in [{'id': PRIMARY, 'label': 'Original app storage', 'path': str(self.root)}, *records]:
            item = {**record, 'default': record['id'] == selected, 'available': False}
            try:
                root = self.root if record['id'] == PRIMARY else self.library_root(record)
                probe = root
                while not probe.exists(): probe = probe.parent
                usage = shutil.disk_usage(probe)
                item.update(available=True, free_bytes=usage.free, total_bytes=usage.total)
            except (OSError, ValueError) as exc: item['error'] = str(exc)
            result.append(item)
        return {'libraries': result, 'default_id': selected}

    def add(self, parent, name='Local AI Workstation Library', label=''):
        if not isinstance(name, str) or not name.strip() or len(name) > 80 or re.search(r'[\\/<>:"|?*\x00-\x1f]', name) or name.endswith((' ', '.')) or name in ('.', '..') or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name, re.I):
            raise ValueError('Use a simple folder name without slashes or reserved characters.')
        parent = Path(parent)
        if not parent.is_absolute() or str(parent).startswith(('\\\\', '//')):
            raise ValueError('Choose an absolute local folder or drive root.')
        parent = no_links(parent)
        if os.name == 'nt':
            import ctypes
            if ctypes.windll.kernel32.GetDriveTypeW(str(parent.anchor)) == 4:
                raise ValueError('Choose a local disk rather than a mapped network drive.')
        if not parent.is_dir(): raise ValueError('The selected parent folder or drive is unavailable.')
        target = no_links(parent / name)
        for protected in (self.root, settings.models_dir.absolute(), Path(__file__).resolve().parents[2]):
            if target == protected or target.is_relative_to(protected) or protected.is_relative_to(target):
                raise ValueError('Choose a library outside app data, installed models, and application source.')
        with _lock:
            records, _ = self.records()
            if len(records) >= 32: raise ValueError('Up to 32 storage libraries can be registered.')
            if any(target == Path(row['path']) or target.is_relative_to(Path(row['path'])) or Path(row['path']).is_relative_to(target) for row in records):
                raise ValueError('This location overlaps an existing library.')
            if target.exists():
                # Reattach is explicit. Never claim an unrelated populated folder.
                try:
                    marker = json.loads(no_links(target / MARKER).read_text(encoding='utf-8'))
                    if not isinstance(marker, dict) or marker.get('format') != FORMAT or not isinstance(marker.get('id'), str) or not re.fullmatch('[a-f0-9]{32}', marker['id']): raise ValueError()
                except (OSError, ValueError):
                    raise ValueError('That folder already exists and is not an app library. Choose a new folder name.') from None
                identifier = marker['id']
                if any(row['id'] == identifier for row in records): raise ValueError('This library is already registered at another path.')
            else:
                identifier = uuid4().hex
                target.mkdir()  # Exclusive creation; no merging with another writer.
                with (target / MARKER).open('x', encoding='utf-8') as output:
                    json.dump({'format': FORMAT, 'id': identifier}, output)
                (target / 'files').mkdir()
            record = {'id': identifier, 'path': str(target), 'label': (label.strip() or name)[:120], 'created_at': datetime.now(timezone.utc).isoformat()}
            self.library_root(record)
            # Test a new file only; never touch source or existing library content.
            probe = target / f'.write-check-{uuid4().hex}'
            try:
                with probe.open('xb') as output: output.write(b'')
            finally: probe.unlink(missing_ok=True)
            with self.connect() as db:
                db.execute('INSERT INTO libraries(id,path,label,created_at) VALUES (:id,:path,:label,:created_at)', record)
            return record

    def set_default(self, identifier):
        with _lock:
            records, _ = self.records()
            if identifier != PRIMARY:
                record = next((row for row in records if row['id'] == identifier), None)
                if not record: raise ValueError('Unknown storage library.')
                root = self.library_root(record)
                if shutil.disk_usage(root).free < 1024 * 1024: raise ValueError('This drive has less than 1 MiB free.')
            with self.connect() as db:
                db.execute("INSERT INTO preferences VALUES ('default',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (identifier,))
        return self.status()

    def relative(self, path):
        try: return Path(path).absolute().relative_to(self.root)
        except ValueError: return None

    def path(self, path, *, create=False):
        original = Path(path)
        relative = self.relative(path)
        unit = owned_unit(relative) if relative is not None else None
        if unit is None or not self.database.exists(): return original
        with _lock:
            records, selected = self.records()
            # Restored backup payloads and pre-library objects keep their location.
            legacy = self.root / unit
            if original.exists() or legacy.exists(): return no_links(original)
            with self.connect() as db:
                found = db.execute('SELECT library_id FROM allocations WHERE unit=?', (unit,)).fetchone()
            identifier = found[0] if found else None
            if identifier == PRIMARY: return no_links(original)
            if identifier:
                record = next((row for row in records if row['id'] == identifier), None)
                if record is None: raise StorageUnavailable('The storage library for this file is no longer registered.')
                destination = no_links(self.library_root(record) / 'files' / relative)
            else:
                destination = None
                # An explicitly reattached library may predate this catalog.
                for record in records:
                    try: root = self.library_root(record) / 'files'
                    except StorageUnavailable: continue
                    if (root / relative).exists() or (root / unit).exists():
                        destination, identifier = no_links(root / relative), record['id']; break
                if destination is None:
                    if not create: return no_links(original)
                    identifier = selected
                    if identifier == PRIMARY: destination = no_links(original)
                    else:
                        record = next((row for row in records if row['id'] == identifier), None)
                        if record is None: raise StorageUnavailable('Choose an available default storage library.')
                        destination = no_links(self.library_root(record) / 'files' / relative)
                # Bind before writing, even if the caller later fails. No future
                # retry may quietly switch drives for this object.
                with self.connect() as db:
                    db.execute('INSERT OR IGNORE INTO allocations VALUES (?,?)', (unit, identifier))
            if create:
                destination.parent.mkdir(parents=True, exist_ok=True)
            return destination

    def roots(self, logical_root, *, strict=False):
        result = [Path(logical_root)]
        relative = self.relative(logical_root)
        if relative is None: return result
        for record in self.records()[0]:
            try: result.append(no_links(self.library_root(record) / 'files' / relative))
            except StorageUnavailable:
                if strict: raise
        return result

    def export_folder(self, category='exports'):
        if category not in ('exports', 'images', 'gifs', 'audio', 'documents', 'packages'):
            raise ValueError('Unknown export category.')
        records, selected = self.records()
        if selected == PRIMARY: root = self.root
        else:
            record = next((row for row in records if row['id'] == selected), None)
            if not record: raise StorageUnavailable('Choose an available default library.')
            root = self.library_root(record)
        destination = no_links(root / 'exports' / category)
        destination.mkdir(parents=True, exist_ok=True)
        return str(destination)


def manager():
    return Libraries(settings.data_dir)


def resolve(path, *, create=False):
    return manager().path(path, create=create)


def glob_paths(root, pattern, *, strict=False):
    seen = set()
    for directory in manager().roots(root, strict=strict):
        for path in directory.glob(pattern):
            key = path.relative_to(directory).as_posix()
            if key not in seen:
                no_links(path)
                seen.add(key)
                yield path


def confined(path, logical_root):
    path = no_links(path)
    if any(path.is_relative_to(root.absolute()) for root in manager().roots(logical_root)):
        return path
    raise ValueError('File path escapes its owned storage.')
