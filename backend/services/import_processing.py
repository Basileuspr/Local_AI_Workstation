"""Reuse spooled uploads and bound concurrent document decoding, not file size."""
import asyncio
import codecs
from contextlib import contextmanager
from io import BytesIO, StringIO
from pathlib import Path
from weakref import WeakKeyDictionary

import anyio

_limiters = WeakKeyDictionary()


async def process(function, *args):
    loop = asyncio.get_running_loop()
    limiter = _limiters.setdefault(loop, anyio.CapacityLimiter(2))
    # Keep the caller's file alive until the worker exits, including cancellation.
    worker = asyncio.create_task(anyio.to_thread.run_sync(function, *args, limiter=limiter))
    try:
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        while not worker.done():
            try:
                await asyncio.shield(worker)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        # Retrieve any worker failure while preserving the caller's cancellation.
        if not worker.cancelled():
            worker.exception()
        raise


@contextmanager
def source(value):
    if isinstance(value, (bytes, bytearray)):
        with BytesIO(value) as stream:
            yield stream
    elif isinstance(value, (str, Path)):
        with open(value, 'rb') as stream:
            yield stream
    else:
        value.seek(0)
        yield value  # The upload/request scope owns this file.


def text(value):
    for encoding in ('utf-8', 'latin-1'):
        with source(value) as stream, StringIO() as output:
            decoder = codecs.getincrementaldecoder(encoding)()
            try:
                while chunk := stream.read(1024 * 1024):
                    output.write(decoder.decode(chunk))
                output.write(decoder.decode(b'', final=True))
                return output.getvalue()
            except UnicodeDecodeError:
                continue
