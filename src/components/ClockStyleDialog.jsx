import { useEffect, useRef, useState } from 'react';
import { clockAppearanceVariables, clockFonts, clockSizes, clockStyles, clockThemes, clockTimeOptions,
  defaultClockAppearance } from '../clockAppearance';

export function ClockFace({ time, appearance }) {
  return <time className="clock-face" dateTime={time.toISOString()} aria-label={`System time ${time.toLocaleString()}`}>
    <span className="clock-time-value">{time.toLocaleTimeString(undefined, clockTimeOptions(appearance))}</span>
    {appearance.date && <span className="clock-date-value">{time.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>}
  </time>;
}

function ClockColorField({ label, value, onChange }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  function edit(next) {
    setDraft(next);
    if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toLowerCase());
  }
  return <label>{label}<div className="clock-color-input">
    <input type="color" aria-label={`Clock ${label.toLowerCase()} picker`} value={value}
      onInput={event => onChange(event.currentTarget.value)} onChange={event => onChange(event.target.value)} />
    <input className="clock-color-hex" type="text" aria-label={`Clock ${label.toLowerCase()}`} value={draft} maxLength={7}
      spellCheck={false} placeholder="#rrggbb" onChange={event => edit(event.target.value)} onBlur={() => setDraft(value)} />
  </div></label>;
}

export default function ClockStyleDialog({ appearance, onChange, time, onClose }) {
  const dialog = useRef(null);
  useEffect(() => { if (!dialog.current.open) dialog.current.showModal(); }, []);
  const update = changes => onChange(current => ({ ...current, ...changes }));
  return <dialog ref={dialog} className="clock-style-dialog" aria-label="Clock style" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) dialog.current.close(); }}>
    <header><div><h2>Clock style</h2><p>Changes apply immediately and save automatically.</p></div>
      <button type="button" aria-label="Close clock style" onClick={() => dialog.current.close()}>Close</button></header>
    <div className="clock-preview" aria-label="Clock preview">
      <div className={`styled-clock clock-${appearance.style}`} style={clockAppearanceVariables(appearance)}><ClockFace time={time} appearance={appearance} /></div>
    </div>
    <div className="clock-style-fields">
      <label>Clock style<select value={appearance.style} onChange={event => update({ style: event.target.value })}>
        {Object.entries(clockStyles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>Clock theme<select value={appearance.theme} onChange={event => update({ theme: event.target.value, customColors: false })}>
        {Object.entries(clockThemes).map(([id, theme]) => <option key={id} value={id}>{theme.label}</option>)}
      </select></label>
      <label>Clock font<select value={appearance.font} onChange={event => update({ font: event.target.value })}>
        {Object.entries(clockFonts).map(([id, font]) => <option key={id} value={id}>{font.label}</option>)}
      </select></label>
      <label>Font size<select value={appearance.size} onChange={event => update({ size: Number(event.target.value) })}>
        {clockSizes.map(size => <option key={size} value={size}>{size} px</option>)}
      </select></label>
    </div>
    <fieldset className="clock-color-fields"><legend>Colors</legend>
      <label className="clock-check"><input type="checkbox" checked={appearance.customColors} onChange={event => update({ customColors: event.target.checked })} />Use custom colors</label>
      <div className="clock-style-fields">
        <ClockColorField label="Text color" value={appearance.textColor} onChange={textColor => update({ textColor, customColors: true })} />
        <ClockColorField label="Background color" value={appearance.backgroundColor} onChange={backgroundColor => update({ backgroundColor, customColors: true })} />
      </div>
    </fieldset>
    <div className="clock-style-fields">
      <label>Time format<select value={appearance.format} onChange={event => update({ format: event.target.value })}>
        <option value="system">System default</option><option value="12">12 hour</option><option value="24">24 hour</option>
      </select></label>
      <div className="clock-checks">
        <label className="clock-check"><input type="checkbox" checked={appearance.bold} onChange={event => update({ bold: event.target.checked })} />Bold digits</label>
        <label className="clock-check"><input type="checkbox" checked={appearance.seconds} onChange={event => update({ seconds: event.target.checked })} />Show seconds</label>
        <label className="clock-check"><input type="checkbox" checked={appearance.date} onChange={event => update({ date: event.target.checked })} />Show date</label>
      </div>
    </div>
    <footer><button type="button" onClick={() => onChange({ ...defaultClockAppearance })}>Reset clock style</button></footer>
  </dialog>;
}
