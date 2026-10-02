"""Bounded SQLite inspection of a private snapshot, never the source database."""
from contextlib import closing
from pathlib import Path
import math
import re
import shutil
import sqlite3
import time

HEADER = b'SQLite format 3\x00'


def snapshot(source, directory):
    source = Path(source)
    with source.open('rb') as handle:
        if handle.read(16) != HEADER:
            raise ValueError('Database format not recognized. This reader currently supports SQLite only; other .db formats are not necessarily corrupt.')
    files = [source, Path(str(source) + '-wal'), Path(str(source) + '-journal')]
    def stamps():
        return [(p.stat().st_size, p.stat().st_mtime_ns) if p.exists() else None for p in files]
    before = stamps()
    if sum(item[0] for item in before if item) > 8 * 1024**3:
        raise ValueError('The read-only snapshot supports databases up to 8 GiB.')
    if before[2] and before[2][0]:
        raise ValueError('This database has an active recovery journal. Close its owning application cleanly before inspecting it.')
    target = Path(directory) / 'snapshot.db'
    for index in (0, 1):
        if before[index]:
            with files[index].open('rb') as incoming, Path(str(target) + ('-wal' if index else '')).open('wb') as outgoing:
                shutil.copyfileobj(incoming, outgoing, 1024**2)
    if stamps() != before:
        raise ValueError('The database changed while copying. Close its owning application and reopen it for a consistent snapshot.')
    return target


def connect(path):
    db = sqlite3.connect(Path(path).as_uri() + '?mode=ro', uri=True, timeout=1)
    db.execute('PRAGMA query_only=ON')
    db.execute('PRAGMA trusted_schema=OFF')
    db.enable_load_extension(False)
    db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1024**2)
    db.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 32000)
    db.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 256)
    return db


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def schema(path):
    with closing(connect(path)) as db:
        started = time.monotonic()
        db.set_progress_handler(lambda: time.monotonic() - started > 5, 1000)
        names = db.execute("SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 1001").fetchall()
        if len(names) > 1000: raise ValueError('Database has more than 1,000 tables/views.')
        return [{'name': name, 'type': kind, 'sql': sql,
                 'columns': [{'name': r[1], 'type': r[2], 'primary_key': r[5], 'not_null': bool(r[3])}
                             for r in db.execute('PRAGMA table_info(' + quote(name) + ')')]} for name, kind, sql in names]


def authorizer(action, first, second, database, trigger):
    if action == sqlite3.SQLITE_FUNCTION:
        return sqlite3.SQLITE_DENY if (second or '').lower() in {'load_extension', 'readfile', 'writefile', 'edit', 'fts3_tokenizer'} else sqlite3.SQLITE_OK
    return sqlite3.SQLITE_OK if action in {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_RECURSIVE} else sqlite3.SQLITE_DENY


def query(path, name, *, table=None, sql='', search='', offset=0, limit=100, count=False, cancel=None):
    if not 0 <= offset <= 10000000 or not 1 <= limit <= 200:
        raise ValueError('Choose a page of 1–200 rows within the first 10 million records.')
    if len(search) > 1000: raise ValueError('Search text is too long.')
    params = []
    if table:
        info = next((item for item in schema(path) if item['name'] == table), None)
        if not info: raise ValueError('Choose an existing table or view.')
        sql = 'SELECT * FROM ' + quote(table)
        if search:
            sql += ' WHERE ' + ' OR '.join('CAST(' + quote(c['name']) + ' AS TEXT) LIKE ? ESCAPE \'\\\'' for c in info['columns'])
            needle = '%' + search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
            params = [needle] * len(info['columns'])
    sql = sql.strip().removesuffix(';').strip()
    if len(sql) > 32000 or not re.match(r'^(SELECT|WITH)\b', sql, re.I):
        raise ValueError('Only a single read-only SELECT or WITH…SELECT query is allowed.')
    started = time.monotonic()
    budget = 0
    def interrupted():
        nonlocal budget
        budget += 1000
        return budget > 20000000 or time.monotonic() - started > 5 or bool(cancel and cancel.is_set())
    try:
        with closing(connect(path)) as db:
            db.set_authorizer(authorizer)
            db.set_progress_handler(interrupted, 1000)
            if count:
                total = db.execute('SELECT count(*) FROM (' + sql + ')', params).fetchone()[0]
                return {'database': name, 'table': table, 'columns': [], 'row_count': total, 'rows': []}
            cursor = db.execute('SELECT * FROM (' + sql + ') LIMIT ? OFFSET ?', [*params, limit + 1, offset])
            names = [column[0] for column in cursor.description]
            rows = []; size = 0
            for row in cursor:
                values = [('[BLOB: %d bytes]' % len(v)) if isinstance(v, bytes) else None if isinstance(v, float) and not math.isfinite(v) else v for v in row]
                size += sum(len(str(v)) for v in values)
                if size > 2 * 1024**2: raise ValueError('This result page exceeds 2 MiB. Select fewer columns or rows.')
                rows.append(values)
            return {'database': name, 'table': table, 'columns': names, 'row_count': None,
                    'rows': rows[:limit], 'offset': offset, 'has_more': len(rows) > limit,
                    'note': 'Read-only snapshot. BLOB values are represented by their size. Counts are calculated only when requested.'}
    except sqlite3.Error as exc:
        raise ValueError('SQLite could not complete this read-only query (invalid/blocked SQL, locked or damaged database, or the 5-second work limit): ' + str(exc)) from exc
