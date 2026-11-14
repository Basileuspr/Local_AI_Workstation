"""Queued, cancellable Qwen image editing and Wan video through local sd.cpp."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import threading
import time
import uuid

from config import settings
from services.request_queue import queue, prepare_runtime, QueueCancelled
from services.media_progress import RuntimeProgress

CATALOG = json.loads((Path(__file__).resolve().parents[2] / 'scripts/media-model-catalog.json').read_text())
MODELS_DIR = settings.media_models_dir
OUTPUT_DIR = (settings.data_dir / 'generated_media').resolve()


def local_path(relative):
    root = MODELS_DIR.resolve()
    candidate = root / relative
    if candidate.resolve() != candidate or not candidate.resolve().is_relative_to(root):
        raise ValueError('Model path is outside the local model directory or traverses a link.')
    return candidate


def runtime_path():
    return local_path('runtimes/sd-cpp/' + CATALOG['runtime']['release'] + '/sd-cli.exe')


def runtime_ready():
    try:
        root = runtime_path().parent
        manifest = json.loads((root / 'installation-manifest.json').read_text(encoding='utf-8'))
        files = manifest.get('files', {})
        if manifest.get('spec') != CATALOG['runtime'] or 'sd-cli.exe' not in files:
            return False
        for name, asset in files.items():
            path = local_path(root.relative_to(MODELS_DIR.resolve()) / name)
            if not path.is_relative_to(root) or not path.is_file() or path.stat().st_size != asset['size']:
                return False
        return True
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False


def model_files(identifier):
    spec = CATALOG['models'].get(identifier)
    if not spec:
        raise ValueError('Choose a supported installed Qwen or Wan model.')
    manifest_path = local_path('sdcpp/' + identifier + '/installation-manifest.json')
    try:
        manifest = json.loads(manifest_path.read_text())
        # Generation defaults may change without changing any reviewed weight bytes.
        if manifest.get('spec', {}).get('files') != spec['files']:
            raise ValueError('Model revision differs from the reviewed catalog. Run its installer again.')
        files = {}
        for role, asset in spec['files'].items():
            expected = 'sdcpp/shared/' + asset['repo'].replace('/', '--') + '/' + asset['revision'] + '/' + asset['file']
            if manifest.get('files', {}).get(role) != expected:
                raise ValueError('Model file inventory is invalid.')
            path = local_path(expected)
            if not path.is_file() or path.stat().st_size != asset['size']:
                raise ValueError('Model installation is incomplete. Resume its installer.')
            rule = CATALOG.get('preparations', {}).get(identifier, {}).get(role)
            if rule:
                preparation = rule['operation']
                prepared = manifest.get('prepared_files', {}).get(role, {})
                expected = 'sdcpp/prepared/' + asset['sha256'] + '/' + preparation + '.safetensors'
                if (prepared.get('path') != expected or prepared.get('source_sha256') != asset['sha256']
                        or prepared.get('preparation') != preparation or prepared.get('sha256') != rule['sha256']
                        or prepared.get('size') != rule['size']):
                    raise ValueError('Model needs a compatible local copy. Run its installer again.')
                path = local_path(expected)
                if not path.is_file() or path.stat().st_size != prepared.get('size'):
                    raise ValueError('Prepared model is incomplete. Run its installer again.')
            files[role] = path
        return spec, files
    except (OSError, json.JSONDecodeError, TypeError, AttributeError, KeyError) as exc:
        raise ValueError('Model is not installed. Run scripts/install-media-models.py.') from exc


def catalog():
    models = []
    for identifier, spec in CATALOG['models'].items():
        try:
            model_files(identifier)
            require_video_decoder(spec)
            error = None
        except ValueError as exc:
            error = str(exc)
        models.append({key: value for key, value in dict(id=identifier, **spec, ready=error is None, error=error).items() if key != 'files'})
    return {'models': models, 'runtime_ready': runtime_ready(), 'runtime': CATALOG['runtime']['release']}


def require_video_decoder(spec):
    if spec['kind'] == 'video':
        try:
            import av
        except ImportError as exc:
            raise ValueError('Install requirements-audio.txt for local video output validation.') from exc


def validate_request(request):
    spec, _ = model_files(request['model_id'])
    if spec.get('fixed_steps') and request['steps'] != spec['fixed_steps']:
        raise ValueError(f"This model requires exactly {spec['fixed_steps']} steps.")
    require_video_decoder(spec)
    if not runtime_ready():
        raise ValueError('Install the local CUDA runtime with scripts/install-media-models.py --runtime.')
    if not request['prompt'].strip():
        raise ValueError('Enter an image or motion prompt.')
    width, height = request['width'], request['height']
    multiple = 32 if spec['kind'] == 'image' else 16
    if width % multiple or height % multiple or not 128 <= min(width, height) or max(width, height) > 1536:
        raise ValueError(f'Dimensions must be 128–1536 pixels and multiples of {multiple}.')
    if width * height > (1536**2 if spec['kind'] == 'image' else 832*832):
        raise ValueError('Choose smaller dimensions for this local video workflow.')
    references = request.get('references', [])
    maximum = 4 if spec['kind'] == 'image' else 1
    if len(references) > maximum or (spec['reference_mode'] == 'required' and not references):
        raise ValueError(f'This model needs {"one" if spec["reference_mode"] == "required" else "at most " + str(maximum)} reference image(s).')
    if spec['kind'] == 'video':
        multiple = 8 if spec['family'] == 'wan2.2-5b' else 4
        if (request['frames'] - 1) % multiple:
            raise ValueError(f'Use a frame count of {multiple}n + 1 for this model.')
    from services.generation_reference import reference_bytes
    for reference in references:
        reference_bytes(reference)
    return spec


def command(request, output, references):
    spec, files = model_files(request['model_id'])
    args = [str(runtime_path()), '-M', 'img_gen' if spec['kind'] == 'image' else 'vid_gen',
            '--diffusion-model', str(files['diffusion']), '--vae', str(files['vae']),
            '-p', request['prompt'], '-n', request.get('negative_prompt', ''),
            '-W', str(request['width']), '-H', str(request['height']), '--steps', str(request['steps']),
            '--cfg-scale', str(request['guidance']), '--seed', str(request['seed']),
            '--sampling-method', 'euler', '--mmap', '--auto-fit', 'on', '--max-vram', '6',
            '--disable-prefetch', '--batched-cfg', 'off', '--vae-tiling', '--disable-image-metadata', '-o', str(output)]
    if spec.get('sigmas'):
        args += ['--sigmas', spec['sigmas']]
    if spec['kind'] == 'image':
        args += ['--llm', str(files['llm']), '--llm_vision', str(files['vision']),
                 '--model-args', 'qwen_image_2_1_prefix_cache_type=q4_0']
        for reference in references:
            args += ['-r', str(reference)]
    else:
        args += ['--t5xxl', str(files['t5']), '--video-frames', str(request['frames']), '--fps', str(request['fps']),
                 '--flow-shift', str(spec.get('flow_shift', 3)), '--temporal-tiling']
        if spec.get('scheduler'):
            args += ['--scheduler', spec['scheduler']]
        if references:
            args += ['-i', str(references[0])]
        if 'high_noise' in files:
            args += ['--high-noise-diffusion-model', str(files['high_noise']),
                     '--high-noise-steps', str(request['steps']), '--high-noise-cfg-scale', str(request['guidance'])]
    return args


def run_process(args, directory, cancel, progress):
    """Never invoke a shell; drain output concurrently so Stop works during loading."""
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    process = subprocess.Popen(args, cwd=directory, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               stdin=subprocess.DEVNULL, text=True, encoding='utf-8', errors='replace',
                               creationflags=creationflags)
    tail = []
    reporter = RuntimeProgress(args, progress)
    def read_output():
        # Private, bounded diagnostics beside the private job recipe; never published.
        with (directory / 'runtime.log').open('w', encoding='utf-8', newline='') as log:
            written = 0
            for line in iter(lambda: process.stdout.readline(8192), ''):
                if written < 5 * 1024**2:
                    chunk = line.encode('utf-8')[:5 * 1024**2 - written].decode('utf-8', errors='ignore')
                    log.write(chunk); log.flush(); written += len(chunk.encode('utf-8'))
                tail.append(line[-1200:]); del tail[:-12]
                reporter.feed(line)
    reader = threading.Thread(target=read_output, daemon=True); reader.start()
    try:
        while process.poll() is None:
            if cancel.wait(.2):
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
                raise QueueCancelled('Generation stopped.')
        reader.join(timeout=5)
        if cancel.is_set():
            raise QueueCancelled('Generation stopped.')
        if process.returncode:
            # Raw output may echo prompts and paths. Keep the public error bounded and generic.
            memory = any('memory' in line.lower() or 'alloc' in line.lower() for line in tail)
            raise RuntimeError('Local generation ran out of memory.' if memory else f'Local generation failed (runtime exit {process.returncode}).')
    finally:
        if process.poll() is None:
            process.kill(); process.wait()
        reader.join(timeout=5)
        process.stdout.close()


def generate(request, directory, cancel, progress):
    from services.generation_reference import reference_bytes
    from services.upload_images import open_upload_image
    import io
    spec = validate_request(request)
    references = []
    try:
        for index, reference in enumerate(request.get('references', [])):
            # Recheck access immediately before use, including references locked while queued.
            with open_upload_image(io.BytesIO(reference_bytes(reference))) as image:
                from PIL import ImageOps
                image = ImageOps.exif_transpose(image).convert('RGB')
                image.thumbnail((request['width'], request['height']))
                path = directory / f'reference-{index}.png'; image.save(path); image.close()
                references.append(path)
        output = directory / ('output.png' if spec['kind'] == 'image' else 'output.webm')
        progress('Loading model; disk offloading may take several minutes', None, None)
        run_process(command(request, output, references), directory, cancel, progress)
        if not output.is_file() or not output.stat().st_size:
            raise RuntimeError('The runtime exited without a complete output.')
        progress('Validating output', None, None)
        if spec['kind'] == 'image':
            from PIL import Image
            with Image.open(output) as image:
                image.verify()
        else:
            from services.local_video import decoder
            with decoder(output) as (media, stream):
                if next(media.decode(stream), None) is None:
                    raise RuntimeError('Generated video has no decodable frames.')
        return output.name
    finally:
        for reference in references:
            reference.unlink(missing_ok=True)


class MediaJobs:
    def __init__(self):
        self.jobs = {}; self.tasks = {}; self.lock = threading.RLock(); self.loaded = False
        self.gallery_lock = threading.Lock()

    def load(self):
        with self.lock:
            if self.loaded: return
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            for path in OUTPUT_DIR.glob('*/job.json'):
                try:
                    item = json.loads(path.read_text(encoding='utf-8'))
                    if not isinstance(item, dict) or not isinstance(item.get('id'), str): continue
                    if item.get('id') != path.parent.name or not re.fullmatch('[a-f0-9]{32}', item['id']): continue
                    if not isinstance(item.get('created_at'), (int, float)): continue
                    if not isinstance(item.get('request'), dict) or not isinstance(item['request'].get('prompt'), str): continue
                    if item.get('kind') not in {'image', 'video'}: continue
                    if item['status'] in {'queued', 'running', 'cancelling'}:
                        item.update(status='failed', phase='Interrupted', error='Backend stopped before generation finished.')
                    self.jobs[item['id']] = item
                except (ValueError, OSError, KeyError): continue
            self.loaded = True

    def save(self, item):
        path = OUTPUT_DIR / item['id'] / 'job.json'
        temp = path.with_suffix('.part'); temp.write_text(json.dumps(item), encoding='utf-8'); temp.replace(path)

    def sync_gallery(self):
        """Import completed stills once, including history from before Gallery integration.

        The library atomically records each import and retains its receipt after
        deletion, so later refreshes cannot resurrect a removed copy.
        Videos and unfinished outputs remain in generation history.
        """
        from datetime import datetime, timezone
        from services import image_library as library, image_vault as vault
        self.load()
        warnings = []
        with self.gallery_lock:
            with library.LOCK:
                imported = set(library.read_index().get('media_imports', {}))
            with self.lock:
                candidates = [dict(item) for item in self.jobs.values()
                              if item['status'] == 'completed' and item['kind'] == 'image'
                              and item['id'] not in imported]
            for item in candidates:
                try:
                    path = output_path(item)
                    name = f'{item.get("name") or "Generated image"} - {item["id"][:8]}.png'
                    metadata = library.inspect_file(path, name)
                    metadata['created_at'] = datetime.fromtimestamp(item['created_at'], timezone.utc).isoformat()
                    seed = item['request'].get('seed')
                    if isinstance(seed, int) and not isinstance(seed, bool) and 0 <= seed <= 2**31 - 1:
                        metadata['seed'] = seed
                    origin = {'kind': 'media-generation', 'job_id': item['id'], 'model_id': item.get('model_id')}
                    with library.LOCK:
                        # Filing/restoring/deleting may have changed the catalog
                        # while we inspected bytes. Recheck before committing.
                        if item['id'] not in library.read_index().get('media_imports', {}):
                            library._import_file(path, metadata, origin)
                except vault.LockedImageError:
                    # Locking is intentional; restoring in Locked Images makes
                    # the existing hash available again without exposing it here.
                    continue
                except (OSError, ValueError, KeyError, TypeError, OverflowError):
                    warnings.append(f'Generated image {item["id"][:8]} could not be added to Gallery. Its source was preserved; refresh to retry.')
        return warnings

    def progress(self, identifier):
        with self.lock:
            item = self.jobs.get(identifier)
            return self._progress(item, time.time()) if item else None

    @staticmethod
    def _progress(item, now):
        end = item.get('finished_at') or (now if item['status'] in {'queued', 'running', 'cancelling'} else None)
        start = item.get('started_at')
        step, total = item.get('step') or 0, item.get('total_steps') or 0
        rate = item.get('seconds_per_step')
        remaining = rate * (total - step) if rate and step < total and item.get('phase') == 'Generating' and item['status'] == 'running' else None
        return {'phase': item.get('phase'), 'detail': item.get('detail', ''), 'step': step, 'total_steps': total,
                'elapsed_seconds': max(0, end - start) if start and end else None,
                'waiting_seconds': max(0, (start or end) - item['created_at']) if start or end else None,
                'estimated_remaining_seconds': remaining,
                'last_activity_seconds': max(0, end - item['updated_at']) if end and item.get('updated_at') else None}

    def snapshots(self):
        self.load()
        queued = {job['request_id']: job for job in queue.snapshot()['jobs'] if job['kind'] == 'media-generation'}
        with self.lock:
            return [dict(item, status='cancelling' if queued.get(item['id'], {}).get('status') == 'cancelling' else item['status'],
                         position=queued.get(item['id'], {}).get('position'), progress=self._progress(item, time.time()),
                         url=f'/media-generation/jobs/{item["id"]}/output' if item['status'] == 'completed' and item.get('output') else None)
                    for item in sorted(self.jobs.values(), key=lambda item: item['created_at'], reverse=True)[:100]]

    async def submit(self, request):
        self.load(); spec = await asyncio.to_thread(validate_request, request)
        identifier = uuid.uuid4().hex
        request = dict(request, seed=request['seed'] if request.get('seed') is not None else secrets.randbelow(2**31))
        directory = OUTPUT_DIR / identifier; directory.mkdir()
        item = {'id': identifier, 'model_id': request['model_id'], 'name': spec['name'], 'kind': spec['kind'],
                'status': 'queued', 'created_at': time.time(), 'request': request, 'phase': 'Queued', 'error': None}
        profile = ':'.join(str(request.get(key)) for key in ('model_id', 'width', 'height', 'frames', 'steps', 'guidance'))
        profile += f":refs={len(request.get('references', []))}"
        job = queue.enqueue('media-generation', spec['name'], request_id=identifier, model=request['model_id'], timing_profile=profile)
        try:
            with self.lock:
                self.jobs[identifier] = item; self.save(item)
        except Exception:
            self.jobs.pop(identifier, None)
            queue.finish(job, 'Could not save the generation request.')
            raise
        self.tasks[identifier] = asyncio.create_task(self.execute(job, item, directory))
        return identifier

    async def execute(self, job, item, directory):
        failure = None
        def progress(phase, step, total, **detail):
            with self.lock:
                if phase != item.get('phase'):
                    item.pop('seconds_per_step', None)
                item.update(phase=phase, updated_at=time.time(), detail=detail.pop('detail', ''), **detail)
                if step is not None: item['step'] = step
                if total is not None: item['total_steps'] = total
            queue.set_stage(job, phase, item.get('detail'))
        try:
            await queue.wait(job)
            with self.lock: item.update(status='running', started_at=time.time()); self.save(item)
            progress('Preparing GPU; releasing other models', None, None)
            await prepare_runtime('media-generation')
            from services.image_generation import manager
            await asyncio.to_thread(manager.unload_for_training)
            if job.cancel_event.is_set(): raise QueueCancelled('Generation stopped.')
            worker = asyncio.create_task(asyncio.to_thread(generate, item['request'], directory, job.cancel_event, progress))
            try:
                output = await asyncio.shield(worker)
            except asyncio.CancelledError:
                job.cancel_event.set()
                # Keep the GPU reservation until the subprocess has actually exited.
                await asyncio.gather(worker, return_exceptions=True)
                raise
            if job.cancel_event.is_set(): raise QueueCancelled('Generation stopped.')
            with self.lock: item.update(status='completed', phase='Complete', output=output)
        except (QueueCancelled, asyncio.CancelledError):
            job.cancel_event.set(); item.update(status='cancelled', phase='Stopped'); failure = 'Generation stopped.'
        except Exception as exc:
            failure = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else type(exc).__name__
            item.update(status='failed', phase='Failed', error=failure)
        finally:
            try:
                with self.lock:
                    item['finished_at'] = time.time(); self.save(item)
            finally:
                queue.finish(job, failure)
                self.tasks.pop(item['id'], None)

    async def cancel(self, identifier):
        self.load(); job = queue.find(kind='media-generation', request_id=identifier)
        if job:
            await queue.cancel(job)
            with self.lock:
                item = self.jobs[identifier]
                if item['status'] in {'queued', 'running'}: item['status'] = 'cancelling'

    async def shutdown(self):
        for identifier in list(self.tasks): await self.cancel(identifier)
        if self.tasks: await asyncio.gather(*list(self.tasks.values()), return_exceptions=True)


def output_path(item):
    if (item.get('status') != 'completed' or not re.fullmatch('[a-f0-9]{32}', item.get('id', ''))
            or item.get('output') != {'image': 'output.png', 'video': 'output.webm'}.get(item.get('kind'))):
        raise ValueError('Completed output not found.')
    path = OUTPUT_DIR / item['id'] / item['output']
    if not path.is_file() or path.resolve() != path or not path.is_relative_to(OUTPUT_DIR):
        raise ValueError('Output file is missing.')
    if item['kind'] == 'image':
        from services.image_vault import guard_path
        guard_path(path)
    return path


jobs = MediaJobs()
