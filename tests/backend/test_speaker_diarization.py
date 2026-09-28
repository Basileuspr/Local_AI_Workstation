from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pytest

from services import audio, speaker_diarization as speakers


def words(*values):
    return [{'words':[{'start':start, 'end':end, 'text':text} for start, end, text in values]}]


def test_speaker_change_within_sentence_and_stable_labels():
    turns = [{'start':0, 'end':1, 'speaker':9}, {'start':1, 'end':2, 'speaker':4}, {'start':2, 'end':3, 'speaker':9}]
    rows, labels = speakers.assign_speakers(words((0.1,.8,' Hello.'),(1.1,1.8,' Hi.'),(2.1,2.8,' Again.')), turns)
    assert labels == ['Speaker 1','Speaker 2']
    assert [r['speaker'] for r in rows] == ['Speaker 1','Speaker 2','Speaker 1']
    assert [r['text'] for r in rows] == ['Hello.','Hi.','Again.']
    assert rows[-1]['start'] == 2.1


def test_missing_evidence_and_overlapping_voices_are_not_guessed():
    turns = [{'start':1, 'end':2, 'speaker':0}, {'start':1, 'end':2, 'speaker':1}]
    rows, _ = speakers.assign_speakers(words((0,.5,' Quiet.'),(1.2,1.5,' Together.')), turns)
    assert [r['speaker'] for r in rows] == ['Unknown speaker','Unclear / overlapping']


def test_adjacent_words_merge_and_long_silences_split_turns():
    source = words((0,.4,'Hello'),(.4,.9,','),(.9,1.3,' world.'),(4,4.5,' Again.'))
    rows, _ = speakers.assign_speakers(source, [{'start':0,'end':5,'speaker':0}])
    assert [r['text'] for r in rows] == ['Hello, world.','Again.']


def test_word_crossing_a_speaker_handoff_is_not_overlap():
    turns = [{'start':0,'end':1,'speaker':0}, {'start':1,'end':2,'speaker':1}]
    rows, _ = speakers.assign_speakers(words((.7,1.2,' Hello.')), turns)
    assert rows[0]['speaker'] == 'Speaker 1'


def test_untranscribed_interjection_does_not_merge_neighboring_turns():
    turns = [{'start':0,'end':1,'speaker':0}, {'start':1,'end':1.3,'speaker':1},
             {'start':1.3,'end':2,'speaker':0}]
    rows, _ = speakers.assign_speakers(words((.2,.8,' Before.'),(1.4,1.8,' After.')), turns)
    assert [row['text'] for row in rows] == ['Before.', 'After.']
    assert all(row['speaker'] == 'Speaker 1' for row in rows)


@pytest.fixture
def fake_transcription(tmp_path, monkeypatch):
    monkeypatch.setattr(audio, 'MODEL_DIR', tmp_path)
    for name in ('model.bin','config.json','tokenizer.json'):
        (tmp_path / name).touch()
    class Model:
        def transcribe(self, waveform, **options):
            return iter([SimpleNamespace(start=0,end=1,text=' Hello there.', words=[
                SimpleNamespace(start=0,end=.4,word=' Hello'), SimpleNamespace(start=.6,end=1,word=' there.')])]), SimpleNamespace(language='en')
    monkeypatch.setattr(audio, '_runtime', lambda: lambda *args, **kwargs: Model())
    monkeypatch.setattr(audio, '_model', None)
    monkeypatch.setattr(speakers, 'status', lambda: {'ready':True})
    monkeypatch.setattr(audio, 'iter_audio_chunks', lambda path: iter([{
        'audio':np.zeros(16000, dtype=np.float32), 'start':0, 'end':1, 'keep_start':0, 'keep_end':1}]))
    return tmp_path


def test_diarization_uses_word_alignment_and_cleans_temporary_pcm(fake_transcription, monkeypatch):
    seen = []
    def run(path, count, progress):
        seen.append(path)
        assert path.stat().st_size == 16000 * 4
        assert count == 2
        progress(.5)
        assert audio.status()['progress']['stage'] == 'diarizing'
        return [{'start':0,'end':.5,'speaker':0}, {'start':.5,'end':1,'speaker':1}]
    monkeypatch.setattr(speakers, 'run', run)
    result = audio.transcribe(fake_transcription/'x.wav', diarize=True, num_speakers=2)
    assert result['diarized'] is True
    assert [r['speaker'] for r in result['segments']] == ['Speaker 1','Speaker 2']
    assert all('words' not in row for row in result['segments'])
    assert not seen[0].exists()
    assert audio.status()['progress'] is None


def test_quiet_speech_from_speaker_detector_is_not_removed_by_second_vad(fake_transcription, monkeypatch):
    samples = np.arange(60 * 16000, dtype=np.float32) / (60 * 16000)
    monkeypatch.setattr(audio, 'iter_audio_chunks', lambda path: iter([{
        'audio':samples, 'start':0, 'end':60, 'keep_start':0, 'keep_end':60}]))
    monkeypatch.setattr(speakers, 'run', lambda *args:[{'start':15,'end':18,'speaker':0}])
    seen = []
    class Model:
        def transcribe(self, waveform, **options):
            assert options['vad_filter'] is False
            seen.append(waveform.copy())
            return iter([SimpleNamespace(start=.6,end=1.6,text=' A quiet question.', words=[
                SimpleNamespace(start=.6,end=1.6,word=' A quiet question.')])]), SimpleNamespace(language='en')
    monkeypatch.setattr(audio, '_runtime', lambda:lambda *args,**kwargs:Model())
    result = audio.transcribe(fake_transcription/'input.wav',diarize=True)
    assert result['segments'][0]['text'] == 'A quiet question.'
    assert result['segments'][0]['start'] == pytest.approx(15)
    assert result['duration'] == 60  # Original timeline, not concatenated speech.
    assert len(seen[0]) < 5 * 16000
    assert seen[0][0] == pytest.approx(samples[round(14.4 * 16000)])


def test_speaker_windows_cover_long_speech_once_and_leave_large_silences():
    turns = [{'start':10,'end':49,'speaker':0},{'start':48,'end':70,'speaker':1},
             {'start':100,'end':110,'speaker':0}]
    windows = list(audio.speaker_windows(turns, 120))
    assert windows[0]['keep_start'] == pytest.approx(9.7)
    assert windows[-1]['keep_end'] == pytest.approx(110.3)
    assert max(w['end']-w['start'] for w in windows) < 29
    assert windows[0]['keep_end'] == windows[1]['keep_start']
    assert sum(w['keep_end']-w['keep_start'] for w in windows) == pytest.approx(71.2)


def test_failed_speaker_analysis_retains_successful_transcription(fake_transcription, monkeypatch):
    seen = []
    def fail(path, count, progress):
        seen.append(path)
        raise speakers.SpeakerError('Test worker failure')
    monkeypatch.setattr(speakers, 'run', fail)
    result = audio.transcribe(fake_transcription/'x.wav', diarize=True)
    assert result['text'] == 'Hello there.'
    assert result['diarized'] is False
    assert 'Test worker failure' in result['speaker_error']
    assert not seen[0].exists()
    assert not audio._lock.locked()


def test_missing_speaker_models_does_not_disable_plain_transcription(fake_transcription, monkeypatch):
    monkeypatch.setattr(speakers, 'status', lambda:{'ready':False})
    assert audio.transcribe(fake_transcription/'x.wav')['text'] == 'Hello there.'
    with pytest.raises(audio.AudioError, match='Set up speaker'):
        audio.transcribe(fake_transcription/'x.wav', diarize=True)


@pytest.mark.parametrize('count', [-1,21,2.5])
def test_invalid_speaker_count_fails_before_work(count):
    with pytest.raises(audio.AudioError, match='Speaker count'):
        audio.transcribe(Path('unused.wav'), diarize=True, num_speakers=count)


def test_worker_progress_file_lock_does_not_abort_inference(tmp_path, monkeypatch):
    from services import speaker_worker
    pcm, output, report = (tmp_path / name for name in ['audio.f32','output.json','progress.json'])
    np.zeros(16000, dtype=np.float32).tofile(pcm)
    class Engine:
        def process(self, waveform, callback):
            assert callback(1, 1) == 0
            return SimpleNamespace(sort_by_start_time=lambda:[SimpleNamespace(start=0,end=1,speaker=0)])
    monkeypatch.setattr(speaker_worker, '_engine', lambda *args:Engine())
    monkeypatch.setattr(speaker_worker.sys, 'argv', ['worker',str(tmp_path),str(pcm),str(output),str(report),'1'])
    def locked(*args):
        raise PermissionError('Another process is reading the progress file')
    monkeypatch.setattr(speaker_worker.os, 'replace', locked)
    speaker_worker.main()
    assert '"speaker": 0' in output.read_text()
