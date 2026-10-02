"""Declarative capabilities for local files; no model reads occur on discovery."""
import importlib.util
from pathlib import Path

HANDLERS = [
    {'id': 'document', 'label': 'Document Editor', 'extensions': ['.docx'],
     'mime': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
     'detection': 'ZIP with word/document.xml; bounded XML validation',
     'capabilities': ['view', 'edit', 'read', 'write', 'metadata'], 'runtime': 'lxml'},
    {'id': 'database', 'label': 'Database Reader', 'extensions': ['.db', '.sqlite', '.sqlite3'],
     'mime': ['application/vnd.sqlite3'], 'detection': 'SQLite format 3 header',
     'capabilities': ['view', 'read', 'metadata', 'query', 'export'], 'runtime': 'sqlite3'},
    {'id': 'video', 'label': 'Video Analyzer', 'extensions': ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v'],
     'mime': ['video/mp4', 'video/x-matroska', 'video/quicktime', 'video/webm', 'video/x-msvideo'],
     'detection': 'Restricted local PyAV demuxer and video stream',
     'capabilities': ['view', 'read', 'metadata', 'analyze', 'frames', 'audio', 'transcript', 'vision'], 'runtime': 'av'},
    {'id': 'model', 'label': '3D Viewer', 'extensions': ['.stl', '.3mf'],
     'mime': ['model/stl', 'model/3mf'], 'detection': 'Existing bounded STL/3MF worker',
     'capabilities': ['view', 'read', 'metadata'], 'runtime': None},
]


def registry():
    return [{**item, 'available': item['runtime'] is None or importlib.util.find_spec(item['runtime']) is not None} for item in HANDLERS]


def handler(name):
    found = next((item for item in registry() if Path(name).suffix.lower() in item['extensions']), None)
    if not found: raise ValueError('No local file handler supports this extension.')
    if not found['available']: raise ValueError(found['label'] + ' runtime is unavailable.')
    return found
