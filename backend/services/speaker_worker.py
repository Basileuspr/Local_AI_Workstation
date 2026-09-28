"""Native speaker-model worker. Called with app-generated local paths only."""
import json
import os
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from services.speaker_diarization import _engine


def main():
    directory, pcm, output, report = map(Path, sys.argv[1:5])
    speakers = int(sys.argv[5])
    threads = int(sys.argv[6]) if len(sys.argv) > 6 else 2
    engine = _engine(directory, speakers, threads)
    waveform = np.memmap(pcm, dtype='float32', mode='r')
    last_report = 0
    def progress(done, total):
        nonlocal last_report
        now = time.monotonic()
        if now - last_report >= 0.5 or done == total:
            last_report = now
            try:
                temp = report.with_suffix('.pending')
                temp.write_text(json.dumps({'fraction':done / max(total, 1)}), encoding='utf-8')
                os.replace(temp, report)
            except OSError:
                pass  # A transient Windows reader lock must not abort inference.
        return 0
    found = engine.process(np.asarray(waveform), callback=progress).sort_by_start_time()
    output.write_text(json.dumps([{'start':round(s.start, 3), 'end':round(s.end, 3), 'speaker':s.speaker} for s in found]), encoding='utf-8')
    del waveform


if __name__ == '__main__':
    main()
