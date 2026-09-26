"""In-app filesystem navigation; no GUI runtime or host-app bridge required."""
import os
from pathlib import Path
import re


def media_root(reports):
    return Path(reports) / 'managed-media'


def folder_name(value):
    name = str(value or '').strip()
    if (not name or len(name) > 100 or name in ('.', '..') or name.endswith(('.', ' '))
            or re.search(r'[<>:"/\\|?*\x00-\x1f]', name)
            or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', name, re.I)):
        raise ValueError('Enter a folder name up to 100 characters, without path separators or reserved Windows characters.')
    return name


def create(parent, name):
    parent = Path(str(parent or '')).expanduser()
    if not parent.is_absolute() or not parent.is_dir(): raise ValueError('Choose an existing parent folder.')
    target = parent.resolve() / folder_name(name)
    try: target.mkdir()
    except FileExistsError: raise ValueError('That folder already exists. Use a different name or choose the existing folder.')
    return target


def browse(reports, value=''):
    home = Path.home()
    candidates = [('Media Manager', media_root(reports)), ('Home', home)]
    candidates += [(name, home/name) for name in ('Desktop', 'Documents', 'Pictures', 'Videos', 'Downloads')]
    candidates += [(drive, Path(drive)) for drive in (os.listdrives() if hasattr(os, 'listdrives') else [home.anchor])]
    roots = [dict(name=name, path=str(path)) for name,path in candidates if path.is_dir()]
    path = Path(value).expanduser() if value else home
    if not path.is_absolute() or not path.is_dir(): raise ValueError('This location is unavailable. Choose a folder or connected drive.')
    path = path.resolve()
    children, skipped = [], 0
    with os.scandir(path) as entries:
        for entry in entries:
            try:
                if entry.is_dir(): children.append(dict(name=entry.name, path=entry.path))
            except OSError: skipped += 1
    children.sort(key=lambda item: item['name'].casefold())
    return dict(path=str(path), parent=str(path.parent) if path.parent != path else None,
                roots=roots, children=children, skipped=skipped)
