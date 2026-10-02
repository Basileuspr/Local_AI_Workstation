import { useEffect, useRef, useState } from "react";
import { clampTimerPosition, durationFields, durationFromFields, formatCountdown, loadTimer, pauseTimer,
  remainingTime, resetTimer, saveTimer, startTimer } from "../workstationTimer";
import { WINDOW_LAYOUT_EVENT } from "../windowRendering";
import "./WorkstationTime.css";

export default function WorkstationTime({ onOverlayChange, inert = false }) {
  const [now, setNow] = useState(Date.now);
  const [timer, setTimer] = useState(loadTimer);
  const [fields, setFields] = useState(() => durationFields(timer.durationMs));
  const [error, setError] = useState("");
  const panel = useRef(null), trigger = useRef(null), drag = useRef(null), audio = useRef(null), sounded = useRef(null);
  const left = remainingTime(timer, now);
  const active = timer.status !== "idle";
  const visible = timer.display !== "hidden";

  useEffect(() => {
    const update = () => setNow(Date.now());
    const tick = setInterval(update, 250);
    window.addEventListener("focus", update); document.addEventListener("visibilitychange", update);
    return () => { clearInterval(tick); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  useEffect(() => saveTimer(timer), [timer]);
  useEffect(() => () => { void audio.current?.close().catch(() => {}); }, []);

  function prepareSound(enabled = timer.sound) {
    if (!enabled) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audio.current ||= new Audio();
      void audio.current.resume().catch(() => {});
    } catch { /* The visible completion indicator remains available without audio. */ }
  }
  useEffect(() => { if (timer.status === "running") prepareSound(); }, [timer.status, timer.sound]);
  useEffect(() => {
    if (timer.status !== "running" || left > 0) return;
    setTimer(current => ({ ...current, status: "finished", remainingMs: 0, deadline: null }));
    if (sounded.current === timer.deadline) return;
    sounded.current = timer.deadline;
    if (!timer.sound || audio.current?.state !== "running") return;
    try {
      const context = audio.current;
      for (let i = 0; i < 3; i++) {
        const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime + i * .4;
        oscillator.frequency.value = 880; gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.12, start + .02); gain.gain.exponentialRampToValueAtTime(.001, start + .25);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .3);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    } catch { /* Audio errors must not interrupt countdown completion. */ }
  }, [left, timer.status, timer.deadline, timer.sound]);

  useEffect(() => {
    if (!visible) { onOverlayChange?.(null); return; }
    const element = panel.current;
    if (!element) return;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      const position = timer.position || { x: bounds.x, y: bounds.y };
      const clamped = clampTimerPosition(position, bounds.width, bounds.height, window.innerWidth, window.innerHeight);
      if (clamped.x !== position.x || clamped.y !== position.y) {
        setTimer(current => ({ ...current, position: clamped })); return;
      }
      onOverlayChange?.({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    window.addEventListener("resize", measure); window.addEventListener(WINDOW_LAYOUT_EVENT, measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener(WINDOW_LAYOUT_EVENT, measure); };
  }, [visible, timer.display, timer.position, onOverlayChange]);

  function display(next) {
    setTimer(current => ({ ...current, display: next }));
    if (next !== "panel") trigger.current?.focus();
  }
  function begin(event) {
    event?.preventDefault();
    const duration = timer.status === "paused" ? timer.durationMs : durationFromFields(fields);
    if (!duration) { setError("Choose a duration from 1 second to 24 hours; minutes and seconds must be 0–59."); return; }
    setError(""); sounded.current = null; prepareSound();
    const currentTime = Date.now(); setNow(currentTime);
    setTimer(current => startTimer(current, currentTime, duration));
  }
  function move(position) {
    const bounds = panel.current.getBoundingClientRect();
    setTimer(current => ({ ...current, position: clampTimerPosition(position, bounds.width, bounds.height, window.innerWidth, window.innerHeight) }));
  }
  function finishDrag(event, cancel = false) {
    if (!drag.current || (event.pointerId !== undefined && drag.current.id !== event.pointerId)) return;
    const previous = drag.current; drag.current = null;
    if (cancel) setTimer(current => ({ ...current, position: previous.position }));
    if (event.currentTarget.hasPointerCapture?.(previous.id)) event.currentTarget.releasePointerCapture(previous.id);
  }
  const moveProps = {
    onPointerDown: event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus();
      const bounds = panel.current.getBoundingClientRect();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: bounds.x, top: bounds.y, position: timer.position };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: event => {
      const current = drag.current;
      if (current?.id === event.pointerId) move({ x: current.left + event.clientX - current.x, y: current.top + event.clientY - current.y });
    },
    onPointerUp: event => finishDrag(event), onPointerCancel: event => finishDrag(event, true), onLostPointerCapture: event => finishDrag(event),
    onKeyDown: event => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); finishDrag(event, true); return; }
      const offsets = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
      if (!offsets[event.key]) return;
      event.preventDefault(); const bounds = panel.current.getBoundingClientRect(), offset = offsets[event.key];
      move({ x: bounds.x + offset[0], y: bounds.y + offset[1] });
    },
    onDoubleClick: () => setTimer(current => ({ ...current, position: null })),
  };
  const finished = timer.status === "finished";
  const time = new Date(now);
  const countdown = formatCountdown(timer.status === "idle" ? durationFromFields(fields) ?? left : left);
  return <>
    <div className="workstation-time" inert={inert}>
      <time className="workstation-clock" dateTime={time.toISOString()} title={time.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })}
        aria-label={`System time ${time.toLocaleTimeString()}`}>{time.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
      <button ref={trigger} type="button" className={`workstation-timer-trigger${finished ? " timer-finished" : ""}`} aria-label="Open timer"
        aria-expanded={timer.display === "panel"} aria-controls="workstation-timer" onClick={() => { prepareSound(); display("panel"); }}
        title="Open the floating timer">{finished ? "Timer finished" : active ? `Timer ${countdown}${timer.status === "paused" ? " · Paused" : ""}` : "Timer"}</button>
    </div>
    {finished && <span className="timer-announcement" role="alert">Timer finished.</span>}
    {visible && <section ref={panel} id="workstation-timer" inert={inert} className={`floating-timer${timer.display === "compact" ? " timer-compact" : ""}${finished ? " timer-finished" : ""}`}
      aria-label={timer.display === "compact" ? "Compact timer" : "Floating timer"}
      style={timer.position ? { left: timer.position.x, top: timer.position.y, right: "auto", bottom: "auto" } : undefined}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); display("hidden"); } }}>
      <header>
        <button type="button" className="timer-move" aria-label="Move timer" title="Drag to move, or use arrow keys. Double-click to reset position." {...moveProps}>⠿</button>
        {timer.display === "compact" ? <button className="timer-expand" type="button" aria-label="Expand timer" onClick={() => display("panel")}>
          {finished ? "Finished" : countdown}{timer.status === "paused" ? " · Paused" : ""}</button> : <strong>Timer</strong>}
        {timer.display === "panel" && <button type="button" className="timer-hide" aria-label="Minimize timer" title="Minimize; countdown keeps running" onClick={() => display("compact")}>−</button>}
        <button type="button" className="timer-hide" aria-label="Close timer panel" title="Hide timer; countdown keeps running" onClick={() => display("hidden")}>×</button>
      </header>
      {timer.display === "panel" && <form onSubmit={begin}>
        <output className="timer-countdown" aria-label="Time remaining" aria-live="off">{countdown}</output>
        <p className="timer-status">{finished ? "Time’s up" : timer.status === "running" ? "Running" : timer.status === "paused" ? "Paused" : "Set a duration"}</p>
        {(timer.status === "idle" || finished) && <div className="timer-duration">{["hours", "minutes", "seconds"].map(field => <label key={field}>
          {field[0].toUpperCase() + field.slice(1)}<input type="number" min="0" max={field === "hours" ? "24" : "59"} step="1" inputMode="numeric"
            value={fields[field]} onChange={event => { setFields(current => ({ ...current, [field]: event.target.value })); setError(""); }} /></label>)}</div>}
        {error && <p className="timer-error" role="alert">{error}</p>}
        {/* Separate keys prevent Pause from becoming a submit button during the same click. */}
        <div className="timer-actions">{timer.status === "running" ? <button key="pause" type="button" onClick={() => {
          const currentTime = Date.now(); setNow(currentTime); setTimer(current => pauseTimer(current, currentTime));
        }}>Pause</button> : <button key="start" type="submit">{timer.status === "paused" ? "Resume" : finished ? "Restart" : "Start"}</button>}
          <button type="button" onClick={() => { setTimer(current => resetTimer(current)); setFields(durationFields(timer.durationMs)); setError(""); }}>Reset</button>
        </div>
        <label className="timer-sound"><input type="checkbox" checked={timer.sound} onChange={event => {
          prepareSound(event.target.checked);
          setTimer(current => ({ ...current, sound: event.target.checked }));
        }} /> Sound when finished</label>
      </form>}
    </section>}
  </>;
}
