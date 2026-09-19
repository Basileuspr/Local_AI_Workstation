import { adjustNumber, imageSizes, seedMax } from "../imageSettingsControls";

function NumberControl({ name, value, min, max, step = 1, increments, presets = [], onChange, random = false }) {
  return <div className="image-number-control">
    <label>{name}<input aria-label={name} type="number" min={min} max={max} step={step} value={value} placeholder={random ? "Random" : undefined} onChange={event => onChange(event.target.value)} /></label>
    <div className="image-quick-buttons" role="group" aria-label={`${name} presets`}>
      {presets.map(preset => <button type="button" key={preset} onClick={() => onChange(preset)}>{preset}</button>)}
      {random && <button type="button" onClick={() => onChange("")}>Random</button>}
    </div>
    <div className="image-quick-buttons" role="group" aria-label={`Adjust ${name.toLowerCase()}`}>
      {[-1, 1].map(sign => increments.map(amount => <button type="button" key={sign * amount}
        aria-label={`${name} ${sign > 0 ? "plus" : "minus"} ${amount}`} onClick={() => onChange(adjustNumber(value, sign * amount, min, max))}>{sign > 0 ? "+" : "−"}{amount}</button>))}
    </div>
  </div>;
}

export default function ImageSettingsControls({ settings, onChange }) {
  const size = `${settings.width}x${settings.height}`;
  const known = imageSizes.some(item => `${item.width}x${item.height}` === size);
  return <>
    <label>Aspect ratio<select aria-label="Aspect ratio" value={size} onChange={event => {
      const [width, height] = event.target.value.split("x").map(Number);
      onChange({ width, height });
    }}>
      {!known && <option value={size} disabled>Saved custom size · {settings.width} × {settings.height} — choose a preset</option>}
      {imageSizes.map(item => <option key={item.label} value={`${item.width}x${item.height}`}>{item.label} · {item.width} × {item.height}</option>)}
    </select></label>
    <div className="image-settings-grid">
      <NumberControl name="Steps" value={settings.steps} min={1} max={60} increments={[1, 5, 10, 15]} presets={[10, 20, 30, 40, 50, 60]} onChange={steps => onChange({ steps })} />
      <NumberControl name="Guidance" value={settings.guidanceScale} min={1} max={20} step={0.1} increments={[0.1, 0.5, 1, 2]} presets={[3, 5.5, 7, 10, 15, 20]} onChange={guidanceScale => onChange({ guidanceScale })} />
      <NumberControl name="Seed" value={settings.seed} min={0} max={seedMax} increments={[1, 10, 100, 1000]} random onChange={seed => onChange({ seed })} />
    </div>
    <small>Adjustments stop at each setting's limits. Random seed chooses a new seed per image; seed jumps change the starting noise, not image strength.</small>
  </>;
}
