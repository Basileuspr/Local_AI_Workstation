"""Opt-in local ASR benchmark on fixed public LibriSpeech excerpts.

Downloads only the selected clips; never uploads local recordings. Results are
kept under ignored tmp/audio-bench, not application/user data.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


def words(text):
    text = text.lower().replace('mr.', 'mister').replace('mrs.', 'misses')
    return re.sub(r"[^a-z0-9' ]", ' ', text).split()


def edit_distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, actual in enumerate(reference, 1):
        current = [i]
        for j, predicted in enumerate(hypothesis, 1):
            current.append(min(current[-1]+1, previous[j]+1, previous[j-1]+(actual != predicted)))
        previous = current
    return previous[-1]


def prepare(directory, clips_per_selection):
    import httpx
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / 'manifest.json'
    if manifest.exists():
        return json.loads(manifest.read_text(encoding='utf-8'))
    def fetch(selection):
        config, offset = selection
        with httpx.Client(follow_redirects=True, timeout=60) as client:
            response = client.get('https://datasets-server.huggingface.co/rows', params={
                'dataset':'openslr/librispeech_asr', 'config':config, 'split':'test', 'offset':offset, 'length':clips_per_selection})
            response.raise_for_status()
            result = []
            for item in response.json()['rows']:
                row = item['row']
                name = f"{config}-{item['row_idx']}.flac"
                sound = client.get(row['audio'][0]['src']); sound.raise_for_status()
                (directory / name).write_bytes(sound.content)
                result.append({'file':name,'reference':row['text'],'speaker':row['speaker_id'],
                               'row':item['row_idx'],'config':config})
            return result
    selections = [(config, offset) for config in ('clean','other') for offset in (0,100,500,1000)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        entries = [item for group in pool.map(fetch, selections) for item in group]
    manifest.write_text(json.dumps(entries,indent=2),encoding='utf-8')
    return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['small','turbo'],default='small')
    parser.add_argument('--device', choices=['cpu','cuda'],default='cpu')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--clips-per-selection', type=int, default=8, choices=range(1,21))
    args = parser.parse_args()
    directory = ROOT / f'tmp/audio-bench/reference-{args.clips_per_selection * 8}'
    entries = prepare(directory, args.clips_per_selection)
    if args.prepare:
        print(json.dumps({'clips':len(entries),'speakers':sorted({e['speaker'] for e in entries})}));return
    if args.device == 'cuda':
        import torch  # Load this installation's CUDA libraries on Windows.
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio
    model = WhisperModel(str(ROOT/'models/audio'/('whisper-'+args.model)), device=args.device,
                         compute_type='float16' if args.device=='cuda' else 'int8', cpu_threads=4,local_files_only=True)
    start=time.perf_counter(); results=[]
    for entry in entries:
        wave=decode_audio(str(directory/entry['file']))
        segments,_=model.transcribe(wave,language='en',beam_size=5,temperature=0,condition_on_previous_text=False,vad_filter=False)
        hypothesis=' '.join(s.text for s in segments)
        reference_words=words(entry['reference'])
        results.append({**entry,'hypothesis':hypothesis,'words':len(reference_words),
                        'errors':edit_distance(reference_words,words(hypothesis)), 'duration':len(wave)/16000})
    elapsed=time.perf_counter()-start
    total_words=sum(r['words'] for r in results);errors=sum(r['errors'] for r in results)
    result={'model':args.model,'device':args.device,'clips':len(results),'reference_words':total_words,
            'word_errors':errors,'wer':errors/total_words,'elapsed_seconds':elapsed,
            'audio_seconds':sum(r['duration'] for r in results),'results':results}
    (directory/f'{args.model}-{args.device}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='results'}),flush=True)


if __name__=='__main__': main()
