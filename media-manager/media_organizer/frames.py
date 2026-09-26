"""Frame counting and extraction using the already-installed FFmpeg toolchain."""
from datetime import datetime
from fractions import Fraction
import json
import math
from pathlib import Path
import subprocess
import tempfile
import threading
import uuid

from . import hashing, manifest, tools
from .media_actions import current_row

INTERVALS = list(range(1, 11)) + list(range(15, 51, 5))
FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def timeline(state, payload, progress, cancel):
    row, source = current_row(state, payload)
    before = source.stat()
    binary = binaries()
    times = []
    def line(value):
        try: value = float(value.split(',')[0])
        except ValueError: return
        if not math.isfinite(value): return
        if times and value <= times[-1]:
            raise ValueError('This video has non-increasing frame timestamps. Time stepping remains available.')
        times.append(value)
        if len(times) > 1_000_000:
            raise ValueError('Frame timing is limited to one million frames per video. Use time stepping for this file.')
        if len(times) % 1000 == 0: progress(phase='reading-frame-timing', completed=len(times))
    progress(phase='reading-frame-timing', currentFile=str(source))
    run_process([binary['ffprobe'], '-v', 'error', '-select_streams', 'v:0', '-show_frames',
                 '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', str(source)], cancel, line)
    if not times: raise ValueError('This video has no readable frame timestamps.')
    if (before.st_size, before.st_mtime_ns) != (source.stat().st_size, source.stat().st_mtime_ns):
        raise ValueError('The video changed while reading frame timing. Reopen it and try again.')
    # Browser media time starts at zero even when the stream uses a nonzero PTS origin.
    start = times[0]
    key = uuid.uuid4().hex
    with state.lock:
        if len(state.frame_timelines) >= 3: state.frame_timelines.pop(next(iter(state.frame_timelines)))
        state.frame_timelines[key] = [round(t-start, 6) for t in times]
    return dict(message=f'Read timing for {len(times):,} frames.', timelineId=key, frameCount=len(times))


def binaries():
    found = {name: tools.find_tool(name) for name in ('ffprobe', 'ffmpeg')}
    for item in found.values():
        if not item.ok: raise ValueError('Frame parsing paused: an existing runnable FFmpeg and ffprobe are required. No dependencies were installed. ' + item.describe())
    return {name: item.path for name, item in found.items()}


def run_process(args, cancel, on_line=None):
    with tempfile.TemporaryFile(mode='w+b') as errors:
        process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=errors,
                                   text=True, encoding='utf-8', errors='replace', creationflags=FLAGS)
        finished = threading.Event()
        def stop():
            while not finished.wait(.2):
                if cancel.is_set():
                    try: process.kill()
                    except OSError: pass
                    return
        watcher = threading.Thread(target=stop, daemon=True); watcher.start()
        output = []
        try:
            for line in process.stdout:
                if on_line: on_line(line.strip())
                else: output.append(line)
            code = process.wait()
            if cancel.is_set(): raise ValueError('Media operation cancelled. The source media is unchanged; any partial output is kept in its new output folder.')
            if code:
                errors.seek(0); detail = errors.read(3000).decode('utf-8', errors='replace')
                raise ValueError('FFmpeg could not finish: ' + detail)
            return ''.join(output)
        finally:
            if process.poll() is None: process.kill(); process.wait()
            finished.set(); watcher.join(); process.stdout.close()


def inspect(state, payload, progress, cancel):
    row, source = current_row(state, payload)
    if row.get('Trashed'): raise ValueError('Restore this video before parsing frames.')
    binary = binaries()
    progress(phase='counting', currentFile=str(source))
    result = run_process([binary['ffprobe'], '-v', 'error', '-select_streams', 'v:0', '-count_frames',
                          '-show_entries', 'stream=width,height,codec_name,avg_frame_rate,r_frame_rate,nb_read_frames,duration:format=duration',
                          '-of', 'json', str(source)], cancel)
    streams = json.loads(result).get('streams', [])
    if not streams: raise ValueError('No readable video stream found.')
    stream = streams[0]
    try: count = int(stream.get('nb_read_frames', 0))
    except (ValueError, TypeError): count = 0
    if count < 1: raise ValueError('The decoder could not count source frames.')
    def rate(value):
        try: return float(Fraction(value))
        except (ValueError, ZeroDivisionError, TypeError): return None
    info = dict(id=uuid.uuid4().hex, runId=payload['runId'], recordId=row['RecordId'], source=str(source),
                sha256=row['SHA256'], size=source.stat().st_size, mtime=source.stat().st_mtime_ns,
                frames=count, fps=rate(stream.get('avg_frame_rate')), nominalFps=rate(stream.get('r_frame_rate')),
                variableFrameRate=row.get('VariableFrameRate'), width=stream.get('width'), height=stream.get('height'),
                codec=stream.get('codec_name'), intervals=INTERVALS)
    with state.lock:
        if len(state.frame_probes) >= 128: state.frame_probes.pop(next(iter(state.frame_probes)))
        state.frame_probes[info['id']] = info
    return {'runId': payload['runId'], 'message': f'Counted {count:,} source frames.', 'frameInfo': info}


def options(info, payload):
    def integer(key, default):
        value = payload.get(key, default)
        if type(value) is not int: raise ValueError(f'{key} must be a whole number.')
        return value
    stride = integer('interval', 15); start = integer('start', 1); end = integer('end', info['frames'])
    if stride not in INTERVALS or not 1 <= start <= end <= info['frames']:
        raise ValueError('Choose a supported interval and frame range within the counted source.')
    format_ = payload.get('format', 'png'); width = integer('width', 0)
    if format_ not in ('png', 'jpg') or width not in (0, 640, 1280, 1920): raise ValueError('Choose a listed format and image size.')
    rotation = integer('rotation', 0)
    if rotation not in (0, 90, 180, 270): raise ValueError('Choose a quarter-turn rotation.')
    destination = Path(str(payload.get('destination', ''))).expanduser()
    if not destination.is_absolute(): raise ValueError('Choose an absolute output folder path.')
    return dict(interval=stride, start=start, end=end, count=(end-start)//stride+1, format=format_, width=width,
                rotation=rotation, destination=str(destination.resolve()))


def extract(state, payload, progress, cancel):
    info = state.frame_probes.get(payload.get('probeId'))
    if not info: raise ValueError('Inspect the video first. Reopen Parse frames after restarting Media Manager.')
    row, source = current_row(state, payload)
    if str(source) != info['source'] or row['SHA256'] != info['sha256'] or source.stat().st_mtime_ns != info['mtime']:
        raise ValueError('The source changed since frame counting. Inspect it again.')
    settings = options(info, payload); binary = binaries()
    progress(phase='verifying', currentFile=str(source))
    sha, _ = hashing.sha256_file(str(source), stop_event=cancel)
    if sha != info['sha256']: raise ValueError('Video content changed since the scan. Re-scan before parsing.')
    parent = Path(settings['destination']); parent.mkdir(parents=True, exist_ok=True)
    output = parent / f"frames_{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:8]}"
    output.mkdir()  # Each run gets a new directory; never overwrite existing outputs.
    record = dict(source=info, settings=settings, status='running', output=str(output), created=datetime.now().isoformat())
    manifest_path = state.run_path(payload['runId']) / 'frame-exports'
    manifest_path.mkdir(parents=True, exist_ok=True)
    summary_path = manifest_path / (output.name + '.json')
    manifest.write_json(str(summary_path), record)
    filters = [f"select=between(n\\,{settings['start']-1}\\,{settings['end']-1})*not(mod(n-{settings['start']-1}\\,{settings['interval']}))"]
    if settings['rotation'] == 90: filters.append('transpose=clock')
    elif settings['rotation'] == 270: filters.append('transpose=cclock')
    elif settings['rotation'] == 180: filters.extend(['hflip', 'vflip'])
    if settings['width']: filters.append(f"scale=min({settings['width']}\\,iw):-2")
    args = [binary['ffmpeg'], '-hide_banner', '-v', 'error', '-nostdin', '-n', '-i', str(source), '-map', '0:v:0',
            '-an', '-sn', '-dn', '-vf', ','.join(filters), '-fps_mode', 'passthrough', '-frames:v', str(settings['count']),
            '-threads', '1', '-progress', 'pipe:1']
    if settings['format'] == 'jpg': args.extend(['-q:v', '2'])
    args.append(str(output / ('frame_%09d.' + settings['format'])))
    progress(phase='extracting', total=settings['count'], currentFile=str(output))
    def line(value):
        if value.startswith('frame='):
            progress(phase='extracting', completed=min(int(value.split('=')[1]), settings['count']), total=settings['count'], currentFile=str(output))
    try:
        run_process(args, cancel, line)
        if source.stat().st_size != info['size'] or source.stat().st_mtime_ns != info['mtime']:
            raise ValueError('The source changed during parsing. Output is marked partial; inspect the video again.')
        count = sum(1 for _ in output.glob('frame_*.' + settings['format']))
        if count != settings['count']: raise ValueError(f'Expected {settings["count"]} images, but decoded {count}. Partial output was retained.')
        record.update(status='complete', count=count)
    except Exception as exc:
        record.update(status='partial', error=str(exc)); raise
    finally:
        # The mapping is exact even for VFR: source frame = start + (output number - 1) * interval.
        record['sourceFrameMapping'] = 'start + (output_number - 1) * interval; frame numbers start at 1'
        manifest.write_json(str(summary_path), record)
    return dict(runId=payload['runId'], message=f'Parsed {count:,} frames into {output}.', frameOutput=record,
                details=f'{count:,} {settings["format"].upper()} images\n{output}\nSource video retained. Frame mapping saved in the internal export report.')
