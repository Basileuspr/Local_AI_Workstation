import asyncio
import sys
import threading

import pytest

from services.media_progress import RuntimeProgress
from services import media_generation as media
from services.request_queue import RequestQueue
from services.request_queue import QueueCancelled
from services.gpu_coordination import GpuCoordinator


def reporter(steps=20, experts=1):
    events = []
    args = ['--steps', str(steps)] + (['--high-noise-diffusion-model', 'fixture'] if experts == 2 else [])
    parser = RuntimeProgress(args, lambda phase, step, total, **data: events.append(dict(phase=phase, step=step, total=total, **data)))
    return parser, events


def test_video_progress_counts_both_experts_and_ignores_tensor_and_vae_bars():
    parser, events = reporter(20, 2)
    parser.feed('[I] using VAE for encoding / decoding')
    parser.feed('[I] sampling using Euler method')
    parser.feed('|====| 1/20 - 1.20it/s')  # VAE can coincidentally have the same number of tiles.
    assert not events
    parser.feed('[I] generate_video 512x512x17')
    parser.feed('|====| 20/20 - 4.5MB/s')
    assert events[-1]['step'] == 0
    parser.feed('|====| 1/20 - 12.5s/it - ETA 03:58\x1b[K')
    assert events[-1] == dict(phase='Generating', step=1, total=40, seconds_per_step=12.5, detail='Expert 1 of 2')
    parser.feed('|====| 20/20 - 12.0s/it')
    parser.feed('[I] sampling(high noise) completed, taking 250s')
    assert events[-1]['step'] == 20
    parser.feed('|====| 1/20 - 0.08it/s')
    assert events[-1]['step'] == 21 and events[-1]['seconds_per_step'] == 12.5
    parser.feed('|====| 20/20 - 12.5s/it')
    parser.feed('[I] generating latent video completed, taking 500s')
    parser.feed('|====| 1/20 - 1.00s/it')
    assert events[-1]['phase'] == 'Decoding output' and events[-1]['step'] == 40
    parser.feed('[I] decode_first_stage completed, taking 10s')
    assert events[-1]['phase'] == 'Saving output'


def test_preparation_reports_activity_without_private_diagnostics():
    parser, events = reporter()
    parser.feed('[I] wan_vae build cached graph cut plan done')
    assert events[-1]['phase'] == 'Encoding reference'
    parser.feed('[I] encode_first_stage completed')
    parser.feed('[I] memory-mapped 30 tensors in PRIVATE_PATH')
    assert events[-1]['phase'] == 'Encoding prompt'
    assert 'PRIVATE' not in str(events)
    assert 'offloading' in events[-1]['detail']


def test_image_decode_tiles_do_not_become_additional_generation_steps():
    parser, events = reporter(8)
    parser.feed('[I] generate_image 512x512')
    parser.feed('|====| 8/8 - 1.2s/it')
    parser.feed('[I] generating 1 latent images completed, taking 9s')
    parser.feed('|====| 1/8 - 1.2s/it')
    assert events[-1]['phase'] == 'Decoding output' and events[-1]['step'] == 8


def test_process_reports_steps_before_exit_and_remains_cancellable(tmp_path):
    cancel = threading.Event(); events = []
    def report(phase, step, total, **detail):
        events.append((phase, step, total))
        if step == 1: cancel.set()
    script = "import time; print('[I] generate_video 512x512x17', flush=True); print('|====| 1/20 - 2.0s/it', flush=True); time.sleep(30)"
    with pytest.raises(QueueCancelled):
        media.run_process([sys.executable, '-c', script, '--steps', '20'], tmp_path, cancel, report)
    assert ('Generating', 1, 20) in events


def test_media_clock_and_estimate_exclude_preparation_and_freeze_at_completion():
    item = dict(status='running', phase='Generating', created_at=10, started_at=20, updated_at=100,
                step=2, total_steps=40, seconds_per_step=5)
    progress = media.MediaJobs._progress(item, 110)
    assert progress['elapsed_seconds'] == 90
    assert progress['waiting_seconds'] == 10
    assert progress['estimated_remaining_seconds'] == 190
    assert progress['last_activity_seconds'] == 10
    for phase in ['Loading model', 'Decoding output', 'Saving output']:
        assert media.MediaJobs._progress(dict(item, phase=phase), 110)['estimated_remaining_seconds'] is None
    assert media.MediaJobs._progress(dict(item, status='cancelling'), 110)['estimated_remaining_seconds'] is None
    finished = media.MediaJobs._progress(dict(item, status='completed', finished_at=120), 500)
    assert finished['elapsed_seconds'] == 100 and finished['estimated_remaining_seconds'] is None
    assert media.MediaJobs._progress(dict(item, status='failed'), 500)['elapsed_seconds'] is None


def test_media_queue_and_history_share_progress_and_external_cancellation(tmp_path, monkeypatch):
    from routes import request_queue as route
    task_queue = RequestQueue(GpuCoordinator())
    manager = media.MediaJobs(); manager.loaded = True
    monkeypatch.setattr(media, 'OUTPUT_DIR', tmp_path)
    monkeypatch.setattr(media, 'queue', task_queue)
    monkeypatch.setattr(media, 'jobs', manager)
    monkeypatch.setattr(route, 'queue', task_queue)
    job = task_queue.enqueue('media-generation', 'Wan', request_id='fixture')
    task_queue.try_start(job)
    manager.jobs['fixture'] = dict(id='fixture', status='running', phase='Generating', created_at=1,
                                   started_at=2, step=3, total_steps=40, seconds_per_step=4)
    result = asyncio.run(route.list_queue())
    assert result['jobs'][0]['progress']['estimated_remaining_seconds'] == 148
    asyncio.run(task_queue.cancel(job))
    assert manager.snapshots()[0]['status'] == 'cancelling'
    assert task_queue.coordinator.current_owner() is not None


def test_runtime_reset_counts_video_requests_and_waits_for_worker_release(monkeypatch):
    import main
    from services import gpu_coordination
    task_queue = RequestQueue(GpuCoordinator())
    monkeypatch.setattr(main, 'queue', task_queue)
    monkeypatch.setattr(gpu_coordination, 'gpu_coordinator', task_queue.coordinator)
    async def scenario():
        running = task_queue.enqueue('media-generation', 'Running video')
        task_queue.try_start(running)
        task_queue.enqueue('media-generation', 'Queued video')
        async def cleanup():
            while not running.cancel_event.is_set(): await asyncio.sleep(.01)
            assert task_queue.paused
            await asyncio.sleep(.01)
            task_queue.finish(running)
        async def unload():
            assert task_queue.coordinator.current_owner() is None
            return {'reset': True}
        monkeypatch.setattr(main, '_reset_runtime', unload)
        worker = asyncio.create_task(cleanup())
        result = await main.reset_runtime()
        await worker
        assert result['queue_requests_stopped'] == 2 and result['reset']
        assert not task_queue.paused
    asyncio.run(scenario())
