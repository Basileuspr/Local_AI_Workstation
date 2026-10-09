import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pianoGuideNow, pianoKeyHint, pianoTimeline } from '../pianoGuide';
import { pianoKeysForRange } from '../miniPiano';
import './PianoRoll.css';

export default function PianoRoll({ steps, title, octave, keyCount = 24, baseMidi = (octave + 1) * 12, onScroll, tempo, mode = 'preview', index = 0, startedAt = 0, rhythm, waiting,
  active = true, onPractice, onPlayAlong, onStop, canPlayAlong = true }) {
  const timeline = useMemo(() => pianoTimeline(steps), [steps]);
  const endBeat = timeline.at(-1)?.endBeat || 0;
  const target = mode === 'complete' ? endBeat : timeline[index]?.beat || 0;
  const cursorRef = useRef(target), [cursor, setCursor] = useState(target);
  const animated = mode === 'listen' || mode === 'rhythm';
  useLayoutEffect(() => {
    if (!active) return;
    let frame, previous = pianoGuideNow();
    // A lesson/loop restart must reset rather than sweep backwards through notes.
    if (mode === 'preview' || (mode === 'practice' && target < cursorRef.current)) cursorRef.current = target;
    function draw(now) {
      let next;
      if (animated) next = mode === 'rhythm' ? (now - startedAt) * tempo / 60000 : target + Math.max(0, Math.min(timeline[index]?.beats || 0, (now - startedAt) * tempo / 60000));
      else next = cursorRef.current + (target - cursorRef.current) * Math.min(1, (now - previous) / 90);
      previous = now;
      if (!animated && Math.abs(next - target) < .015) next = target;
      cursorRef.current = next; setCursor(next);
      if (animated || next !== target) frame = requestAnimationFrame(draw);
    }
    draw(pianoGuideNow());
    return () => cancelAnimationFrame(frame);
  }, [active, animated, mode, target, startedAt, tempo, timeline, index]);
  const current = mode === 'complete' ? null : timeline[index];
  const base = baseMidi, lanes = pianoKeysForRange(baseMidi, keyCount);
  const canvasWidth = keyCount > 24 ? lanes.filter(lane => !lane.black).length * 32 : 0;
  const visible = timeline.filter(step => step.endBeat >= cursor - .7 && step.beat <= cursor + 4.4);
  const name = current?.notes.map(note => note.name).join(' + ') || 'Rest';
  const upcoming = timeline.slice((current?.index ?? timeline.length) + 1, (current?.index ?? timeline.length) + 4);
  const counting = rhythm?.countIn > 0 && mode === 'rhythm';
  const label = mode === 'preview' ? 'Preview' : mode === 'starting' ? 'Starting audio' : mode === 'listen' ? 'Listening' : mode === 'rhythm' ? 'Play along' : mode === 'complete' ? 'Finished' : 'Practice · waits for you';
  return <section className="piano-roll-guide" aria-label="Live piano note guide">
    <div className="piano-roll-heading"><div><strong>Live note guide</strong><span>{title} · {label}</span></div>
      <div className="piano-roll-actions"><button type="button" disabled={!active} onClick={onPractice}>Practice</button>
        <button type="button" disabled={!active || !canPlayAlong} onClick={onPlayAlong}>Play along</button>
        <button type="button" disabled={!active || mode === 'preview' || mode === 'complete'} onClick={onStop}>Stop</button></div></div>
    <div className="piano-roll-prompt" role="status">
      {counting ? <><b className="piano-count-in">{rhythm.countIn}</b><span>Get ready · first notes: {name}</span></>
        : mode === 'complete' ? <b>{rhythm ? `Finished · ${rhythm.hits} / ${rhythm.total} hits` : 'Practice complete!'}</b>
          : <><b>{waiting ? 'Release, then press' : !current?.notes.length ? 'REST' : mode === 'preview' ? 'FIRST' : 'PRESS'}</b>
            <span>{name}</span><span className="piano-roll-key-hints">{current?.notes.map(note => <kbd key={note.midi}>{pianoKeyHint(note.midi, octave, keyCount, baseMidi)}</kbd>)}</span></>}
    </div>
    <div className="piano-roll-scroll" data-piano-scroll onScroll={onScroll}><div style={{ minWidth: canvasWidth }} className="piano-roll" aria-hidden="true" data-mode={mode} data-beat={cursor.toFixed(3)}>
      {lanes.map(lane => <div key={lane.index} className={`piano-roll-lane${lane.black ? ' black' : ''}`} style={{ left: `${lane.left}%`, width: `${lane.width}%` }} />)}
      {visible.map(step => step.notes.length ? step.notes.map(note => {
        const lane = lanes[note.midi - base];
        if (!lane) return null;
        const result = rhythm?.results[step.index];
        return <div key={`${step.index}-${note.midi}`} data-guide-step={step.index} data-guide-midi={note.midi}
          className={`piano-falling-note${lane.black ? ' black' : ''}${step.beats < 1 ? ' short' : ''}${step.index === index ? ' current' : ''}${result ? ` ${result}` : ''}`}
          style={{ left: `${lane.left + lane.width * .08}%`, width: `${lane.width * .84}%`, bottom: `${20 + (step.beat - cursor) * 35}px`, height: `${Math.max(18, step.beats * 35 - 5)}px` }}>
          <span>{pianoKeyHint(note.midi, octave, keyCount, baseMidi) === 'tap key' ? note.name : lane.shortcut.toUpperCase()}</span><small>{note.name}</small>
        </div>;
      }) : <div key={`${step.index}-rest`} className="piano-roll-rest" style={{ bottom: `${20 + (step.beat - cursor) * 35}px` }}>REST · {step.beats} beat{step.beats === 1 ? '' : 's'}</div>)}
      <div className="piano-hit-line"><span>{mode === 'practice' ? 'PLAY HERE · waits for you' : 'PLAY WHEN NOTES REACH THIS LINE'}</span></div>
    </div>
    </div><div className="piano-roll-footer"><span>{mode === 'rhythm' ? 'Keep the beat. Release and press again for repeated notes.' : mode === 'listen' ? 'Watch the keys while the lesson plays.' : 'Practice waits for the correct keys. Play along follows the tempo.'}</span>
      {rhythm && <span className={`piano-rhythm-feedback ${rhythm.feedbackKind}`} role="status">{rhythm.feedback} · {rhythm.hits} hits · {rhythm.misses} missed · streak {rhythm.streak}</span>}</div>
    {upcoming.length > 0 && <div className="piano-upcoming" aria-label="Upcoming piano notes"><span>Next:</span>{upcoming.map(step => <span key={step.index}>{step.notes.length ? step.notes.map(note => `${note.name} (${pianoKeyHint(note.midi, octave, keyCount, baseMidi)})`).join(' + ') : 'Rest'} · {step.beats}b</span>)}</div>}
  </section>;
}
