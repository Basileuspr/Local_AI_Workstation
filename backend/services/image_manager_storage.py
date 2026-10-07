"""Independent catalog storage and lossless, automatic legacy migration."""
from contextlib import closing
from pathlib import Path
import sqlite3
import uuid


def no_links(path):
    """Validate each existing component without following redirected paths."""
    path = Path(path).absolute()
    for part in [path, *path.parents]:
        if part.is_symlink() or part.is_junction():
            raise ValueError('Directory links, symbolic links and junctions are excluded.')
    if any('nvidia' in part.casefold() for part in path.parts):
        raise ValueError('NVIDIA paths are excluded.')
    return path


def storage_directory(root):
    from config import settings
    root = Path(root).absolute()
    directory = settings.image_manager_dir if root == settings.data_dir.absolute() else root.parent / (root.name + '-image-manager')
    return checked_directory(root, directory)


def checked_directory(root, directory):
    root, directory = Path(root).absolute(), Path(directory).absolute()
    if directory.is_relative_to(root) or root.is_relative_to(directory):
        raise ValueError('Image Manager storage must be separate from app data.')
    no_links(directory)
    if directory.resolve() != directory or (directory.exists() and not directory.is_dir()):
        raise ValueError('Image Manager storage needs a regular, unredirected folder.')
    return directory


def ensure_catalog(root, directory=None):
    """Preserve the current catalog before app data can be reset or replaced.

    Existing independent catalogs always win over legacy or imported copies.
    SQLite backup includes committed WAL data; installation is atomic and the
    legacy copy remains available for recovery. No source image is opened.
    """
    root = Path(root).absolute()
    directory = checked_directory(root, directory) if directory is not None else storage_directory(root)
    from .process_lock import acquire
    with acquire(directory):
        target = no_links(directory / 'catalog.sqlite3')
        if target.exists():
            if not target.is_file():
                raise ValueError('Image Manager catalog needs a regular file.')
            with closing(sqlite3.connect(target.as_uri() + '?mode=ro', uri=True, timeout=30)) as current:
                current.execute('PRAGMA trusted_schema=OFF')
                if current.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                    raise ValueError('Image Manager catalog needs recovery before maintenance.')
            return directory
        # A direct-backend launch (including an older desktop process) uses
        # this sibling store. Prefer it to the stale app-data recovery copy
        # when the desktop starts using its user-data location.
        sibling = no_links(root.parent / (root.name + '-image-manager') / 'catalog.sqlite3')
        source = sibling if sibling.parent != directory and sibling.exists() else no_links(root / 'image_manager/catalog.sqlite3')
        if not source.exists():
            return directory
        if not source.is_file():
            raise ValueError('Legacy Image Manager catalog needs recovery.')
        temporary = directory / ('catalog-migration-' + uuid.uuid4().hex + '.sqlite3')
        try:
            with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=30)) as original, closing(sqlite3.connect(temporary)) as saved:
                original.execute('PRAGMA trusted_schema=OFF')
                schema = original.execute("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").fetchall()
                allowed = {'folders', 'images', 'functions', 'plans', 'receipts', 'trash'}
                if (any(kind not in {'table', 'index'} or (kind == 'table' and name not in allowed) for name, kind in schema)
                        or not {'folders', 'images'}.issubset({name for name, kind in schema if kind == 'table'})):
                    raise ValueError('Legacy Image Manager catalog schema needs recovery before migration.')
                if original.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                    raise ValueError('Legacy Image Manager catalog needs recovery before migration.')
                original.backup(saved)
                saved.execute('PRAGMA trusted_schema=OFF')
                saved.execute('PRAGMA journal_mode=DELETE')
                if saved.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                    raise ValueError('Image Manager catalog migration failed verification.')
            if target.exists():
                raise ValueError('Image Manager catalog changed during migration; nothing was overwritten.')
            temporary.rename(target)
        finally:
            for suffix in ('', '-journal', '-wal', '-shm'):
                candidate = no_links(Path(str(temporary) + suffix))
                if candidate.exists():
                    if not candidate.is_file():
                        raise ValueError('Image Manager migration cleanup needs recovery.')
                    candidate.unlink()
    return directory
