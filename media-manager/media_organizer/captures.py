"""User-requested snapshots and trimmed video copies, separate from source media."""
import base64
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import struct
import uuid

from . import frames, manifest, folder_browser
from .media_actions import current_row


def folder(state, kind):
    if kind not in ('snapshot', 'clip'): raise ValueError('Choose snapshots or clips.')
    path = folder_browser.media_root(state.reports) / ('Snapshots' if kind == 'snapshot' else 'Clips')
    path.mkdir(parents=True, exist_ok=True)
    return path


def records(state):
    path = state.reports / 'captures.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else []


def gallery(state, kind):
    directory = folder(state, kind)
    return dict(folder=str(directory), records=[dict(r, available=Path(r['path']).is_file())
        for r in reversed(records(state)) if r['kind'] == kind])


def media_path(state, id):
    if not re.fullmatch(r'[a-f0-9]{32}', str(id or '')): raise ValueError('Unknown capture.')
    row = next((r for r in records(state) if r['id'] == id), None)
    if not row: raise ValueError('Unknown capture.')
    path = Path(row['path'])
    if not path.is_file(): raise ValueError('This capture has moved or is unavailable.')
    return path


def execute(state, payload, progress, cancel, kind):
    row, source = current_row(state, payload)
    if row.get('Trashed'): raise ValueError('Restore this video before capturing media.')
    before = source.stat()
    binary = frames.binaries()
    id = uuid.uuid4().hex
    stamp = datetime.now(timezone.utc).isoformat()
    parent = folder(state, kind)
    if kind == 'clip' and payload.get('destination'):
        parent = Path(str(payload['destination'])).expanduser()
        if not parent.is_absolute() or not parent.is_dir(): raise ValueError('Choose an existing output folder.')
        parent = parent.resolve()
    target = parent / f"{kind}_{datetime.now():%Y%m%d_%H%M%S}_{id[:10]}.{ 'png' if kind == 'snapshot' else 'mp4'}"
    record = dict(id=id, kind=kind, path=str(target), created=stamp, source=str(source), sourceSha256=row['SHA256'],
                  sourceName=row['OriginalFilename'], sourceDate=row.get('ResolvedDate'), rotation=payload.get('rotation', 0))
    progress(phase='processing', completed=0, total=1, currentFile=str(target))
    if kind == 'snapshot':
        time = payload.get('time')
        if not isinstance(time, (int, float)) or not math.isfinite(time) or time < 0: raise ValueError('Choose a loaded video frame.')
        encoded = payload.get('png', '')
        if not isinstance(encoded, str) or not encoded.startswith('data:image/png;base64,'): raise ValueError('Snapshot must be a PNG frame.')
        try: raw = base64.b64decode(encoded.split(',', 1)[1], validate=True)
        except ValueError: raise ValueError('Could not read the snapshot image.')
        if len(raw) < 33 or raw[:8] != b'\x89PNG\r\n\x1a\n' or raw[12:16] != b'IHDR': raise ValueError('Invalid PNG snapshot.')
        width, height = struct.unpack('>II', raw[16:24])
        if not width or not height or width*height > 24_000_000 or len(raw) > 48*1024**2: raise ValueError('Snapshots support up to 24 megapixels and 48 MiB.')
        temporary = target.with_suffix('.input.png')
        try:
            with temporary.open('xb') as stream: stream.write(raw)
            frames.run_process([binary['ffmpeg'], '-v', 'error', '-nostdin', '-n', '-i', str(temporary), '-frames:v', '1', '-threads', '1', str(target)], cancel)
        finally: temporary.unlink(missing_ok=True)
        record.update(time=time, width=width, height=height)
    else:
        start, end = payload.get('start'), payload.get('end')
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in (start, end)):
            raise ValueError('Enter finite start and end times in seconds.')
        probe = json.loads(frames.run_process([binary['ffprobe'], '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(source)], cancel))
        duration = float(probe.get('format', {}).get('duration', 0))
        if not 0 <= start < end <= duration + .001: raise ValueError('Choose a start before the end, within the video duration.')
        rotation = payload.get('rotation', 0)
        if type(rotation) is not int or rotation not in (0, 90, 180, 270): raise ValueError('Choose a valid rotation.')
        filters = {0:[], 90:['transpose=clock'], 180:['hflip','vflip'], 270:['transpose=cclock']}[rotation]
        filters.append('pad=ceil(iw/2)*2:ceil(ih/2)*2')
        args = [binary['ffmpeg'], '-hide_banner', '-v', 'error', '-nostdin', '-n', '-ss', str(start), '-i', str(source),
                '-t', str(end-start), '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '0', '-vf', ','.join(filters),
                '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                '-metadata:s:v:0', 'rotate=0', '-movflags', '+faststart', '-threads', '2', '-progress', 'pipe:1', str(target)]
        total = round((end-start)*1000)
        def line(value):
            if value.startswith('out_time_us='):
                try: completed = min(total, max(0, int(value.split('=')[1])//1000))
                except ValueError: return
                progress(phase='processing', completed=completed, total=total, currentFile=str(target))
        frames.run_process(args, cancel, line)
        record.update(start=start, end=end)
    if (before.st_size, before.st_mtime_ns) != (source.stat().st_size, source.stat().st_mtime_ns):
        raise ValueError('The source changed during capture. The output was retained but was not added to the gallery.')
    if not target.is_file() or not target.stat().st_size: raise ValueError('No output was created.')
    with state.lock:
        saved = records(state);saved.append(record)
        manifest.write_json(str(state.reports/'captures.json'), saved)
    # Provenance is retained in the internal captures index, not beside outputs.
    progress(phase='processing', completed=1, total=1, currentFile=str(target))
    return dict(message='Snapshot saved.' if kind == 'snapshot' else 'Clip saved. Source video unchanged.', capture=record)
