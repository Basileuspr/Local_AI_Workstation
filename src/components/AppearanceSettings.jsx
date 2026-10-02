import { useEffect, useRef } from "react";
import { useDispatch, useStore } from "../useStore";
import { appearanceColors, appearanceThemes, codeFonts, defaultAppearance, interfaceFonts, uiContrastRange } from "../appearance";
import "./AppearanceSettings.css";
import WindowRenderingSettings from './WindowRenderingSettings';

export default function AppearanceSettings() {
  const { appearance = defaultAppearance } = useStore();
  const dispatch = useDispatch();
  const update = payload => dispatch({ type: "SET_APPEARANCE", payload });
  const colors = appearanceColors(appearance), contrast = appearance.contrast ?? uiContrastRange.default;
  return <section className="appearance-settings" aria-label="Appearance settings">
    <h2>Appearance</h2>

    <div className="appearance-fields">
      <label>Color theme<select value={appearance.theme} onChange={event => update({ theme: event.target.value })}>
        {Object.entries(appearanceThemes).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
      </select></label>
      <label>Interface font<select value={appearance.font} onChange={event => update({ font: event.target.value })}>
        {Object.entries(interfaceFonts).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
      </select></label>
      <label>Code and data font<select value={appearance.codeFont} onChange={event => update({ codeFont: event.target.value })}>
        {Object.entries(codeFonts).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
      </select></label>
    </div>
    <div className="appearance-contrast">
      <div className="appearance-contrast-heading"><label htmlFor="ui-contrast">UI contrast</label>
        <output htmlFor="ui-contrast">{contrast}%{contrast === uiContrastRange.default ? " · Default" : ""}</output>
        <button type="button" disabled={contrast === uiContrastRange.default} onClick={() => update({ contrast: uiContrastRange.default })}>Reset contrast</button></div>
      <input id="ui-contrast" type="range" min={uiContrastRange.min} max={uiContrastRange.max} step={uiContrastRange.step} value={contrast}
        aria-valuetext={`${contrast}% UI contrast${contrast === uiContrastRange.default ? ", default" : ""}`}
        onChange={event => update({ contrast: Number(event.target.value) })} />
      <div className="appearance-contrast-scale" aria-hidden="true"><span>Softer</span><span>Stronger</span></div>

    </div>
    <div className="appearance-preview" aria-label="Appearance preview">
      <div className="appearance-swatches" aria-hidden="true">{["bg-primary", "bg-card", "accent", "text"].map(key => <span key={key} style={{ background: colors[key] }} />)}</div>
      <strong>Your workspace, your style</strong>
      <p>Aa Bb Cc · The quick brown fox jumps over the lazy dog.</p>
      <code>const message = "Hello, world!"; 0123456789</code>
    </div>
    <WindowRenderingSettings />
    <div className="appearance-footer">
      <button type="button" onClick={() => dispatch({ type: "RESET_APPEARANCE" })}>Reset appearance</button>
    </div>
  </section>;
}

export function AppearanceDialog({ onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node.open) node.showModal();
  }, []);
  return <dialog ref={dialog} className="appearance-dialog" aria-label="Application appearance" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) dialog.current.close(); }}>
    <header><strong>Application settings</strong><button type="button" aria-label="Close appearance settings" onClick={() => dialog.current.close()}>Close</button></header>
    <AppearanceSettings />
  </dialog>;
}
