import { useEffect, useRef, useState } from 'react';
import { audioOutput } from '../audioOutput';
import { createMiniPiano, pianoKeysForRange, pianoMapping, pianoMidiName } from '../miniPiano';
import { cleanPianoEffects, pianoSoundPresets } from '../pianoEffects';
import { enharmonicNames } from '../pianoTemplates';
import PianoLessons from './PianoLessons';
import './MiniPiano.css';

const isControl = target => target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

export default function MiniPiano({ active = true }) {
  const panel = useRef(null), engine = useRef(null), stopLesson = useRef(null), guideHost = useRef(null);
  const [state, setState] = useState({ octave: 4, baseMidi: 60, keyCount: 24, effects: { ...cleanPianoEffects }, volume: .65, playing: [], manualPlaying: [], status: 'Tap a key to start audio', error: '' });
  const [spelling, setSpelling] = useState('both'), [doubles, setDoubles] = useState(true), [expected, setExpected] = useState([]), [lastNote, setLastNote] = useState(null);
  const [guideShown, setGuideShown] = useState(true);
  if (!engine.current) engine.current = createMiniPiano(() => audioOutput.mixer.liveInput('audio'), setState);
  const piano = engine.current;
  useEffect(() => {
    if (!active) { piano.stopAll(); return; }
    const stop = () => { stopLesson.current?.(); piano.stopAll(); };
    const visibility = () => { if (document.hidden) stop(); };
    const keyup = event => {
      piano.release(`keyboard:${event.code || event.key.toLowerCase()}`);
      if (event.key === ' ' || event.key === 'Enter') piano.release(`focused:${event.key}`);
    };
    window.addEventListener('blur', stop);
    window.addEventListener('keyup', keyup);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', stop); window.removeEventListener('keyup', keyup);
      document.removeEventListener('visibilitychange', visibility); stop();
    };
  }, [active, piano]);
  const keys = pianoKeysForRange(state.baseMidi, state.keyCount);
  const whiteCount = keys.filter(key => !key.black).length;
  const canvasWidth = state.keyCount > 24 ? whiteCount * 32 : 0;
  function syncScroll(event) {
    for (const scroller of panel.current?.querySelectorAll('[data-piano-scroll]') || []) {
      if (scroller !== event.currentTarget && Math.abs(scroller.scrollLeft - event.currentTarget.scrollLeft) > 1) scroller.scrollLeft = event.currentTarget.scrollLeft;
    }
  }
  useEffect(() => {
    const scroll = panel.current?.querySelector('.piano-key-scroll');
    const key = panel.current?.querySelector(`[data-piano-note="${expected[0] - state.baseMidi}"]`);
    if (!scroll) return;
    if (key && (key.offsetLeft < scroll.scrollLeft || key.offsetLeft + key.offsetWidth > scroll.scrollLeft + scroll.clientWidth))
      scroll.scrollLeft = Math.max(0, key.offsetLeft - scroll.clientWidth / 2);
    else if (!key) scroll.scrollLeft = 0;
    for (const other of panel.current.querySelectorAll('[data-piano-scroll]')) other.scrollLeft = scroll.scrollLeft;
  }, [state.baseMidi, state.keyCount, expected]);
  function press(index, source) {
    setLastNote(piano.getSnapshot().baseMidi + index);
    void piano.press(index, source);
  }
  function changeOctave(value) { stopLesson.current?.(); piano.setOctave(value); }
  function focusGuide() {
    panel.current?.focus({ preventScroll: true });
    if (guideShown) guideHost.current?.scrollIntoView({ block: 'nearest' });
  }
  function keydown(event) {
    if (!active || event.repeat || event.ctrlKey || event.metaKey || event.altKey || isControl(event.target)) return;
    const focusedNote = event.target.closest('[data-piano-note]');
    if (focusedNote && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault(); press(Number(focusedNote.dataset.pianoNote), `focused:${event.key}`); return;
    }
    const index = pianoMapping.indexOf(event.key.toLowerCase());
    if (index >= 0 && index < state.keyCount) { event.preventDefault(); event.stopPropagation(); press(index, `keyboard:${event.code || event.key.toLowerCase()}`); }
  }
  return <section ref={panel} className="mini-piano" aria-label="Mini Piano" tabIndex={0} onKeyDown={keydown}
    onKeyUp={event => {
      if (event.target.closest('[data-piano-note]') && (event.key === ' ' || event.key === 'Enter')) event.preventDefault();
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { stopLesson.current?.(); piano.stopAll(); } }}>
    <header className="piano-toolbar">
      <h2>Mini Piano</h2>
      <div className="piano-octave"><button type="button" aria-label="Lower octave" disabled={!active || state.keyCount === 88 || state.octave === 1} onClick={() => changeOctave(state.octave - 1)}>−</button>
        <output aria-label="Piano range">{pianoMidiName(state.baseMidi)}–{pianoMidiName(state.baseMidi + state.keyCount - 1)}</output>
        <button type="button" aria-label="Higher octave" disabled={!active || state.keyCount === 88 || state.octave === 8 - state.keyCount / 12} onClick={() => changeOctave(state.octave + 1)}>+</button></div>
      <label className="piano-range-picker">Keyboard <select aria-label="Keyboard size" value={state.keyCount} disabled={!active}
        onChange={event => { stopLesson.current?.(); piano.setKeyCount(Number(event.target.value)); }}>
        <option value={24}>2 octaves</option><option value={36}>3 octaves</option><option value={48}>4 octaves</option><option value={88}>Full 88 keys</option>
      </select></label>
      <label className="piano-volume">Volume <input type="range" min="0" max="100" value={Math.round(state.volume * 100)} disabled={!active}
        onChange={event => piano.setVolume(Number(event.target.value) / 100)} /><output>{Math.round(state.volume * 100)}%</output></label>
    </header>
    <div ref={guideHost} hidden={!guideShown} />
    <div className="piano-key-scroll" data-piano-scroll onScroll={syncScroll} tabIndex={0} aria-label="Scroll piano keyboard">
    <div className="piano-keyboard" style={{ minWidth: canvasWidth }} role="group" aria-label="Piano keys">{keys.map(key => {
      const name = pianoMidiName(key.midi, spelling), midi = key.midi;
      const equivalents = enharmonicNames(midi, doubles), target = expected.includes(midi);
      return <button type="button" key={key.index} data-piano-note={key.index} aria-label={name} aria-pressed={state.playing.includes(key.index)}
        aria-description={`${equivalents.join(' equals ')}${target ? '. Next lesson note' : ''}`}
        title={`${equivalents.join(' = ')}${key.shortcut ? ` · ${key.shortcut.toUpperCase()}` : ''}${target ? ' · Next lesson note' : ''}`} disabled={!active}
        className={`piano-key ${key.black ? 'black' : 'white'}${state.playing.includes(key.index) ? ' playing' : ''}${target ? ' expected' : ''}`} style={{ left: key.black ? `${key.left}%` : undefined, width: `${key.width}%` }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); panel.current.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId);
          press(key.index, `pointer:${event.pointerId}`);
        }} onPointerUp={event => piano.release(`pointer:${event.pointerId}`)}
        onPointerCancel={event => piano.release(`pointer:${event.pointerId}`)} onLostPointerCapture={event => piano.release(`pointer:${event.pointerId}`)}
        onClick={event => {
          // Assistive technology can activate a button without pointer/key events.
          if (event.detail !== 0 || !active) return;
          const source = `click:${key.index}`; press(key.index, source);
          window.setTimeout(() => piano.release(source), 220);
        }}><span className="piano-note-label">{key.black ? <>{pianoMidiName(key.midi, spelling).replace(/-?\d+$/, '')}{spelling === 'both' && <span>{pianoMidiName(key.midi, 'flat').replace(/-?\d+$/, '')}</span>}</> : name}</span>
          <small aria-hidden="true">{key.shortcut.toUpperCase() || '\u00a0'}</small></button>;
    })}</div></div>
    <footer className="piano-footer"><span role="status" className={state.playing.length ? 'playing' : ''}>{state.error || state.status}</span>
      {state.keyCount > 24 && <span>Scroll sideways for more keys. Keys without letters use mouse or touch.</span>}
      <span>Click or focus the piano, then play: A W S E D F T G Y H U J K O L P ; ' ]</span></footer>
    <details className="piano-effects"><summary>Sound &amp; effects</summary>
      <div className="piano-sound-presets" aria-label="Piano sound presets">{Object.entries(pianoSoundPresets).map(([name, settings]) =>
        <button key={name} type="button" aria-pressed={Object.entries(settings).every(([key, value]) => state.effects[key] === value)} disabled={!active} onClick={() => piano.setEffects(settings)}>{name}</button>)}
        <button type="button" disabled={!active} onClick={() => piano.setEffects(cleanPianoEffects)}>Reset effects</button></div>
      <label>Waveform <select aria-label="Piano waveform" value={state.effects.waveform} disabled={!active} onChange={event => piano.setEffects({ waveform: event.target.value })}>
        <option value="triangle">Triangle · mellow</option><option value="sine">Sine · soft</option><option value="sawtooth">Sawtooth · bright</option><option value="square">Square · retro</option></select></label>
      <div className="piano-effect-sliders">{['tone', 'reverb', 'echo', 'tremolo', 'sustain'].map(effect => <label key={effect}>
        <span>{effect[0].toUpperCase() + effect.slice(1)}</span><input aria-label={`Piano ${effect}`} type="range" min="0" max="100" value={state.effects[effect]} disabled={!active}
          onChange={event => piano.setEffects({ [effect]: Number(event.target.value) })} /><output>{state.effects[effect]}%</output></label>)}</div>
      <p>Tone controls brightness. Reverb adds space; echo repeats notes; tremolo pulses the volume; sustain lengthens the release. Stop or leaving the piano clears the sound.</p>
    </details>
    <div className="piano-note-options"><label>Note names <select value={spelling} onChange={event => setSpelling(event.target.value)}><option value="both">Sharps &amp; flats</option><option value="sharp">Sharps</option><option value="flat">Flats</option></select></label>
      <label><input type="checkbox" checked={guideShown} onChange={event => { setGuideShown(event.target.checked); if (!event.target.checked) stopLesson.current?.(); }} /> Live note guide</label>
      <span aria-label="Selected key equivalents">{enharmonicNames(lastNote ?? (state.octave + 1) * 12, doubles).join(' = ')}</span></div>
    <PianoLessons piano={piano} pianoState={state} active={active} onTarget={setExpected} stopRef={stopLesson} spelling={spelling}
      guideHostRef={guideHost} guideShown={guideShown} onFocusGuide={focusGuide} onGuideScroll={syncScroll} />
    <details className="piano-enharmonics"><summary>Enharmonic equivalents</summary>
      <p>Different spellings can play the same key on this piano. The octave belongs to the written letter: B♯3 = C4; C♭5 = B4.</p>
      <p>♯ raises a note one semitone; ♭ lowers it one. A double sharp (𝄪 or ##) raises it two; a double flat (𝄫 or bb) lowers it two.</p>
      <label><input type="checkbox" checked={doubles} onChange={event => setDoubles(event.target.checked)} /> Include double sharps and double flats</label>
      <div className="piano-equivalent-list">{Array.from({ length: 12 }, (_, index) => <span key={index}>{enharmonicNames((state.octave + 1) * 12 + index, doubles).join(' = ')}</span>)}</div>
    </details>
  </section>;
}
