"""Local speaker turns, model setup, and alignment to transcription words."""
from __future__ import annotations

import importlib.util
import json
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time

from config import settings

MODEL_DIR = settings.models_dir / 'audio' / 'speakers'
SEGMENTATION = 'segmentation.onnx'
EMBEDDING = 'nemo_en_titanet_large.onnx'
SEGMENTATION_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'
EMBEDDING_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/' + EMBEDDING


class SpeakerError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def status():
    installed = importlib.util.find_spec('sherpa_onnx') is not None
    ready = all((MODEL_DIR / name).is_file() for name in (SEGMENTATION, EMBEDDING))
    return {'installed': installed, 'model_ready': ready, 'ready': installed and ready,
            'model': 'TitaNet Large', 'download_mb': 110}


def _engine(directory, speakers=0, threads=2):
    try:
        import sherpa_onnx as so
    except (ImportError, OSError) as exc:
        raise SpeakerError('Install requirements-audio.txt with the app Python, then restart to enable speaker separation.') from exc
    config = so.OfflineSpeakerDiarizationConfig(
        segmentation=so.OfflineSpeakerSegmentationModelConfig(
            pyannote=so.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(directory / SEGMENTATION)),
            num_threads=threads, provider='cpu'),
        embedding=so.SpeakerEmbeddingExtractorConfig(model=str(directory / EMBEDDING), num_threads=threads, provider='cpu'),
        clustering=so.FastClusteringConfig(num_clusters=speakers if speakers else -1, threshold=0.5),
        min_duration_on=0.3, min_duration_off=0.2,
    )
    if not config.validate():
        raise SpeakerError('Speaker model files are unavailable. Run speaker model setup in Audio.')
    return so.OfflineSpeakerDiarization(config)


def _download(url, destination, limit):
    import httpx
    size = 0
    with httpx.Client(follow_redirects=True, trust_env=False, timeout=60) as client:
        with client.stream('GET', url) as response, destination.open('wb') as handle:
            response.raise_for_status()
            for block in response.iter_bytes():
                size += len(block)
                if size > limit:
                    raise SpeakerError('Speaker model download exceeded its expected size. Please retry setup.')
                handle.write(block)
    if not size:
        raise SpeakerError('The speaker model download was empty. Please retry setup.')


def setup():
    if not status()['installed']:
        raise SpeakerError('Install requirements-audio.txt with the app Python, then restart to enable speaker separation.')
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix='.setup-', dir=MODEL_DIR) as work:
            work = Path(work)
            archive = work / 'segmentation.tar.bz2'
            _download(SEGMENTATION_URL, archive, 12 * 1024 * 1024)
            with tarfile.open(archive, 'r:bz2') as source:
                # Extract only exact known files, never archive-selected paths.
                for original, target, maximum in [('model.onnx', SEGMENTATION, 8 * 1024 * 1024), ('LICENSE', 'SEGMENTATION-LICENSE', 20000)]:
                    member = source.getmember('sherpa-onnx-pyannote-segmentation-3-0/' + original)
                    if not member.isfile() or member.size > maximum:
                        raise SpeakerError('The speaker model archive is invalid.')
                    with source.extractfile(member) as incoming, (work / target).open('wb') as outgoing:
                        shutil.copyfileobj(incoming, outgoing)
            _download(EMBEDDING_URL, work / EMBEDDING, 120 * 1024 * 1024)
            engine = _engine(work)
            del engine
            for name in (SEGMENTATION, EMBEDDING, 'SEGMENTATION-LICENSE'):
                os.replace(work / name, MODEL_DIR / name)
    except SpeakerError:
        raise
    except Exception as exc:
        raise SpeakerError('Speaker model setup failed. Check your connection and disk space, then retry.') from exc
    return status()


def run(pcm_path, speakers, progress, threads=2):
    """Isolate native inference so API status remains responsive on Windows."""
    if not status()['ready']:
        raise SpeakerError('Set up speaker separation in the Audio workspace first.')
    directory = Path(pcm_path).parent
    output, report = directory / 'speakers.json', directory / 'speaker-progress.json'
    command = [sys.executable, str(Path(__file__).with_name('speaker_worker.py')),
               str(MODEL_DIR), str(pcm_path), str(output), str(report), str(speakers), str(threads)]
    errors = directory / 'worker-errors.txt'
    error_file = errors.open('wb')
    try:
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=error_file, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except OSError as exc:
        error_file.close()
        raise SpeakerError('Could not start local speaker analysis. Try again after restarting the app.', 500) from exc
    try:
        deadline = time.monotonic() + 3600
        while process.poll() is None:
            if time.monotonic() > deadline:
                raise SpeakerError('Speaker separation timed out. Try a shorter recording.', 504)
            try:
                value = json.loads(report.read_text(encoding='utf-8'))
                progress(float(value['fraction']))
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(0.3)
        if process.returncode or not output.is_file():
            error_file.close()
            logging.getLogger(__name__).warning('Speaker worker exited %s: %s', process.returncode,
                errors.read_text(encoding='utf-8', errors='replace')[-4000:])
            raise SpeakerError('Speaker separation failed. Try again or turn off Separate speakers.', 500)
        return json.loads(output.read_text(encoding='utf-8'))
    finally:
        if process.poll() is None:
            # A Windows venv launcher may own a second Python process. Stop
            # that owned process tree too so a timeout cannot strand inference.
            import psutil
            try:
                children = psutil.Process(process.pid).children(recursive=True)
            except psutil.NoSuchProcess:
                children = []
            for child in reversed(children):
                try:
                    child.kill()
                except psutil.NoSuchProcess:
                    pass
            process.kill()
            psutil.wait_procs(children, timeout=5)
        process.wait()
        error_file.close()


def assign_speakers(rows, turns):
    """Align each word by temporal overlap. No acoustic evidence => Unknown."""
    ordered = sorted(turns, key=lambda item: (item['start'], item['end']))
    names = {}
    for turn in ordered:
        raw = turn['speaker']
        names.setdefault(raw, f'Speaker {len(names) + 1}')
    result, cursor = [], 0
    for row in rows:
        words = row.get('words') or [{'start': row['start'], 'end': row['end'], 'text': ' ' + row['text']}]
        for word in words:
            start, end = word['start'], word['end']
            middle = (start + end) / 2
            while cursor < len(ordered) and ordered[cursor]['end'] < start - 0.25:
                cursor += 1
            evidence, matching = {}, []
            for index in range(cursor, len(ordered)):
                turn = ordered[index]
                if turn['start'] > end + 0.25:
                    break
                overlap = max(0, min(end, turn['end']) - max(start, turn['start']))
                if start == end and turn['start'] <= middle <= turn['end']:
                    overlap = 0.01
                if overlap:
                    label = names[turn['speaker']]
                    evidence[label] = evidence.get(label, 0) + overlap
                    matching.append((index, turn, overlap))
            ranked = sorted(evidence.items(), key=lambda item: -item[1])
            speaker = ranked[0][0] if ranked else 'Unknown speaker'
            # A word straddling a handoff is not simultaneous speech. Require
            # actual concurrent acoustic turns before labeling it overlapping.
            concurrent = any(
                left['speaker'] != right['speaker'] and
                min(end, left['end'], right['end']) > max(start, left['start'], right['start'])
                for i, (_, left, _) in enumerate(matching) for _, right, _ in matching[i + 1:]
            )
            ambiguous = concurrent and len(ranked) > 1 and ranked[1][1] >= ranked[0][1] * 0.65
            if ambiguous:
                speaker = 'Unclear / overlapping'
            # Preserve detector boundaries even if a brief intervening voice
            # was missed by ASR. Do not merge back across that speaker's turn.
            boundary = max(matching, key=lambda item: item[2])[0] if matching else None
            # Adjacent words from the same voice form readable speaker turns.
            if result and result[-1]['speaker'] == speaker and result[-1]['_boundary'] == boundary and start - result[-1]['end'] <= 1.5:
                result[-1]['text'] += word['text']
                result[-1]['end'] = max(result[-1]['end'], end)
            else:
                result.append({'start':start, 'end':end, 'speaker':speaker, 'text':word['text'], '_boundary':boundary})
    for turn in result:
        turn['text'] = turn['text'].strip()
        turn.pop('_boundary')
    return result, list(names.values())
