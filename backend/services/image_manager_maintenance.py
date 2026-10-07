"""Offline retention of external image references, never image file operations."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3

STAGE = '.image-manager-reset'
CATALOG = Path('image_manager/catalog.sqlite3')
TABLES = {'folders', 'images', 'functions', 'plans', 'receipts', 'trash'}


def external_path(value, root):
    if not isinstance(value, str) or not value:
        return False
    # Normalize the Windows extended local-path spelling for overlap checks.
    value = value[4:] if value.startswith('\\\\?\\') and not value.startswith('\\\\?\\UNC\\') else value
    path = Path(value)
    # Use recorded paths without touching disconnected/external drives. Normal
    # image access still revalidates links, signatures and registered scope.
    if not path.is_absolute() or '..' in path.parts:
        return False
    return not path.is_relative_to(root) and not root.is_relative_to(path)


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def counts(path):
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        return {'folders': db.execute('SELECT COUNT(*) FROM folders').fetchone()[0],
                'images': db.execute('SELECT COUNT(*) FROM images').fetchone()[0]}


def stage_catalog(root, previous, is_link):
    """Prepare a private, compacted catalog before any reset deletion starts."""
    previous = previous or {}
    directory, source = root / STAGE, root / CATALOG
    target = directory / 'catalog.sqlite3'
    expected = previous.get('image_manager_sha256') if previous else None
    if directory.exists() and previous.get('image_manager_preparing'):
        # A crash during snapshot creation precedes every deletion. Discard
        # only this journal-owned stage and rebuild from the original catalog.
        if is_link(directory) or directory.resolve().parent != root or not directory.is_dir() or not source.is_file():
            raise ValueError('Image Manager retention preparation needs recovery.')
        for file in directory.iterdir():
            if is_link(file) or not file.is_file() or file.name not in {'catalog.sqlite3', 'catalog.sqlite3-journal', 'catalog.sqlite3-wal', 'catalog.sqlite3-shm'}:
                raise ValueError('Unexpected Image Manager retention staging; nothing was reset.')
            file.unlink()
        directory.rmdir()
    if directory.exists():
        if is_link(directory) or directory.resolve().parent != root or not directory.is_dir():
            raise ValueError('Image Manager retention staging is unsafe; nothing was reset.')
        if target.exists():
            if not expected or is_link(target) or not target.is_file() or checksum(target) != expected:
                raise ValueError('Retained Image Manager catalog changed; reset remains stopped.')
            if set(directory.iterdir()) != {target}:
                raise ValueError('Unexpected Image Manager retention files; reset remains stopped.')
            return target, expected, counts(target)
        # A previous attempt installed the catalog before removing the stage.
        if not expected or any(directory.iterdir()):
            raise ValueError('Unexpected Image Manager retention staging; nothing was reset.')
        directory.rmdir()
    if expected and (not source.is_file() or checksum(source) != expected):
        raise ValueError('Retained Image Manager catalog is unavailable; reset remains stopped.')
    if not source.exists():
        return None, None, {'folders': 0, 'images': 0}
    if is_link(source) or source.resolve() != source or not source.is_file():
        raise ValueError('Image Manager catalog is unsafe; nothing was reset.')
    directory.mkdir(mode=0o700)
    try:
        with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=10)) as original, closing(sqlite3.connect(target)) as saved:
            original.execute('PRAGMA trusted_schema=OFF')
            schema = original.execute("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").fetchall()
            if (any(kind not in {'table', 'index'} or (kind == 'table' and name not in TABLES) for name, kind in schema)
                    or not {'folders', 'images'}.issubset({name for name, kind in schema if kind == 'table'})):
                raise ValueError('Image Manager catalog schema cannot be retained safely; nothing was reset.')
            if original.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise ValueError('Image Manager catalog needs recovery before reset.')
            original.backup(saved)
            saved.execute('PRAGMA trusted_schema=OFF')
            saved.execute('PRAGMA journal_mode=DELETE')
            # Preserve registered scopes and native metadata for external images.
            folders = {identifier: path for identifier, path in saved.execute('SELECT id,path FROM folders')
                       if external_path(path, root)}
            for identifier, in saved.execute('SELECT id FROM folders').fetchall():
                if identifier not in folders:
                    saved.execute('DELETE FROM folders WHERE id=?', (identifier,))
            invalid = []
            for identifier, folder_id, relative in saved.execute('SELECT id,folder_id,relative FROM images'):
                folder = Path(folders[folder_id]) if folder_id in folders else None
                if (folder is None or not isinstance(relative, str) or Path(relative).is_absolute()
                        or '..' in Path(relative).parts or not external_path(str(folder / relative), root)):
                    invalid.append((identifier,))
            saved.executemany('DELETE FROM images WHERE id=?', invalid)
            tables = {name for name, kind in schema if kind == 'table'}
            if 'trash' in tables:
                for identifier, value in saved.execute('SELECT id,value FROM trash').fetchall():
                    try:
                        entry = json.loads(value)
                        keep = entry['image']['folder_id'] in folders and external_path(entry['original_path'], root) and external_path(entry['trash_path'], root)
                    except (ValueError, TypeError, KeyError):
                        raise ValueError('Image Manager Trash journal needs recovery before reset.') from None
                    if not keep:
                        saved.execute('DELETE FROM trash WHERE id=?', (identifier,))
            # Old transfer plans and recipe/history payloads are reset, so a
            # pre-reset plan can never authorize a later file mutation.
            for table in ('functions', 'plans', 'receipts'):
                if table in tables:
                    saved.execute('DROP TABLE ' + table)
            saved.commit()
            # Remove deleted app-data paths and metadata from SQLite free pages.
            saved.execute('VACUUM')
            if saved.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise ValueError('Retained Image Manager catalog failed verification.')
        return target, checksum(target), counts(target)
    except BaseException:
        # Only files created in this newly-owned stage are removed on failure.
        if directory.resolve().parent != root or is_link(directory):
            raise ValueError('Unsafe Image Manager staging cleanup.') from None
        for file in directory.iterdir():
            if is_link(file) or not file.is_file() or file.name not in {'catalog.sqlite3', 'catalog.sqlite3-journal', 'catalog.sqlite3-wal', 'catalog.sqlite3-shm'}:
                raise ValueError('Unexpected Image Manager staging file; cleanup stopped.') from None
            file.unlink()
        directory.rmdir()
        raise


def rebind_imported_catalog(staging, root, files):
    """Refresh identities only for app-data images verified inside this backup.

    External originals are neither opened nor adopted. A saved hash mismatch
    keeps the existing changed-file refusal until the user explicitly rescans.
    """
    catalog = staging / CATALOG
    if not catalog.is_file():
        return
    from .image_manager_metadata import image_metadata
    from PIL import Image
    entries = {item['path']: item for item in files}
    with closing(sqlite3.connect(catalog)) as db:
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA trusted_schema=OFF')
        tables = {row['name'] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        if not {'folders', 'images'}.issubset(tables):
            return
        if db.execute("SELECT 1 FROM sqlite_schema WHERE type IN ('trigger','view')").fetchone():
            raise ValueError('Imported Image Manager catalog schema needs recovery.')
        rows = db.execute('SELECT i.*,f.path AS folder_path FROM images i JOIN folders f ON f.id=i.folder_id WHERE i.available=1').fetchall()
        for row in rows:
            folder, relative = Path(row['folder_path']), Path(row['relative'])
            if not folder.is_relative_to(root) or relative.is_absolute() or '..' in relative.parts:
                continue
            logical = folder.relative_to(root) / relative
            entry = entries.get('data/' + logical.as_posix())
            if not entry or (row['sha256'] and row['sha256'] != entry['sha256']):
                continue
            path = staging / logical
            if not path.is_file() or not path.resolve().is_relative_to(staging) or checksum(path) != entry['sha256']:
                raise ValueError('Imported Image Manager image failed backup verification.')
            try:
                metadata = image_metadata(path)
            except (OSError, ValueError, Image.DecompressionBombError):
                continue
            # Dates and native manual metadata retain their backed-up meaning.
            # The extraction created a new file identity, not a content edit.
            db.execute('UPDATE images SET signature=?,sha256=?,bytes=?,width=?,height=?,format=? WHERE id=?',
                       (json.dumps(metadata['signature']), entry['sha256'], metadata['bytes'], metadata['width'], metadata['height'], metadata['format'], row['id']))
        db.commit()
