"""Timing and redundant-work regressions using CPU tensors and isolated files."""
from types import SimpleNamespace

import pytest
import torch
from PIL import Image

from services import generation_timing
from test_image_generation_cancel import configure_manager, generation_options


def test_pipeline_stage_boundaries_do_not_synchronize_each_step_and_restore_hooks(monkeypatch):
    clock, syncs = [0.0], []
    monkeypatch.setattr(generation_timing.time, 'perf_counter', lambda: clock[0])
    def spend(seconds): clock[0] += seconds
    class Denoiser(torch.nn.Module):
        def forward(self, value): spend(1); return value + 1
    class Vae:
        def decode(self): spend(3)
    class Pipeline:
        def __init__(self): self.unet, self.vae = Denoiser(), Vae()
        def encode_prompt(self): spend(2)
        def maybe_free_model_hooks(self): spend(1)
    pipeline = Pipeline()
    timing = generation_timing.GenerationTiming()
    with generation_timing.PipelineTiming(pipeline, timing, lambda: syncs.append(1)) as observer:
        pipeline.encode_prompt()
        for _ in range(10): pipeline.unet(torch.tensor(1))
        observer.finish_denoising()
        pipeline.vae.decode()
        pipeline.maybe_free_model_hooks()
    assert timing.snapshot() == {'prompt_encoding': 2, 'denoising': 10, 'decoding': 3, 'offload_cleanup': 1}
    assert len(syncs) == 8  # stage boundaries, independent of the step count
    assert not pipeline.unet._forward_pre_hooks
    assert 'encode_prompt' not in pipeline.__dict__ and 'decode' not in pipeline.vae.__dict__


def test_pipeline_timing_restores_wrappers_after_failure():
    pipeline = SimpleNamespace(encode_prompt=lambda: None)
    original = pipeline.encode_prompt
    with pytest.raises(RuntimeError):
        with generation_timing.PipelineTiming(pipeline, generation_timing.GenerationTiming(), lambda: None):
            raise RuntimeError('inference failed')
    assert pipeline.encode_prompt is original


def test_timing_keeps_original_error_when_cuda_synchronization_would_fail():
    calls = []
    def synchronize():
        calls.append(1)
        if len(calls) > 1:
            raise RuntimeError('secondary CUDA error')
    with pytest.raises(ValueError, match='original inference error'):
        with generation_timing.GenerationTiming().measure('decoding', synchronize):
            raise ValueError('original inference error')
    assert len(calls) == 1


def test_task_output_skips_inline_conversion_but_direct_call_keeps_it(monkeypatch, tmp_path):
    from routes import image_generation as routes
    from services import image_store
    def pipeline(**kwargs): return SimpleNamespace(images=[Image.new('RGB', (8, 8), 'blue')])
    manager, _ = configure_manager(monkeypatch, tmp_path, pipeline)
    monkeypatch.setattr(routes, 'manager', manager)
    monkeypatch.setattr(routes, 'OUTPUT_DIR', tmp_path)
    monkeypatch.setattr(image_store, 'BLOBS_DIR', tmp_path / 'blobs')
    request = routes.ImageGenerationRequest(**generation_options())
    plain = routes._generate_image(request, include_data_url=False)
    assert 'data_url' not in plain and 'inline_encoding' not in plain['stage_seconds']
    inline = routes._generate_image(request)
    assert inline['data_url'].startswith('data:image/png;base64,')
    assert 'inline_encoding' in inline['stage_seconds']
    assert plain['image_ref'] == inline['image_ref']
    assert plain['generation_recipe'] == inline['generation_recipe']


def test_workflow_progress_coalesces_steps_but_keeps_final_and_phase_changes(monkeypatch):
    from services.image_workflows import runner
    clock, writes = [10.0], []
    monkeypatch.setattr(runner.time, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(runner, '_patch', lambda *args, **values: writes.append(values))
    report = runner.progress_writer('workflow', 'job')
    for step in range(10):
        clock[0] += .01
        report(phase='Denoising', step=step + 1, total_steps=10)
    report(phase='Saving')
    assert [value.get('step') for value in writes] == [1, 10, None]


def test_identical_reference_repeats_do_not_activate_base_pipeline(monkeypatch, tmp_path):
    from services import generation_reference
    calls = []
    class Pipeline:
        def __call__(self, **kwargs):
            return SimpleNamespace(images=[kwargs['image']])
        def remove_all_hooks(self): calls.append('detach')
        def to(self, device): calls.append(device)
        def enable_model_cpu_offload(self): calls.append('install')
        def set_progress_bar_config(self, **kwargs): pass
    base, reference = Pipeline(), Pipeline()
    manager, _ = configure_manager(monkeypatch, tmp_path, base)
    manager._pipeline, manager._active_pipeline = base, reference
    monkeypatch.setattr(manager, '_load', lambda _: None)
    monkeypatch.setattr(manager, '_pipeline_for_operation', lambda _: reference)
    monkeypatch.setattr(generation_reference, 'prepare_reference', lambda *args: Image.new('RGB', (8, 8), 'blue'))
    for _ in range(2):
        manager.generate(**generation_options(), source_image_ref='blob:' + 'a' * 64)
    assert calls == []
