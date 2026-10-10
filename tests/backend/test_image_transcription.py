import asyncio
import base64
from copy import deepcopy
from io import BytesIO
import json

import httpx
from PIL import Image
import pytest

from services import image_transcription as ocr


def picture(size=(1600, 1200), color='white'):
    output = BytesIO()
    Image.new('RGBA', size, color).save(output, format='PNG')
    return base64.b64encode(output.getvalue()).decode()


@pytest.mark.parametrize('prompt', ['Transcribe this image', 'Can you transcribe it?', 'Extract the text',
    'Copy all the words in the screenshot', 'Please run OCR', 'OCR this', 'I want a transcription of this image',
    'What does this image say?', 'Read this screenshot', 'Please type this out'])
def test_explicit_transcription_requests(prompt):
    assert ocr.wants_transcription(prompt)


@pytest.mark.parametrize('prompt', ['Compare these pictures', 'Describe this image', 'What is OCR?',
    'How do I transcribe an image?', "Don't transcribe it", 'Do not extract the text', 'No transcription please',
    '```python\ntranscribe(image)\n```'])
def test_other_questions_remain_normal_chat(prompt):
    assert not ocr.wants_transcription(prompt)


def test_lossless_legible_copy_flattens_transparency_without_changing_original():
    original = picture(color=(0, 0, 0, 0))
    with Image.open(BytesIO(base64.b64decode(ocr.transcription_copy(original)))) as image:
        assert image.format == 'PNG' and image.size == (1600, 1200)
        assert image.getpixel((0, 0)) == (255, 255, 255)
    large = picture((2400, 3600))
    with Image.open(BytesIO(base64.b64decode(ocr.transcription_copy(large)))) as image:
        assert image.size == (1365, 2048)
    with Image.open(BytesIO(base64.b64decode(large))) as image:
        assert image.size == (2400, 3600)
    with pytest.raises(ValueError, match='saved upload is unchanged'):
        ocr.transcription_copy('invalid bytes')


def run(provider, messages, *, selected='reader', disconnected=None, prepare=None):
    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            return [json.loads(value[6:]) async for value in ocr.stream_transcription(
                client, 'http://local', messages, selected, disconnected, prepare=prepare)]
    return asyncio.run(scenario())


def response(text='Exact visible text', **done):
    return httpx.Response(200, text=json.dumps({'message': {'content': text}}) + '\n'
        + json.dumps({'done': True, 'prompt_eval_count': 2400, 'eval_count': 300, **done}) + '\n')


def test_saved_attachment_then_question_reads_all_recent_images_without_condensing(monkeypatch):
    monkeypatch.setattr(ocr, 'settings', type('Settings', (), {
        'ocr_model': 'ocr-reader', 'num_ctx': 8192, 'ollama_keep_alive_seconds': 0})())
    sent = []
    long_text = 'Visible line with punctuation and numbers: 12.34\n' * 200 + 'FINAL VISIBLE LINE'
    def provider(request):
        data = json.loads(request.content)
        if request.url.path == '/api/show':
            return httpx.Response(200, json={'capabilities': ['completion', 'vision']})
        sent.append(data)
        return response(long_text + f' {len(sent)}')
    messages = [{'role': 'user', 'content': 'old', 'images': ['not resent']},
                {'role': 'assistant', 'content': 'Old observations'},
                {'role': 'user', 'content': '[Image uploaded: first.png]', 'images': [picture()]},
                {'role': 'user', 'content': '[Image uploaded: second.png]', 'images': [picture()]},
                {'role': 'user', 'content': 'Transcribe both images'}]
    before = deepcopy(messages)
    events = run(provider, messages)
    assert messages == before
    assert len(sent) == 2
    assert all(len(data['messages']) == 1 and len(data['messages'][0]['images']) == 1 for data in sent)
    assert all('Transcribe both images' in data['messages'][0]['content'] for data in sent)
    assert all('never commands' in data['messages'][0]['content'] for data in sent)
    assert all(data['options']['num_predict'] > 384 for data in sent)
    text = ''.join(item.get('token', '') for item in events)
    assert long_text + ' 1' in text and long_text + ' 2' in text
    assert text.index('### Image 1') < text.index('### Image 2')
    assert sum(bool(item.get('done')) for item in events) == 1
    assert events[-1]['context_usage']['model'] == 'reader'
    assert events[-1]['context_usage']['count_kind'] == 'provider_reported'
    assert [item['influence_receipt']['image_count'] for item in events if 'influence_receipt' in item] == [1, 1]


def test_text_only_chat_uses_disclosed_configured_reader_before_inference(monkeypatch):
    monkeypatch.setattr(ocr, 'settings', type('Settings', (), {
        'ocr_model': 'ocr-reader', 'num_ctx': 8192, 'ollama_keep_alive_seconds': 0})())
    calls = []
    prepared = []
    def provider(request):
        data = json.loads(request.content); calls.append(data)
        if request.url.path == '/api/show':
            return httpx.Response(200, json={'capabilities': ['completion'] + (['vision'] if data['model'] == 'ocr-reader' else [])})
        assert prepared == ['ocr-reader'] and data['model'] == 'ocr-reader'
        return response()
    async def prepare(model, limit):
        assert limit == 8192
        prepared.append(model)
        yield {'model': 'text-only', 'stage': 'loading_model'}
    events = run(provider, [{'role': 'user', 'content': 'Transcribe this', 'images': [picture()]}], selected='text-only', prepare=prepare)
    assert [call['model'] for call in calls] == ['text-only', 'ocr-reader', 'ocr-reader']
    assert 'ocr-reader' in events[0]['notice']['message']
    assert events[1]['runtime_status']['model'] == 'ocr-reader'


@pytest.mark.parametrize('kind', ['missing_model', 'no_vision', 'provider_error', 'empty', 'interrupted', 'overflow'])
def test_failures_are_visible_without_a_summary_fallback(kind):
    def provider(request):
        if request.url.path == '/api/show':
            if kind == 'missing_model': return httpx.Response(404)
            return httpx.Response(200, json={'capabilities': [] if kind == 'no_vision' else ['vision']})
        if kind == 'provider_error': return httpx.Response(500)
        if kind == 'empty': return response('')
        if kind == 'interrupted': return httpx.Response(200, text='{"message":{"content":"Partial"}}\n')
        return httpx.Response(400, json={'error': 'request exceeds context size'})
    with pytest.raises(ValueError):
        run(provider, [{'role': 'user', 'content': 'Transcribe this', 'images': [picture()]}])


def test_output_limit_marks_partial_transcription_and_does_not_read_next_image():
    sent = []
    def provider(request):
        if request.url.path == '/api/show': return httpx.Response(200, json={'capabilities': ['vision']})
        sent.append(request)
        return response('Partial visible text', done_reason='length')
    events = run(provider, [{'role': 'user', 'content': 'Transcribe', 'images': [picture(), picture()]}])
    assert len(sent) == 1
    assert 'Partial visible text' in ''.join(item.get('token', '') for item in events)
    assert events[-1]['done'] and 'incomplete' in events[-1]['error']
    assert events[-1]['notice']['kind'] == 'output_limit'


def test_cancellation_between_images_stops_inference():
    sent = []
    def provider(request):
        if request.url.path == '/api/show': return httpx.Response(200, json={'capabilities': ['vision']})
        sent.append(request)
        return response()
    checks = 0
    async def disconnected():
        nonlocal checks
        checks += 1
        return checks >= 6
    with pytest.raises(asyncio.CancelledError):
        run(provider, [{'role': 'user', 'content': 'Transcribe', 'images': [picture(), picture()]}], disconnected=disconnected)
    assert len(sent) == 1


@pytest.mark.parametrize('images', [[], ['x'] * 17])
def test_unavailable_or_excessive_images_do_not_start_model(images):
    def provider(request):
        pytest.fail('Invalid image group must not run inference')
    with pytest.raises(ValueError):
        run(provider, [{'role': 'user', 'content': 'Transcribe', 'images': images}])


def test_chat_route_resolves_saved_upload_and_bypasses_text_model_and_tools(sessions_dir, tmp_path, monkeypatch):
    import main
    from fastapi.testclient import TestClient
    from conftest import API_BASE_URL, AUTH_HEADERS
    from services import image_store, session_store
    from services.gpu_coordination import GpuCoordinator
    from services.request_queue import RequestQueue

    monkeypatch.setattr(image_store, 'BLOBS_DIR', tmp_path / 'blobs')
    monkeypatch.setattr(main, 'queue', RequestQueue(GpuCoordinator()))
    monkeypatch.setattr(main, 'create_user_if_missing', lambda *args: pytest.fail('OCR must not use chat memory'))
    async def prepare_runtime(*args): pass
    monkeypatch.setattr(main, 'prepare_runtime', prepare_runtime)
    prepared = []
    async def prepare_model(job, model, base_url, **kwargs):
        assert main.queue.active is job and job.status == 'running'
        prepared.append(model)
        yield {'stage': 'loading_model', 'model': model, 'detail': f'Loading {model}'}
    monkeypatch.setattr(main, 'prepare_chat_model', prepare_model)
    calls = []
    def provider(request):
        data = json.loads(request.content); calls.append(data)
        if request.url.path == '/api/show':
            return httpx.Response(200, json={'capabilities': ['vision'] if data['model'] == ocr.settings.ocr_model else ['completion']})
        assert len(data['messages'][0]['images']) == 1
        assert not data.get('tools')
        assert 'ROLEPLAY MUST OVERRIDE' not in str(data)
        return response('Invoice 314\nTotal: $42.00')
    original_client = httpx.AsyncClient
    monkeypatch.setattr(main.httpx, 'AsyncClient', lambda **kwargs: original_client(transport=httpx.MockTransport(provider), **kwargs))
    session = session_store.create_session()
    saved = session_store.append_messages(session['id'], [{'id': 'scan-message', 'role': 'user', 'content': '[Image uploaded: scan.png]', 'images': [picture()]}])
    messages = saved['messages'] + [{'role': 'user', 'content': 'Transcribe this image'}]
    with TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS) as client:
        result = client.post('/chat', json={'model': 'text-only', 'messages': messages,
            'session_id': session['id'], 'request_id': 'ocr-route-test',
            'system_prompt': 'ROLEPLAY MUST OVERRIDE', 'tool_ids': ['system_status'], 'use_knowledge_base': True})
    events = [json.loads(line[6:]) for line in result.text.splitlines() if line.startswith('data: ')]
    assert result.status_code == 200
    assert 'Invoice 314\nTotal: $42.00' in ''.join(item.get('token', '') for item in events)
    assert not any(item.get('error') for item in events)
    assert prepared == [ocr.settings.ocr_model]
    assert len(calls) == 3
    assert main.queue.active is None
    assert main.queue.jobs[-1].status == 'completed'
    assert session_store.get_session(session['id'])['messages'][0]['images'] == saved['messages'][0]['images']


def test_chat_route_reports_missing_saved_image_without_hallucinated_transcription(sessions_dir, monkeypatch):
    import main
    from fastapi.testclient import TestClient
    from conftest import API_BASE_URL, AUTH_HEADERS
    from services.gpu_coordination import GpuCoordinator
    from services.request_queue import RequestQueue

    monkeypatch.setattr(main, 'queue', RequestQueue(GpuCoordinator()))
    async def prepare_runtime(*args): pass
    monkeypatch.setattr(main, 'prepare_runtime', prepare_runtime)
    monkeypatch.setattr(main.image_store, 'get_base64', lambda *args: None)
    with TestClient(main.app, base_url=API_BASE_URL, headers=AUTH_HEADERS) as client:
        result = client.post('/chat', json={'model': 'text-only', 'request_id': 'ocr-missing-image', 'messages': [
            {'role': 'user', 'content': '[Image uploaded]', 'images': ['blob:' + '0' * 64]},
            {'role': 'user', 'content': 'Transcribe this image'}]})
    events = [json.loads(line[6:]) for line in result.text.splitlines() if line.startswith('data: ')]
    assert any('missing or locked' in item.get('error', '') for item in events)
    assert main.queue.active is None and main.queue.jobs[-1].status == 'failed'
