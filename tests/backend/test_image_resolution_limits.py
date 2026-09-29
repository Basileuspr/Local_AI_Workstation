import pytest
from pydantic import ValidationError

from routes.image_generation import ImageGenerationRequest
from services.image_generation_limits import resolution_limits, validate_dimensions
from services.image_workflows.contracts import Draft, Stage
from services.image_workflows.scene_state import Scene


@pytest.mark.parametrize('gib,normal,extended', [(4, 1024, 1280), (6, 1024, 1536), (8, 1536, 2048), (24, 1536, 2048)])
def test_hardware_limits(gib, normal, extended):
    limits = resolution_limits(gib * 1024 ** 3)
    validate_dimensions(256, 256, limits=limits)
    validate_dimensions(normal, normal, limits=limits)
    with pytest.raises(ValueError):
        validate_dimensions(extended, extended, limits=limits)
    validate_dimensions(extended, extended, True, limits)
    with pytest.raises(ValueError):
        validate_dimensions(extended + 8, extended, True, limits)


@pytest.mark.parametrize('size,enabled,valid', [(256, False, True), (1536, False, True), (2048, False, False), (2048, True, True), (248, True, False), (257, True, False), (2056, True, False)])
def test_all_generation_contracts_enforce_opt_in(size, enabled, valid):
    dimensions = dict(width=size, height=size, allow_long_wait=enabled)
    for constructor, fields in [(ImageGenerationRequest, dict(model_id='test', prompt='test')),
                                (Stage, dict(id='a' * 32, operation='txt2img')), (Scene, {})]:
        if valid:
            assert constructor(**fields, **dimensions).width == size
        else:
            with pytest.raises(ValidationError):
                constructor(**fields, **dimensions)


def test_scene_compilation_preserves_large_canvas_and_wait_mode():
    draft = Draft(name='Large scene', mode='scene', scene=Scene(width=2048, height=1152, allow_long_wait=True))
    assert draft.stages[0].width == 2048
    assert draft.stages[0].height == 1152
    assert draft.stages[0].allow_long_wait is True


def test_generate_rechecks_current_hardware_before_loading(monkeypatch):
    from services import image_generation, image_generation_limits
    monkeypatch.setattr(image_generation_limits, 'current_resolution_limits', lambda: resolution_limits(4 * 1024 ** 3))
    monkeypatch.setattr(image_generation, 'discover_models', lambda: pytest.fail('Invalid sizes must fail before model loading'))
    with pytest.raises(ValueError, match='1280'):
        image_generation.ImageGenerationManager().generate(model_id='test', prompt='test', negative_prompt='',
            width=2048, height=2048, steps=1, guidance_scale=5, seed=0, allow_long_wait=True)
