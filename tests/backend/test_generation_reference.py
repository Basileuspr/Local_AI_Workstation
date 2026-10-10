import asyncio
import io
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from routes import image_generation as routes
from services import generation_reference as references, image_store, image_vault
from services.image_tasks import ImageTasks
from test_image_generation_cancel import configure_manager, generation_options


@pytest.fixture(autouse=True)
def isolated_blobs(tmp_path, monkeypatch):
    references.preparation_cache.clear()
    monkeypatch.setattr(image_store, 'BLOBS_DIR', tmp_path / 'blobs')
    monkeypatch.setattr(image_vault, 'is_locked', lambda _: False)
    from services import image_generation_cache
    monkeypatch.setattr(image_generation_cache, 'memory_headroom', lambda: 256 * 1024 ** 2)


def png(size=(120, 60), color='red'):
    stream = io.BytesIO()
    Image.new('RGB', size, color).save(stream, 'PNG')
    return stream.getvalue()


def test_upload_validates_actual_bytes_and_preserves_original():
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        data = png()
        response = client.post('/image-generation/references', files={'file': ('source.png', data, 'image/png')})
        assert response.status_code == 200
        stored = response.json()
        assert (stored['width'], stored['height']) == (120, 60)
        assert references.reference_bytes(stored['reference']) == data
        again = client.post('/image-generation/references', files={'file': ('renamed.png', data, 'image/png')})
        assert again.json()['reference'] == stored['reference']
        assert len(list(image_store.BLOBS_DIR.iterdir())) == 1
        assert client.post('/image-generation/references', files={'file': ('fake.png', b'not pixels', 'image/png')}).status_code == 400


def test_oversized_upload_and_locked_reference_rejected(monkeypatch):
    monkeypatch.setattr(references, 'MAX_UPLOAD_BYTES', 30)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        assert client.post('/image-generation/references', files={'file': ('big.png', png(), 'image/png')}).status_code == 413
    monkeypatch.setattr(image_vault, 'is_locked', lambda _: True)
    with pytest.raises(image_vault.LockedImageError):
        references.store_reference('locked.png', png())


def test_fit_preserves_proportions_and_crop_is_explicit():
    stored = references.store_reference('wide.png', png())
    fit = references.prepare_reference(stored['reference'], 80, 80, 'contain')
    crop = references.prepare_reference(stored['reference'], 80, 80, 'crop')
    assert fit.size == crop.size == (80, 80)
    assert fit.getpixel((40, 0)) == (255, 255, 255)
    assert fit.getpixel((40, 40)) == crop.getpixel((40, 0)) == (255, 0, 0)


@pytest.mark.parametrize('size,target', [((12, 6), (12, 12)), ((6, 12), (12, 12)), ((7, 5), (15, 16))])
def test_edge_fit_preserves_full_source_and_extends_actual_border(size, target):
    source = Image.new('RGB', size, 'red')
    source.putpixel((0, 0), (0, 255, 0))
    source.putpixel((size[0] - 1, size[1] - 1), (0, 0, 255))
    stream = io.BytesIO(); source.save(stream, 'PNG')
    stored = references.store_reference('edges.png', stream.getvalue())
    actual = references.prepare_reference(stored['reference'], *target, 'edge')
    from PIL import ImageOps
    scaled = ImageOps.contain(source, target, Image.Resampling.LANCZOS)
    x, y = (target[0] - scaled.width) // 2, (target[1] - scaled.height) // 2
    assert actual.size == target
    assert actual.crop((x, y, x + scaled.width, y + scaled.height)).tobytes() == scaled.tobytes()
    assert actual.getpixel((0, 0)) == scaled.getpixel((0, 0))
    assert actual.getpixel((target[0] - 1, target[1] - 1)) == scaled.getpixel((scaled.width - 1, scaled.height - 1))
    assert references.reference_bytes(stored['reference']) == stream.getvalue()


def test_orientation_transparency_and_reference_validation():
    stream = io.BytesIO()
    source = Image.new('RGBA', (10, 20), (255, 0, 0, 0))
    exif = Image.Exif(); exif[274] = 6
    source.save(stream, 'PNG', exif=exif)
    stored = references.store_reference('portrait.png', stream.getvalue())
    assert (stored['width'], stored['height']) == (20, 10)
    result = references.prepare_reference(stored['reference'], 20, 10, 'contain')
    assert result.mode == 'RGB' and result.getpixel((0, 0)) == (255, 255, 255)
    with pytest.raises(ValueError, match='valid reference'):
        references.reference_bytes('../../private.png')
    with pytest.raises(ValueError, match='missing or locked'):
        references.reference_bytes('blob:' + '0' * 64)


def test_request_rejects_zero_effective_steps_and_invalid_strength():
    options = {**generation_options(), 'source_image_ref': 'blob:' + 'a' * 64}
    for changes in ({'strength': 0}, {'strength': float('nan')}, {'steps': 1, 'strength': .3}, {'source_fit': 'stretch'}):
        with pytest.raises(ValidationError):
            routes.ImageGenerationRequest(**{**options, **changes})
    assert routes.ImageGenerationRequest(**options).strength == .3


def test_generate_passes_pixels_strength_and_tracks_effective_steps(monkeypatch, tmp_path):
    stored = references.store_reference('source.png', png())
    observed = []
    holder = {}
    def pipeline(**kwargs):
        assert kwargs['image'].size == (512, 512)
        assert kwargs['image'].getpixel((256, 256)) == (255, 0, 0)
        assert kwargs['strength'] == .25
        assert 'width' not in kwargs
        kwargs['callback_on_step_end'](None, 0, None, {})
        observed.append(holder['manager'].generation_progress('image-request-1'))
        return SimpleNamespace(images=[kwargs['image']])
    manager, coordinator = configure_manager(monkeypatch, tmp_path, pipeline)
    holder['manager'] = manager
    monkeypatch.setattr(manager, '_pipeline_for_operation', lambda operation: pipeline if operation == 'img2img' else pytest.fail(operation))
    result = manager.generate(**generation_options(), source_image_ref=stored['reference'], strength=.25)
    assert observed[0]['total_steps'] == 3 and observed[0]['step'] == 1
    assert coordinator.current_owner() is None
    with Image.open(tmp_path / result['filename']) as image:
        recipe = json.loads(image.info['local_ai_generation'])
    assert recipe['source_image_ref'] == stored['reference'] and recipe['strength'] == .25
    assert recipe['seed'] == 7 and recipe['prompt'] == 'test image'


def test_queued_reference_and_recipe_are_persisted_with_chat(monkeypatch):
    from services import session_store
    appended = []
    monkeypatch.setattr(session_store, 'append_messages', lambda session, messages, model: appended.extend(messages) or {'id':session})
    stored = references.store_reference('source.png', png())
    async def scenario():
        tasks = ImageTasks()
        recipe = {'source_image_ref':stored['reference'], 'strength':.3}
        async def execute(request):
            return {'filename':'output.png', 'image_ref':'blob:output', 'seed':7, 'generation_recipe':recipe}
        request = {**generation_options(), 'session_id':'chat', 'source_image_ref':stored['reference']}
        await tasks.submit('client', [request], None, None, execute)
        await tasks.tasks[request['request_id']].worker
        assert appended[0]['imagePreviews'][0]['src'] == stored['reference']
        assert appended[1]['generatedImages'][0]['generationRecipe'] == recipe
    asyncio.run(scenario())
