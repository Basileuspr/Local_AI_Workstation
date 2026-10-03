import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiUrl } from '../api';
import { reviewImageUrl } from '../visualReview';
import { comparisonFace, getFaceQuestions, personForName, saveFaceAnswer, undoFaceAnswer } from '../faceHelp';
import './FaceHelp.css';

const cropUrl = id => apiUrl(`/visual-review/faces/${encodeURIComponent(id)}`);

export function FaceHelpQuestion({ question, people, busy, onAnswer, onSkip }) {
  const nameInput = useRef(null);
  const [name, setName] = useState(question.suggestion?.name || '');
  const [personId, setPersonId] = useState(question.suggestion?.id || '');
  const [view, setView] = useState(question.view);
  const [context, setContext] = useState(false);
  const [failed, setFailed] = useState(new Set());
  const namesId = useId();
  const person = people.find(item => item.id === personId) || personForName(people, name);
  const referenceId = comparisonFace(question, person);
  const compare = view === 'comparison' && referenceId;
  const unavailable = failed.has(question.face_id) || (compare && failed.has(referenceId));
  const fail = id => setFailed(current => new Set([...current, id]));
  useEffect(() => { nameInput.current?.focus({ preventScroll: true }); }, []);
  function editName(value) {
    setName(value);
    setPersonId(personForName(people, value)?.id || '');
  }
  function choosePerson(id) {
    const selected = people.find(item => item.id === id);
    setPersonId(id); setName(selected?.name || ''); setView('comparison');
  }
  function answer(decision) {
    onAnswer({ decision, name: name.trim(), person_id: person?.id || null,
      suggestion_id: person?.id || null });
  }
  return <div className="face-help-question">
    <h3>{name.trim() ? `Does this look like ${name.trim()}?` : 'Who does this look like?'}</h3>
    <div className={`face-help-images${compare ? ' comparison' : ''}`}>
      <figure><img src={cropUrl(question.face_id)} alt="Face to identify" onError={() => fail(question.face_id)} /><figcaption>This face</figcaption></figure>
      {compare && <figure><img src={cropUrl(referenceId)} alt={`Reference for ${person.name}`} onError={() => fail(referenceId)} /><figcaption>{person.name} · reference</figcaption></figure>}
    </div>
    <div className="face-help-view" aria-label="Question view">
      <button type="button" disabled={busy} aria-pressed={view === 'single' || !referenceId} onClick={() => setView('single')}>Single face</button>
      <button type="button" disabled={busy || !referenceId} aria-pressed={Boolean(compare)} onClick={() => setView('comparison')}>Compare</button>
      <button type="button" disabled={busy} aria-expanded={context} onClick={() => setContext(value => !value)}>{context ? 'Hide photo' : 'Show photo context'}</button>
    </div>
    {question.reasons.length > 0 && <p className="face-help-reason">{question.reasons.join(' ')}</p>}
    <p className="face-help-source" title={question.source.name}>{question.source.name}</p>
    {context && <figure className="face-help-context"><img src={reviewImageUrl(question.source.source, question.source.id, true)} alt="Original photo for context" onError={() => fail('context')} />{failed.has('context') && <figcaption>The original photo is unavailable. You can still review the saved crop.</figcaption>}</figure>}
    <form onSubmit={event => { event.preventDefault(); if (!busy && !unavailable && name.trim()) answer('yes'); }}>
      <label>Person’s name<input ref={nameInput} aria-label="Person’s name" value={name} list={namesId} maxLength={120} disabled={busy} placeholder="Enter a name or choose someone below" onChange={event => editName(event.target.value)} /></label>
      <datalist id={namesId}>{people.filter(item => item.named).map(item => <option key={item.id} value={item.name} />)}</datalist>
      <details className="face-help-existing"><summary>Choose from existing people</summary><label>Existing people<select aria-label="Existing person group" value={person?.id || ''} disabled={busy} onChange={event => choosePerson(event.target.value)}>
        <option value="">A new name…</option>{people.filter(item => item.named).map(item => <option key={item.id} value={item.id}>{item.name} ({item.count} face{item.count === 1 ? '' : 's'})</option>)}
      </select></label></details>
      {unavailable && <p role="alert">A face preview could not load. Skip this question or refresh before answering.</p>}
      <div className="face-help-answers"><button type="submit" className="face-help-yes" disabled={busy || unavailable || !name.trim()}>Yes</button>
        <button type="button" disabled={busy || unavailable} onClick={() => answer('no')}>No</button>
        <button type="button" disabled={busy} onClick={onSkip}>Skip / not sure</button></div>
      <button className="face-help-not-face" type="button" disabled={busy || failed.has(question.face_id)} onClick={() => answer('not-face')}>Not a face</button>
    </form>
  </div>;
}

function FaceHelpDialog({ active, onClose }) {
  const dialog = useRef(null), working = useRef(false), generation = useRef(0), skipped = useRef([]);
  const [source, setSource] = useState('all'), [includeAnswered, setIncludeAnswered] = useState(false);
  const [data, setData] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [notice, setNotice] = useState(''), [undo, setUndo] = useState(null), [round, setRound] = useState(0);
  const titleId = useId();

  useEffect(() => {
    const node = dialog.current;
    if (active && !node.open) node.showModal();
    else if (!active) node.close();
    return () => node.close();
  }, [active]);

  async function load(selectedSource = source, include = includeAnswered) {
    const ticket = ++generation.current;
    const result = await getFaceQuestions({ source: selectedSource, skip_ids: skipped.current, include_answered: include });
    if (ticket === generation.current) { setData(result); setRound(value => value + 1); if (dialog.current) dialog.current.scrollTop = 0; }
  }

  useEffect(() => {
    if (!active || data || working.current) return;
    working.current = true; setBusy(true); setError('');
    load().catch(failure => setError(failure.message))
      .finally(() => { working.current = false; setBusy(false); });
  }, [active]);

  async function act(work) {
    if (working.current) return;
    working.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (failure) { setError(failure.message || 'Could not save this answer. Try again.'); }
    finally { working.current = false; setBusy(false); }
  }

  function changeSource(value) {
    act(async () => {
      setSource(value); skipped.current = []; setData(null); setNotice('');
      setUndo(null); setIncludeAnswered(false); await load(value, false);
    });
  }

  function answer(body) {
    act(async () => {
      const question = data.question;
      const saved = await saveFaceAnswer({ source, face_id: question.face_id, version: question.version, ...body });
      setUndo({ ...saved, source }); setNotice(saved.message);
      if (includeAnswered) skipped.current = [...skipped.current, question.face_id];
      setData(null); await load();
    });
  }

  function skip() {
    act(async () => {
      skipped.current = [...skipped.current, data.question.face_id];
      setData(null); setNotice('Skipped for this visit. You can come back to it later.'); await load();
    });
  }

  function undoLast() {
    act(async () => {
      const result = await undoFaceAnswer({ source: undo.source, face_id: undo.face_id, undo_id: undo.undo_id });
      skipped.current = skipped.current.filter(id => id !== undo.face_id);
      setUndo(null); setNotice(result.message); setData(null); await load();
    });
  }

  const refresh = () => act(async () => { setData(null); await load(); });
  const finish = () => { if (!working.current) onClose(); };
  return createPortal(<dialog ref={dialog} className="face-help-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); finish(); }} onClick={event => {
    if (event.target !== event.currentTarget || working.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) finish();
  }}>
    <header><div><span className="face-help-eyebrow">HELP OUT WITH YOUR PHOTOS</span><h2 id={titleId}>Help identify faces</h2></div><button type="button" autoFocus disabled={busy} onClick={finish}>Close</button></header>
    <div className="face-help-toolbar"><label>Photos from<select aria-label="Photos to help identify" value={source} disabled={busy} onChange={event => changeSource(event.target.value)}><option value="all">All analyzed images</option><option value="library">Image Library</option><option value="image-manager">Image Manager</option></select></label>
      <button type="button" disabled={busy} onClick={refresh}>Refresh</button></div>
    {data && <p className="face-help-progress" role="status">{data.remaining} remaining · {data.answered} answered{data.skipped > 0 && ` · ${data.skipped} skipped this visit`}{includeAnswered && ' · Reviewing answered faces'}</p>}
    {notice && <div className="face-help-notice" role="status"><span>{notice}</span>{undo && <button type="button" disabled={busy} onClick={undoLast}>Undo last answer</button>}</div>}
    {error && <div className="face-help-error" role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={refresh}>Retry / refresh</button></div>}
    {data?.question && <FaceHelpQuestion key={`${data.question.face_id}:${round}`} question={data.question} people={data.people} busy={busy} onAnswer={answer} onSkip={skip} />}
    {busy && <p className="face-help-working" role="status">{data?.question ? 'Saving…' : 'Loading questions…'}</p>}
    {data && !data.question && !busy && <div className="face-help-empty"><h3>{data.total ? 'You’re caught up for this visit.' : 'No analyzed faces to review yet.'}</h3>
      <p>{data.total ? 'Saved answers stay in REVIEW. Skipped questions are available next time.' : 'Use Group faces and classify in REVIEW / Image Manager, then return here.'}</p>
      {data.skipped > 0 && <button type="button" onClick={() => act(async () => { skipped.current = []; setData(null); await load(); })}>Revisit skipped faces</button>}
      {data.answered > 0 && !includeAnswered && <button type="button" onClick={() => act(async () => { skipped.current = []; setIncludeAnswered(true); setData(null); await load(source, true); })}>Review answered faces</button>}
    </div>}
    <footer>Answers save in REVIEW. Similarity suggests a match; you decide. A new name labels this face.</footer>
  </dialog>, document.body);
}

export default function FaceHelp({ active = true }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null), wasOpen = useRef(false);
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) { wasOpen.current = false; trigger.current?.focus(); }
  }, [open]);
  return <div className="break-room-help"><div><h2>Help out with your photos</h2><p>A few quick Yes / No questions to name faces and improve your REVIEW groups.</p></div>
    <button ref={trigger} type="button" aria-haspopup="dialog" disabled={!active} onClick={() => setOpen(true)}>Help identify faces</button>
    {open && <FaceHelpDialog active={active} onClose={() => setOpen(false)} />}
  </div>;
}
