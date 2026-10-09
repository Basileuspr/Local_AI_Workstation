import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pianoNote } from '../miniPiano';
import { createPianoLessonPlayer, MAX_PIANO_TEMPLATES, pianoLessonGroups, parsePianoSequence, pianoLessons, readPianoTemplates, savePianoTemplates, validatePianoTemplate } from '../pianoTemplates';
import { createPianoRhythmRun, pianoGuideNow } from '../pianoGuide';
import PianoRoll from './PianoRoll';
import PianoAudioConverter from './PianoAudioConverter';
import { useDispatch } from '../useStore';
import { requestPianoSpotifyReference } from '../pianoSpotifyBridge';

const stepLabel = step => step.notes.length ? step.notes.map(note => note.name).join(' + ') : 'Rest';
const templateId = () => `user-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

export default function PianoLessons({ piano, pianoState, active, onTarget, stopRef, spelling, guideHostRef, guideShown, onFocusGuide, onGuideScroll }) {
  const dispatch = useDispatch();
  const [initial] = useState(readPianoTemplates);
  const [custom, setCustom] = useState(initial.templates);
  const [selectedId, setSelectedId] = useState(pianoLessons[0].id);
  const [tempo, setTempo] = useState(pianoLessons[0].tempo), [loop, setLoop] = useState(false);
  const [demo, setDemo] = useState({ running: false, index: -1 }), [practice, setPractice] = useState(null);
  const [rhythm, setRhythm] = useState(null), [guideHost, setGuideHost] = useState(null);
  const [draft, setDraft] = useState(null), [editError, setEditError] = useState(''), [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(initial.error), [deleted, setDeleted] = useState(null);
  const [captured, setCaptured] = useState([]), [beats, setBeats] = useState(1);
  const playerRef = useRef(null), previousHeld = useRef([]), rhythmRun = useRef(null), rhythmSignature = useRef('');
  if (!playerRef.current) playerRef.current = createPianoLessonPlayer(piano, setDemo);
  const player = playerRef.current;
  const selected = [...pianoLessons, ...custom].find(item => item.id === selectedId) || pianoLessons[0];
  const validTempo = Number.isFinite(Number(tempo)) && Number(tempo) >= 40 && Number(tempo) <= 240;
  const held = useMemo(() => (pianoState.manualPlaying || []).map(index => (pianoState.baseMidi ?? (pianoState.octave + 1) * 12) + index).sort((a, b) => a - b), [pianoState.manualPlaying, pianoState.octave, pianoState.baseMidi]);
  const heldKey = held.join(',');
  const stop = useCallback(() => { player.stop(); piano.stopAll(); setPractice(null); rhythmRun.current = null; setRhythm(null); onTarget([]); }, [player, piano, onTarget]);
  useEffect(() => { setGuideHost(guideHostRef?.current || null); }, [guideHostRef]);
  const publishRhythm = useCallback(value => {
    const signature = [value.index, value.countIn, value.done, value.hits, value.misses, value.streak, value.feedback].join('|');
    if (signature !== rhythmSignature.current) { rhythmSignature.current = signature; setRhythm(value); }
  }, []);
  useEffect(() => {
    stopRef.current = stop;
    return () => { if (stopRef.current === stop) stopRef.current = null; player.stop(); rhythmRun.current = null; };
  }, [stop, stopRef, player]);
  useEffect(() => { if (!active) stop(); }, [active, stop]);
  useEffect(() => {
    if (!active || !rhythm?.running) return;
    let frame;
    function tick(now) {
      if (!rhythmRun.current) return;
      const next = rhythmRun.current.tick(now); publishRhythm(next);
      if (next.running) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, rhythm?.running, publishRhythm]);
  useEffect(() => { if (active && rhythmRun.current) publishRhythm(rhythmRun.current.observe(held, pianoGuideNow())); }, [active, heldKey, publishRhythm]);
  useEffect(() => {
    if (held.some(note => !previousHeld.current.includes(note))) setCaptured(held);
    previousHeld.current = held;
  }, [heldKey]); // Capture note-ons, preserving the chord after keys are released.
  const currentIndex = demo.running ? demo.index : rhythm?.running ? rhythm.index : practice && !practice.done ? practice.index : -1;
  const currentStep = selected.steps[currentIndex];
  useEffect(() => {
    if (!active) { onTarget([]); return; }
    const target = currentStep || selected.steps[0];
    piano.ensureNotes(target.notes);
    onTarget(target.notes.map(note => note.midi));
  }, [active, currentStep, selected, pianoState.keyCount, piano, onTarget]);
  useEffect(() => {
    if (!active || !practice || practice.done) return;
    if (practice.waiting) {
      if (!held.length) setPractice(value => value && ({ ...value, waiting: false }));
      return;
    }
    const notes = selected.steps[practice.index].notes.map(note => note.midi).sort((a, b) => a - b);
    if (notes.length && notes.join(',') === heldKey) setPractice({ index: practice.index + 1, waiting: true, done: practice.index + 1 === selected.steps.length });
  }, [active, heldKey, practice, selected]);

  function choose(id) {
    stop(); const next = [...pianoLessons, ...custom].find(item => item.id === id);
    setSelectedId(id); setTempo(next.tempo); setNotice('');
  }
  function startPractice(index = 0) {
    stop(); setPractice({ index, waiting: true, done: false }); onFocusGuide?.();
  }
  function startPlayAlong() {
    if (!active || !validTempo) return;
    stop();
    rhythmRun.current = createPianoRhythmRun(selected.steps, Number(tempo)); rhythmSignature.current = '';
    publishRhythm(rhythmRun.current.tick(pianoGuideNow())); onFocusGuide?.();
  }
  function nextStep() {
    piano.stopAll(); setPractice(value => ({ index: value.index + 1, waiting: true, done: value.index + 1 === selected.steps.length }));
  }
  function makeDraft(copy = false) {
    stop(); setEditError(''); setNotice('');
    setDraft(copy ? { id: selected.builtin ? null : selected.id, title: selected.builtin ? `${selected.title} copy` : selected.title, description: selected.description, sequence: selected.sequence, tempo: selected.tempo, spotifyLink: selected.spotifyLink || '' }
      : { id: null, title: '', description: '', sequence: '', tempo: 90, spotifyLink: '' });
  }
  function persist(next) {
    setCustom(next);
    // A corrupt/unreadable library is kept intact; new work remains exportable.
    setStorageError(initial.error || savePianoTemplates(next));
  }
  function save(event) {
    event.preventDefault();
    try {
      const value = validatePianoTemplate(draft);
      if (!draft.id && custom.length >= MAX_PIANO_TEMPLATES) throw Error(`You can save ${MAX_PIANO_TEMPLATES} templates. Delete one before adding another.`);
      const entry = { ...value, id: draft.id || templateId(), builtin: false };
      persist([...custom.filter(item => item.id !== entry.id), entry]);
      if (deleted?.id === entry.id) setDeleted(null);
      stop(); setSelectedId(entry.id); setTempo(entry.tempo); setDraft(null); setNotice(`Saved “${entry.title}”.`); setEditError('');
    } catch (error) { setEditError(error.message); }
  }
  function addPlayed() {
    const names = captured.map(midi => pianoNote(midi % 12, Math.floor(midi / 12) - 1, spelling));
    const token = names.length === 1 ? names[0] : `[${names.join(' ')}]`;
    append(`${token}${beats === 1 ? '' : `:${beats}`}`);
  }
  function append(token) { setDraft(value => ({ ...value, sequence: `${value.sequence.trim()} ${token}`.trim() })); }
  function remove() {
    stop(); setDeleted(selected); persist(custom.filter(item => item.id !== selected.id)); setSelectedId(pianoLessons[0].id); setTempo(pianoLessons[0].tempo); setNotice(`Deleted “${selected.title}”.`);
  }
  function undoDelete() {
    if (custom.some(item => item.id === deleted.id)) { setDeleted(null); setNotice('Template is already restored.'); return; }
    if (custom.length >= MAX_PIANO_TEMPLATES) { setNotice('Delete another template to make room for this one.'); return; }
    stop();
    persist([...custom, deleted]); setSelectedId(deleted.id); setTempo(deleted.tempo); setDeleted(null); setNotice('Template restored.');
  }
  function download() {
    const { title, description, sequence, tempo, spotifyLink } = selected;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, title, description, sequence, tempo, spotifyLink }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title.replace(/[^a-z0-9_-]/gi, '-').slice(0, 60) || 'piano-template'}.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  let draftPreview;
  if (draft?.sequence.trim()) { try { draftPreview = `${parsePianoSequence(draft.sequence).length} steps ready`; } catch (error) { draftPreview = error.message; } }
  let practiceMessage = '';
  if (practice?.done) practiceMessage = `Practice complete — ${selected.steps.length} steps!`;
  else if (practice && currentStep) {
    practiceMessage = `${practice.index + 1} / ${selected.steps.length}: ${currentStep.notes.length ? `Play ${stepLabel(currentStep)}` : `Count ${currentStep.beats} beat${currentStep.beats === 1 ? '' : 's'} of rest, then choose Next step`}.`;
    if (practice.waiting && held.length) practiceMessage += ' Release the keys before the next step.';
  }
  const guideMode = demo.running ? demo.starting ? 'starting' : 'listen' : rhythm ? rhythm.done ? 'complete' : 'rhythm' : practice ? practice.done ? 'complete' : 'practice' : 'preview';
  return <><div className="piano-lessons">
    <div className="piano-lesson-picker"><label>Lesson / template <select aria-label="Piano lesson or template" value={selected.id} disabled={!active} onChange={event => choose(event.target.value)}>
      {Object.entries(pianoLessonGroups).map(([group, ids]) => <optgroup key={group} label={group}>{ids.map(id => {
        const item = pianoLessons.find(lesson => lesson.id === id);
        return <option key={id} value={id}>{item.title}</option>;
      })}</optgroup>)}
      {custom.length > 0 && <optgroup label="My templates">{custom.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</optgroup>}
    </select></label><button type="button" disabled={!active} onClick={() => makeDraft()}>New template</button></div>
    {selected.spotifyLink && <div className="piano-spotify-reference"><span>Spotify track reference</span><a href={selected.spotifyLink} target="_blank" rel="noopener noreferrer">Listen on Spotify</a>
      <button type="button" disabled={!active || !dispatch} onClick={() => { stop(); requestPianoSpotifyReference(selected.spotifyLink); dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'integrations' }); }}>Open in Linked Applications</button></div>}
    <p className="piano-lesson-description">{selected.description}</p>
    <div className="piano-lesson-actions">
      <button type="button" disabled={!active || !validTempo} onClick={() => { stop(); player.play(selected, Number(tempo), loop); onFocusGuide?.(); }}>Listen</button>
      <button type="button" disabled={!active} onClick={() => startPractice()}>Practice</button>
      <button type="button" disabled={!active || !validTempo} onClick={startPlayAlong}>Play along</button>
      <button type="button" disabled={!active || (!demo.running && !practice && !rhythm)} onClick={stop}>Stop</button>
      <label>Tempo <input aria-label="Piano lesson tempo" type="number" min="40" max="240" value={tempo} disabled={demo.running || rhythm?.running || !active}
        onChange={event => setTempo(event.target.value)} onBlur={() => { if (!validTempo) setTempo(selected.tempo); }} /> BPM</label>
      <label><input type="checkbox" checked={loop} disabled={demo.running || !active} onChange={event => setLoop(event.target.checked)} /> Repeat</label>
      <button type="button" disabled={!active} onClick={() => makeDraft(true)}>{selected.builtin ? 'Use as template' : 'Edit template'}</button>
      {!selected.builtin && <><button type="button" disabled={!active} onClick={download}>Download template</button><button type="button" disabled={!active} onClick={remove}>Delete template</button></>}
    </div>
    {(demo.running || practice) && <p className="piano-practice-status" role="status">{demo.running ? `Listening: ${demo.index + 1} / ${selected.steps.length} · ${stepLabel(currentStep)}` : practiceMessage}
      {practice && !practice.done && <button type="button" onClick={nextStep} disabled={!active}>{currentStep?.notes.length ? 'Skip step' : 'Next step'}</button>}</p>}
    <details className="piano-sequence"><summary>View {selected.steps.length} steps · click a step to practice</summary>
      <div className="piano-step-list" aria-label="Lesson steps">{selected.steps.map((step, index) => <button key={index} type="button" disabled={!active} aria-current={index === currentIndex ? 'step' : undefined}
        title={`${stepLabel(step)} · ${step.beats} beats`} onClick={() => startPractice(index)}><small>{index + 1}.</small> {stepLabel(step)} <small>· {step.beats}b</small></button>)}</div>
    </details>
    {notice && <p role="status">{notice} {deleted && <button type="button" onClick={undoDelete}>Undo delete</button>}</p>}
    {storageError && <p role="alert">{storageError}</p>}
    <PianoAudioConverter active={active} onStopPiano={stop} onTemplate={value => { stop(); setEditError(''); setDraft({ ...value, id: null }); setNotice('Review the converted notes, then Save template to practice with the live guide.'); }} />
    {draft && <form className="piano-template-editor" aria-label="Piano template editor" onSubmit={save}>
      <h3>{draft.id ? 'Edit your template' : 'Make a piano template'}</h3>
      <div className="piano-template-fields"><label>Template title <input autoFocus required maxLength={80} value={draft.title} disabled={!active} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></label>
        <label>Default tempo <input type="number" min="40" max="240" required value={draft.tempo} disabled={!active} onChange={event => setDraft(value => ({ ...value, tempo: event.target.value }))} /></label></div>
      <label>Instructions <textarea rows={2} maxLength={600} value={draft.description} disabled={!active} onChange={event => setDraft(value => ({ ...value, description: event.target.value }))} /></label>
      <label>Spotify track reference (optional)<input aria-label="Piano template Spotify reference" value={draft.spotifyLink || ''} disabled={!active} placeholder="https://open.spotify.com/track/…" onChange={event => setDraft(value => ({ ...value, spotifyLink: event.target.value }))} /></label>
      <p>Save a Spotify track link with this lesson. Open it in Linked Applications or Spotify to listen separately; conversion uses your local audio file.</p>
      <label>Note sequence <textarea className="piano-sequence-input" rows={3} maxLength={8000} value={draft.sequence} disabled={!active} placeholder="C4 D4 Eb4 [C4 E4 G4]:2 R:1 C5"
        onChange={event => setDraft(value => ({ ...value, sequence: event.target.value }))} /></label>
      <p>Separate steps with spaces. [C4 E4 G4] is a chord; :2 lasts two beats; R is a rest. Flats, sharps and double accidentals work: Db4, E#4, F##4, Gbb4.</p>
      <div className="piano-lesson-actions"><label>Step beats <select value={beats} disabled={!active} onChange={event => setBeats(Number(event.target.value))}>{[.25, .5, 1, 1.5, 2, 3, 4, 8].map(value => <option key={value}>{value}</option>)}</select></label>
        <button type="button" disabled={!active || !captured.length} onClick={addPlayed}>Add played keys</button><button type="button" disabled={!active} onClick={() => append(`R${beats === 1 ? '' : `:${beats}`}`)}>Add rest</button>
      </div>
      <p className="piano-template-hint">Play a note or chord above, release it, then Add played keys.{captured.length > 0 && ` Captured: ${captured.map(midi => pianoNote(midi % 12, Math.floor(midi / 12) - 1, spelling)).join(' + ')}.`}</p>
      {draftPreview && <p role="status">{draftPreview}</p>}{editError && <p role="alert">{editError}</p>}
      <div className="piano-lesson-actions"><button type="submit" disabled={!active}>Save template</button><button type="button" onClick={() => { setDraft(null); setEditError(''); }}>Cancel</button></div>
    </form>}
  </div>{guideHost && createPortal(<PianoRoll steps={selected.steps} title={selected.title} octave={pianoState.octave} baseMidi={pianoState.baseMidi} keyCount={pianoState.keyCount} onScroll={onGuideScroll}
    tempo={rhythm?.tempo ?? (validTempo ? Number(tempo) : selected.tempo)} mode={guideMode} index={currentIndex < 0 ? 0 : currentIndex}
    startedAt={rhythm?.startedAt ?? demo.startedAt ?? 0} rhythm={rhythm} waiting={Boolean(practice?.waiting && held.length)}
    active={active && guideShown} canPlayAlong={validTempo} onPractice={() => startPractice()} onPlayAlong={startPlayAlong} onStop={stop} />, guideHost)}</>;
}
