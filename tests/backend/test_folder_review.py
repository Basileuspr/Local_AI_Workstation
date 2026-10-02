import asyncio
from pathlib import Path
import json
import threading
import time

import httpx
from PIL import Image
from PyPDF2 import PdfWriter
from PyPDF2.generic import DictionaryObject, NameObject, DecodedStreamObject
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import folder_review as service
from services import folder_review_reader as reader
from services.request_queue import RequestQueue
from services.session_guard import SessionGuard
from routes.folder_review import router

OPTIONS = {'recursive': True, 'max_entries': 2000, 'max_bytes': 16 * 1024 * 1024, 'max_chars': 200000, 'batch_chars': 500}


def pdf(path, text_pages):
    writer = PdfWriter()
    for text in text_pages:
        writer.add_blank_page(width=300, height=300)
        page = writer.pages[-1]
        if text:
            font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
            page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
            stream = DecodedStreamObject()
            stream.set_data(b'BT /F1 12 Tf 20 200 Td (' + text.encode('ascii') + b') Tj ET')
            page[NameObject('/Contents')] = writer._add_object(stream)
    with path.open('wb') as handle:
        writer.write(handle)


def test_native_pdf_pages_only_with_explicit_scanned_page_gaps(tmp_path, monkeypatch):
    from services import file_parser
    monkeypatch.setattr(file_parser, '_ocr_pdf_pages', lambda *args: pytest.fail('OCR was requested'))
    file = tmp_path / 'mixed.pdf'; pdf(file, ['Readable project requirements', '', 'Additional implementation notes'])
    result = reader.extract(file.read_bytes(), file.name, 200000)
    assert result['status'] == 'readable'
    assert 'Readable project requirements' in result['text'] and '--- Page 3 ---' in result['text']
    assert result['metadata']['pages_without_extractable_text'] == [2]
    assert result['metadata']['ocr_attempted'] is False
    assert result['coverage']['partial']
    pdf(file, ['', ''])
    result = reader.extract(file.read_bytes(), file.name, 200000)
    assert result['status'] == 'unreadable' and not result['text']
    assert result['metadata']['pages_without_extractable_text'] == [1, 2]


def test_image_metadata_does_not_decode_pixels_or_return_image_text(tmp_path, monkeypatch):
    path = tmp_path / 'photo.png'; Image.new('RGB', (37, 19)).save(path)
    monkeypatch.setattr(Image.Image, 'load', lambda *args: pytest.fail('Pixels were decoded'))
    result = reader.extract(path.read_bytes(), path.name, 200000)
    assert result['status'] == 'metadata_only' and result['text'] == ''
    assert result['metadata']['width'] == 37 and result['metadata']['height'] == 19
    assert result['metadata']['format'] == 'PNG'


def test_svg_text_is_not_treated_as_readable_image_content():
    raw = b'<svg width="100" height="50"><text>Do not analyze this image text</text></svg>'
    result = reader.extract(raw, 'image.svg', 200000)
    assert not result['text'] and result['metadata']['width'] == '100'


def test_text_batches_cover_every_character_and_report_line_ranges():
    text = ''.join(f'Line {index}: ' + 'x' * 73 + '\n' for index in range(100)) + 'Final marker'
    batches = list(reader.text_batches(text, 500))
    assert ''.join(item['text'] for item in batches) == text
    assert all(len(item['text']) <= 500 for item in batches)
    assert batches[0]['first_line'] == 1 and batches[-1]['last_line'] == 101


def test_text_limits_encoding_and_static_python_structure():
    text = 'raise RuntimeError("Do not execute this source")\n\ndef double(value):\n    return value * 2\n'
    result = reader.extract(text.encode(), 'tools.py', 1000)
    assert result['metadata']['functions'] == [{'name': 'double', 'line': 3}]
    assert result['text'] == text
    result = reader.extract(('One two\n' * 1000).encode('utf-16'), 'notes.txt', 1000)
    assert result['coverage']['partial'] and result['coverage']['original_characters'] == 8000
    assert len(result['text']) == 1000
    with pytest.raises(ValueError, match='Binary'):
        reader.extract(b'a\0b', 'binary.txt', 1000)


def test_source_change_and_byte_limits_are_reported(tmp_path):
    path = tmp_path / 'growing.txt'; path.write_bytes(b'abc')
    def change():
        path.write_bytes(b'changed source')
    with pytest.raises(ValueError, match='changed|grew'):
        reader.read_source(path, tmp_path.resolve(), 1000, change)
    with pytest.raises(ValueError, match='byte limit'):
        reader.read_source(path, tmp_path.resolve(), 2, lambda: None)


def test_sources_read_only_and_all_text_batches_reviewed_with_images_excluded(tmp_path):
    root = tmp_path / 'source'; root.mkdir()
    (root / 'code.py').write_text('"""Project utilities."""\n' + '\ndef double(x):\n    return x * 2\n')
    text = ''.join('Fact %d\n' % index for index in range(160)) + 'THE FINAL FACT'
    (root / 'facts.txt').write_text(text)
    (root / 'guide.md').write_text('# Setup\nInstall the project, then run the local app.\n')
    Image.new('RGB', (20, 10)).save(root / 'cat.png')
    pdf(root / 'scan.pdf', [''])
    (root / '.env').write_text('PRIVATE=do-not-read')
    (root / 'node_modules').mkdir(); (root / 'node_modules/ignored.py').write_text('not reviewed')
    (root / 'nested').mkdir(); (root / 'nested/detail.txt').write_text('Nested information')
    before = {path.relative_to(root): path.read_bytes() for path in root.rglob('*') if path.is_file()}
    prompts = []
    async def summarize(prompt):
        prompts.append(prompt)
        return 'Observed source facts with file references.'
    manager = service.FolderReview(tmp_path / 'reports/reviews.sqlite3', summarize)
    async def execute():
        started = await manager.start(str(root), 'test-model', OPTIONS)
        await manager._task
        return manager.get(started['id']), manager.entries(started['id'], 0, 100)['items']
    review, items = asyncio.run(execute())
    assert review['status'] == 'completed_with_gaps'
    by_path = {item['path']: item for item in items}
    assert by_path['cat.png']['status'] == 'metadata_only'
    assert by_path['scan.pdf']['status'] == 'unreadable'
    assert by_path['.env']['status'] == 'excluded'
    assert by_path['node_modules']['status'] == 'excluded'
    assert by_path['nested/detail.txt']['status'] == 'reviewed'
    assert 'cat.png' not in '\n'.join(prompts) and 'PRIVATE=' not in '\n'.join(prompts)
    source_calls = [prompt for prompt in prompts if prompt.startswith('Review source file "facts.txt"')]
    slices = [json.loads(prompt.split('\n', 1)[1])['source'] for prompt in source_calls]
    assert ''.join(slices) == text
    assert by_path['facts.txt']['coverage']['batches_completed'] == len(slices)
    assert '## Per-file findings' in review['report'] and 'cat.png' in review['report']
    assert {path.relative_to(root): path.read_bytes() for path in root.rglob('*') if path.is_file()} == before
    reloaded = service.FolderReview(manager.database)
    assert reloaded.get(review['id'])['report'] == review['report']


def test_images_only_folder_never_calls_model(tmp_path):
    root = tmp_path / 'pictures'; root.mkdir(); Image.new('RGB', (10, 10)).save(root / 'image.png')
    async def forbidden(prompt):
        pytest.fail('Image metadata was sent to a model')
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3', forbidden)
    async def execute():
        started = await manager.start(str(root), 'text-model', OPTIONS); await manager._task
        return manager.get(started['id'])
    result = asyncio.run(execute())
    assert result['status'] == 'completed' and 'No readable text' in result['report']


def test_non_recursive_and_entry_caps_preserve_explicit_coverage(tmp_path):
    root = tmp_path / 'source'; root.mkdir(); (root / 'nested').mkdir(); (root / 'nested/child.txt').write_text('Child')
    (root / 'one.txt').write_text('One'); (root / 'two.txt').write_text('Two')
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3')
    async def execute():
        first = await manager.start(str(root), '', {**OPTIONS, 'recursive': False}); await manager._task
        second = await manager.start(str(root), '', {**OPTIONS, 'max_entries': 1}); await manager._task
        return manager.get(first['id']), manager.entries(first['id'])['items'], manager.get(second['id'])
    first, entries, second = asyncio.run(execute())
    assert 'nested/child.txt' not in {item['path'] for item in entries}
    assert first['counts']['excluded'] == 1
    assert second['total'] == 1 and not second['inventory_complete']
    assert second['status'] == 'completed_with_gaps'


def test_failed_model_keeps_completed_findings_and_marks_unread_files(tmp_path):
    root = tmp_path / 'source'; root.mkdir(); (root / 'a.txt').write_text('First'); (root / 'b.txt').write_text('Second')
    count = 0
    async def failure(prompt):
        nonlocal count
        count += 1
        if count == 2:
            raise RuntimeError('Provider unavailable')
        return 'First file finding.'
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3', failure)
    async def execute():
        started = await manager.start(str(root), 'test-model', OPTIONS); await manager._task
        return manager.get(started['id']), manager.entries(started['id'])['items']
    result, entries = asyncio.run(execute())
    assert result['status'] == 'failed' and result['processed'] == 1
    assert entries[0]['status'] == 'reviewed' and entries[1]['status'] == 'not_reviewed'
    assert 'First file finding.' in result['report'] and 'Provider unavailable' in result['error']


def test_cancellation_closes_provider_before_releasing_queue_and_keeps_results(tmp_path, monkeypatch):
    class Coordinator:
        def reserve(self, owner): return True
        def release(self, owner): pass
    local_queue = RequestQueue(Coordinator())
    monkeypatch.setattr(service, 'queue', local_queue)
    async def prepare(kind): pass
    async def handoff(*args, **kwargs):
        yield {'detail': 'Model ready'}
    monkeypatch.setattr(service, 'prepare_runtime', prepare)
    monkeypatch.setattr(service, 'prepare_chat_model', handoff)
    root = tmp_path / 'source'; root.mkdir(); (root / 'a.txt').write_text('First'); (root / 'b.txt').write_text('Second')
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3')
    async def execute():
        running, exited = asyncio.Event(), asyncio.Event()
        calls = 0
        async def model(*args):
            nonlocal calls
            calls += 1
            if calls == 1: return 'First finding.'
            running.set()
            try: await asyncio.Future()
            finally: exited.set()
        monkeypatch.setattr(manager, 'call_model', model)
        started = await manager.start(str(root), 'test-model', OPTIONS)
        await running.wait()
        with pytest.raises(RuntimeError, match='already running'):
            await manager.start(str(root), 'other-model', OPTIONS)
        await manager.cancel(started['id']); await manager._task
        assert exited.is_set() and local_queue.active is None
        assert all(job.status in {'completed', 'cancelled'} for job in local_queue.jobs)
        return manager.get(started['id'])
    result = asyncio.run(execute())
    assert result['status'] == 'cancelled' and result['counts']['reviewed'] == 1


def test_backend_restart_marks_unfinished_review_interrupted(tmp_path):
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3')
    with manager.connect() as db:
        db.execute("INSERT INTO reviews(id,root,model,options,status,phase,started_at) VALUES('unfinished','source','model','{}','running','Reading','date')")
    reloaded = service.FolderReview(manager.database)
    assert reloaded.get('unfinished')['status'] == 'interrupted'


def test_model_payload_is_text_only_and_empty_or_incomplete_output_fails(tmp_path, monkeypatch):
    original_client = httpx.AsyncClient
    payloads = []
    def transport(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200, content=b'{"message":{"content":"Source summary"}}\n{"done":true,"eval_count":3}\n')
    monkeypatch.setattr(service.httpx, 'AsyncClient', lambda **kwargs: original_client(transport=httpx.MockTransport(transport), **kwargs))
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3')
    assert asyncio.run(manager.call_model('model', 'Review this code', 900)) == 'Source summary'
    assert 'images' not in payloads[0] and all('images' not in message for message in payloads[0]['messages'])
    def empty(request): return httpx.Response(200, content=b'{"done":true}\n')
    monkeypatch.setattr(service.httpx, 'AsyncClient', lambda **kwargs: original_client(transport=httpx.MockTransport(empty), **kwargs))
    with pytest.raises(RuntimeError, match='empty or incomplete'):
        asyncio.run(manager.call_model('model', 'Review source', 900))


def test_authenticated_api_background_work_and_report_download(tmp_path, monkeypatch):
    root = tmp_path / 'source'; root.mkdir(); (root / 'guide.md').write_text('# Project\nThis project performs calculations.\n')
    async def summarize(prompt): return 'The project performs calculations, as recorded in guide.md.'
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3', summarize)
    monkeypatch.setattr(service, '_manager', manager)
    app = FastAPI(); app.include_router(router); app.add_middleware(SessionGuard)
    headers = {'X-LAW-Session': 'test-session-token'}
    with TestClient(app, base_url='http://127.0.0.1:8000') as client:
        assert client.post('/folder-review/reviews', json={'root': str(root), 'model': 'test-model'}).status_code == 403
        assert not manager.status()['reviews']
        assert client.post('/folder-review/reviews', headers=headers, json={'root': str(root), 'model': 'test-model', 'ocr': True}).status_code == 422
        response = client.post('/folder-review/reviews', headers=headers, json={'root': str(root), 'model': 'test-model'})
        assert response.status_code == 202
        key = response.json()['id']
        for _ in range(100):
            review = client.get('/folder-review/reviews/' + key, headers=headers).json()
            if review['status'] in service.TERMINAL: break
            time.sleep(0.01)
        assert review['status'] == 'completed' and review['report_ready']
        status = client.get('/folder-review/status', headers=headers).json()
        assert 'report' not in status['reviews'][0] and status['reviews'][0]['extensions'] == {'.md': 1}
        files = client.get(f'/folder-review/reviews/{key}/files', headers=headers).json()
        assert files['items'][0]['status'] == 'reviewed'
        report = client.get(f'/folder-review/reviews/{key}/export', headers=headers)
        assert report.status_code == 200 and 'guide.md' in report.text and 'State: completed' in report.text
        assert report.headers['cache-control'] == 'no-store'
        assert client.get('/folder-review/reviews/not-a-review', headers=headers).status_code == 422
        assert client.get('/folder-review/reviews/' + '0' * 32, headers=headers).status_code == 404


def test_directory_links_do_not_escape_scope(tmp_path):
    root = tmp_path / 'source'; root.mkdir()
    outside = tmp_path / 'outside'; outside.mkdir(); (outside / 'private.txt').write_text('Outside selected scope')
    try:
        (root / 'external').symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip('Directory symlinks are not available to this Windows test account')
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3')
    async def execute():
        started = await manager.start(str(root), '', OPTIONS); await manager._task
        return manager.entries(started['id'])['items']
    entries = asyncio.run(execute())
    assert len(entries) == 1 and entries[0]['status'] == 'excluded'
    assert not entries[0]['analysis']


def test_folder_review_blocks_maintenance_even_between_inference_requests(tmp_path, monkeypatch):
    from services import maintenance_gate
    manager = service.FolderReview(tmp_path / 'reports/db.sqlite3')
    monkeypatch.setattr(service, '_manager', manager)
    class Running:
        def done(self): return False
    manager._task = Running()
    assert maintenance_gate.workers_busy()
