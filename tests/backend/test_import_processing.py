import asyncio
import io
import threading
from tempfile import SpooledTemporaryFile
import pytest

from services import import_processing
from services.file_parser import parse_file


def test_text_upload_is_read_in_chunks_and_keeps_latin1_fallback():
    class BoundedReader(io.BytesIO):
        def read(self, size=-1):
            assert 0 < size <= 1024 * 1024
            return super().read(size)
    text = 'a' * (1024 * 1024 + 3) + ' café'
    with BoundedReader(text.encode('latin-1')) as upload:
        parsed = parse_file(upload, 'notes.txt')
        assert parsed['error'] is None
        assert parsed['text'] == text
        assert not upload.closed


@pytest.mark.parametrize('fails', [False, True])
def test_import_cancellation_keeps_file_and_capacity_until_worker_exits(fails):
    async def scenario():
        entered = threading.Event()
        release = threading.Event()
        def work(file):
            entered.set()
            assert release.wait(3)
            if fails:
                raise ValueError('Late decode failure')
            return file.read()
        with SpooledTemporaryFile() as upload:
            upload.write(b'preserved'); upload.seek(0)
            task = asyncio.create_task(import_processing.process(work, upload))
            try:
                while not entered.is_set():
                    await asyncio.sleep(.01)
                task.cancel()
                await asyncio.sleep(.02)
                assert not task.done()
                assert not upload.closed
            finally:
                release.set()
            try:
                await task
            except asyncio.CancelledError:
                pass
            else:
                raise AssertionError('Caller cancellation must propagate after worker cleanup')
    asyncio.run(scenario())


def test_imports_limit_parallel_workers_without_blocking_event_loop():
    async def scenario():
        active = maximum = 0
        lock, release = threading.Lock(), threading.Event()
        def work():
            nonlocal active, maximum
            with lock:
                active += 1; maximum = max(maximum, active)
            assert release.wait(3)
            with lock:
                active -= 1
        tasks = [asyncio.create_task(import_processing.process(work)) for _ in range(5)]
        try:
            for _ in range(100):
                if active == 2:
                    break
                await asyncio.sleep(.01)
            await asyncio.sleep(.03)
            assert active == 2
        finally:
            release.set()
            await asyncio.gather(*tasks)
        assert maximum == 2
    asyncio.run(scenario())


def test_spooled_docx_supports_chat_and_editor_without_closing_upload():
    from docx import Document
    from services.document_editor import import_docx
    document = Document(); document.add_paragraph('Preserved document text')
    with SpooledTemporaryFile(max_size=1) as upload:
        document.save(upload)
        assert upload._rolled
        parsed = parse_file(upload, 'notes.docx')
        assert parsed['error'] is None and 'Preserved document text' in parsed['text']
        imported = import_docx(upload)
        assert imported['document']['content'][0]['content'][0]['text'] == 'Preserved document text'
        assert not upload.closed


def test_document_request_spools_large_bodies_and_closes_on_error():
    from routes.document_editor import document_body
    class Request:
        async def stream(self):
            for _ in range(3):
                yield b'x' * (512 * 1024)
    async def scenario():
        saved = None
        try:
            async with document_body(Request()) as body:
                saved = body
                assert body._rolled
                assert len(body.read()) == 3 * 512 * 1024
                raise ValueError('decode failure')
        except ValueError:
            pass
        assert saved.closed
    asyncio.run(scenario())
