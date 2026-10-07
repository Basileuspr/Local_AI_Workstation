import asyncio
import base64
from copy import deepcopy
from io import BytesIO
import json
from types import SimpleNamespace

import httpx
from PIL import Image
import pytest

from services.chat_context import (clip_text, compact_history, fit_payload, image_copy,
                                   open_chat_stream, overflow_limit, recent_image_messages)
from services.context_awareness import estimate_text, payload_usage


@pytest.fixture(autouse=True)
def isolated_runtime_limits(monkeypatch):
    from services import context_awareness
    monkeypatch.setattr(context_awareness, '_runtime_limits', {})


def picture(size=(1800, 1200), color='red'):
    stream = BytesIO()
    Image.new('RGB', size, color).save(stream, format='PNG')
    return base64.b64encode(stream.getvalue()).decode()


def payload(messages, **options):
    return {'model': 'budget-test', 'messages': messages, 'stream': True,
            'options': {'num_ctx': 8192, 'num_predict': 1024, **options}}


def test_bounds_history_and_retrieval_preserving_current_request_and_source():
    history = [{'role': 'system', 'content': 'Follow the user instructions.'},
               {'role': 'system', 'content': 'The following are durable memories ' + 'preference ' * 3000}]
    for i in range(20):
        history += [{'role': 'user', 'content': f'Question {i}: ' + 'old history ' * 100},
                    {'role': 'assistant', 'content': 'Previous answer ' * 100}]
    history.append({'role': 'user', 'content': 'Please describe the attached image.', 'images': ['reference']})
    original = payload(history)
    before = deepcopy(original)
    fitted = fit_payload(original)
    assert original == before
    assert fitted['messages'][-1] == history[-1]
    assert history[0] in fitted['messages']
    assert payload_usage(fitted)['estimated_prompt_tokens'] <= fitted['_context_budget']['input_target']
    assert payload_usage(fitted)['application_trimming']
    assert fitted['_context_budget']['input_target'] < 8192 - 1024


def test_does_not_silently_truncate_current_instructions_or_question():
    for role in ('system', 'user'):
        with pytest.raises(ValueError, match='attachments are saved'):
            fit_payload(payload([{'role': role, 'content': 'long current instruction ' * 5000}]))


def test_reply_and_thinking_reserve_cannot_fill_window():
    fitted = fit_payload(payload([{'role': 'user', 'content': 'hello'}], num_predict=16384))
    assert fitted['options']['num_predict'] == 4096
    assert not payload_usage(fitted)['over_budget_estimate']


def test_old_image_pixels_replaced_without_mutation_latest_group_preserved():
    messages = [{'role': 'user', 'content': 'old', 'images': ['old']}, {'role': 'assistant', 'content': 'Red square.'},
                {'role': 'user', 'content': 'upload A', 'images': ['a']}, {'role': 'user', 'content': 'upload B', 'images': ['b']},
                {'role': 'user', 'content': 'Compare these.'}]
    result, omitted = recent_image_messages(messages)
    assert omitted == 1 and 'images' not in result[0]
    assert result[2:] == messages[2:]
    assert messages[0]['images'] == ['old']


def test_image_copy_is_small_and_does_not_change_original():
    original = picture()
    resized = image_copy(original, 512)
    with Image.open(BytesIO(base64.b64decode(resized))) as image:
        assert image.size == (512, 341)
    with Image.open(BytesIO(base64.b64decode(original))) as image:
        assert image.size == (1800, 1200)


@pytest.mark.parametrize('text', ['hello ' * 5000, '你好世界🙂' * 2000, '{"x":123},' * 3000], ids=['prose', 'unicode', 'code'])
def test_unicode_code_excerpts_respect_token_estimator(text):
    assert 0 < estimate_text(clip_text(text, 400)) <= 400


def test_parses_real_nested_19998_token_failure():
    raw = json.dumps({'error': {'code': 400, 'message': 'request (19998 tokens) exceeds the available context size (8192 tokens), try increasing it',
                              'type': 'exceed_context_size_error', 'n_prompt_tokens': 19998, 'n_ctx': 8192}})
    assert overflow_limit(raw) == 8192
    assert overflow_limit('{"error":"model not found"}') is None


def test_multi_image_requests_analyze_all_images_then_synthesize():
    sent = []
    async def provider(request):
        data = json.loads(request.content)
        sent.append(data)
        images = sum(len(m.get('images', [])) for m in data['messages'])
        assert images <= 1
        assert payload_usage(data)['estimated_prompt_tokens'] + data['options']['num_predict'] + 512 <= 8192
        if not data['stream']:
            return httpx.Response(200, json={'message': {'content': f'Observation {len(sent)}: a colored rectangle.'}})
        return httpx.Response(200, text='{"message":{"content":"Compared all images."},"done":true}\n')
    original = payload([{'role': 'user', 'content': 'Compare the pictures.', 'images': [picture(color=c) for c in ('red', 'green', 'blue')]}])
    before = deepcopy(original)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            async with open_chat_stream(client, 'http://local', original) as response:
                assert response.status_code == 200
                assert 'Compared all images' in (await response.aread()).decode()
    asyncio.run(run())
    assert len(sent) == 4
    assert all(f'Image {i}' in sent[-1]['messages'][-1]['content'] for i in (1, 2, 3))
    assert 'images' not in sent[-1]['messages'][-1]
    assert original['_context_notices']
    assert len(before['messages'][0]['images']) == 3
    assert not any(key.startswith('_context_') for data in sent for key in data)


def test_overflow_retries_smaller_single_image_and_preserves_question():
    sent = []
    async def provider(request):
        data = json.loads(request.content); sent.append(data)
        if len(sent) == 1:
            return httpx.Response(400, json={'error': {'message': 'request (19998 tokens) exceeds the available context size (8192 tokens)', 'n_ctx': 8192}})
        return httpx.Response(200, text='{"message":{"content":"Visible answer"},"done":true}\n')
    current = payload([{'role': 'user', 'content': 'Describe this.', 'images': [picture()]}])
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            async with open_chat_stream(client, 'http://local', current) as response:
                assert response.status_code == 200
    asyncio.run(run())
    assert len(sent) == 2
    sizes = []
    for data in sent:
        assert data['messages'][-1]['content'] == 'Describe this.'
        with Image.open(BytesIO(base64.b64decode(data['messages'][-1]['images'][0]))) as image: sizes.append(image.width)
    assert sizes == [768, 384]


def test_no_retry_for_unrelated_provider_error():
    sent = []
    async def provider(request):
        sent.append(request)
        return httpx.Response(404, json={'error': 'model not found'})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            async with open_chat_stream(client, 'http://local', payload([{'role': 'user', 'content': 'hi'}])) as response:
                assert response.status_code == 404
    asyncio.run(run())
    assert len(sent) == 1


def test_provider_text_token_feedback_reduces_retry_not_just_num_ctx():
    sent = []
    async def provider(request):
        data = json.loads(request.content); sent.append(data)
        if len(sent) == 1:
            return httpx.Response(400, json={'error': {'message': 'request (19998 tokens) exceeds the available context size (8192 tokens)', 'n_ctx': 8192, 'n_prompt_tokens': 19998}})
        return httpx.Response(200, text='{"message":{"content":"Answer"},"done":true}\n')
    messages = []
    for i in range(12): messages += [{'role': 'user', 'content': 'question ' * 50}, {'role': 'assistant', 'content': 'answer ' * 50}]
    messages.append({'role': 'user', 'content': 'What did we decide?'})
    current = payload(messages)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            async with open_chat_stream(client, 'http://local', current) as response: assert response.status_code == 200
    asyncio.run(run())
    assert len(sent) == 2
    assert len(json.dumps(sent[1]['messages'])) < len(json.dumps(sent[0]['messages']))
    assert sent[-1]['messages'][-1]['content'] == 'What did we decide?'


def test_disconnect_stops_image_batch_before_next_request():
    sent = []
    async def provider(request):
        sent.append(request)
        return httpx.Response(200, json={'message': {'content': 'one image'}})
    async def disconnected(): return bool(sent)
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            with pytest.raises(asyncio.CancelledError):
                async with open_chat_stream(client, 'http://local', payload([{'role': 'user', 'content': 'Compare', 'images': [picture(), picture()]}]), disconnected):
                    pytest.fail('Cancelled batch must not synthesize')
    asyncio.run(run())
    assert len(sent) == 1


def test_compaction_chunks_long_text_including_middle_and_never_sends_image_data():
    sent = []
    async def provider(request):
        data = json.loads(request.content); sent.append(data)
        assert payload_usage(data)['estimated_prompt_tokens'] + data['options']['num_predict'] + 512 < 4096
        return httpx.Response(200, json={'message': {'content': 'Goals: preserve original images. Open questions: compare colors.'}})
    text = 'first ' * 3000 + 'UNIQUE_MIDDLE_REQUIREMENT ' + 'last ' * 3000
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            return await compact_history(client, 'http://local', model='budget-test', previous='Keep originals',
                messages=[SimpleNamespace(role='user', content=text, images=['SECRET_IMAGE_BYTES'])], target=700, limit=4096)
    result = asyncio.run(run())
    assert result['chunks'] > 1 and result['method'] == 'model_summary'
    assert 'UNIQUE_MIDDLE_REQUIREMENT' in ''.join(m['content'] for data in sent for m in data['messages'])
    assert 'SECRET_IMAGE_BYTES' not in json.dumps(sent)
    assert estimate_text(result['summary']) <= 512


def test_compaction_failure_is_explicit_partial_memory_not_empty():
    async def provider(request): return httpx.Response(400, json={'error': 'unavailable'})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            return await compact_history(client, 'http://local', model='budget-test', previous='Preserve originals.',
                messages=[SimpleNamespace(role='user', content='Compare the pictures.', images=None)], target=400, limit=8192)
    result = asyncio.run(run())
    assert result['method'] == 'partial_excerpts'
    assert 'Partial working-memory' in result['summary']
    assert 'Preserve originals' in result['summary']
