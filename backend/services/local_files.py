"""Ephemeral file sessions. Native dialogs grant paths; HTTP uses opaque IDs."""
import atexit
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
import tempfile
import threading
from uuid import uuid4

from services import file_handlers, local_documents, local_database, local_video


@dataclass
class Session:
    id: str
    path: Path
    handler: str
    temporary: object
    data: dict = field(default_factory=dict)
    document: object = None
    lock: object = field(default_factory=threading.Lock)
    cancel: object = field(default_factory=threading.Event)
    progress: str = ''

    @property
    def directory(self): return Path(self.temporary.name)

    def public(self):
        return {'id': self.id, 'name': self.path.name, 'handler': self.handler, 'data': self.data}


_sessions = {}
_lock = threading.RLock()


def open_file(path):
    path = Path(path).resolve(strict=True)
    spec = file_handlers.handler(path.name)
    if not path.is_file() or path.stat().st_size > (512 * 1024**2 if spec['id'] == 'model' else 8 * 1024**3):
        raise ValueError('Choose a regular file within the handler size limit (3D: 512 MiB; other files: 8 GiB).')
    with _lock:
        if len(_sessions) >= 4: raise ValueError('Close an existing local file before opening another.')
        item = Session(uuid4().hex, path, spec['id'], tempfile.TemporaryDirectory(prefix='law-local-file-'))
        _sessions[item.id] = item
    try:
        with item.lock:
            if item.handler == 'document':
                item.document = local_documents.Document(path); item.data = item.document.model()
            elif item.handler == 'database':
                database = local_database.snapshot(path, item.directory)
                item.data = {'schema': local_database.schema(database), 'snapshot': True}
            elif item.handler == 'video':
                item.data = {'metadata': local_video.metadata(path), 'frames': [], 'transcript': None}
                try:
                    item.data.update(local_video.sample(path, item.directory, item.data['metadata'], thumbnail=True))
                except ValueError as exc:
                    item.data['thumbnail_warning'] = str(exc)
        return item.public()
    except BaseException:
        close(item.id); raise


def get(identifier):
    with _lock:
        if identifier not in _sessions: raise ValueError('This file session has closed. Reopen the file.')
        return _sessions[identifier]


@contextmanager
def operation(identifier, handler=None):
    with _lock:
        item = get(identifier)
        if handler and item.handler != handler: raise ValueError('This operation is not supported for this file.')
        if not item.lock.acquire(blocking=False): raise ValueError('This file is busy. Wait for the current operation to stop.')
    try:
        item.cancel.clear(); yield item
    finally:
        item.progress = ''; item.lock.release()


def close(identifier):
    with _lock:
        item = get(identifier)
        if item.lock.locked():
            item.cancel.set(); raise ValueError('Stopping the current operation. Wait for it to finish, then close the file.')
        item.temporary.cleanup(); del _sessions[identifier]


def cleanup():
    for item in list(_sessions.values()):
        item.cancel.set()
        if not item.lock.locked(): item.temporary.cleanup()


atexit.register(cleanup)
