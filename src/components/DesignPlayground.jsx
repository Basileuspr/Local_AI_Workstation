import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useStore } from '../useStore';
import { accentColors, appearanceThemes, appearanceVariables, buttonOptions, codeFonts, cornerOptions, densityOptions, interfaceFonts, motionOptions, normalizeAppearance, surfaceOptions, uiContrastRange } from '../appearance';
import { DESIGN_DRAFT_KEY, DESIGN_PRESETS_KEY, designCSS, designDocument, designExampleCSS, designHTML, designLayouts, designTemplates, designWidths, loadDesign, loadDesignPresets, normalizeDesign, parseDesign, serializeDesign } from '../designPlayground';
import { filterStylingExamples, stylingCategories, stylingExamples } from '../stylingLibrary';
import { previewDocument } from '../codePreview';
import { downloadBlob } from '../downloadBlob';
import './DesignPlayground.css';

function SelectField({ label, value, options, onChange }) {
  return <label className="dp-field">{label}<select value={value} onChange={event => onChange(event.target.value)}>
    {Object.entries(options).map(([id, item]) => <option key={id} value={id}>{typeof item === 'string' ? item : item.label}</option>)}
  </select></label>;
}

export default function DesignPlayground({ active = true, incomingExample, onEdit }) {
  const { appearance } = useStore(), dispatch = useDispatch();
  const [draft, setDraft] = useState(() => loadDesign(appearance));
  const [presets, setPresets] = useState(loadDesignPresets);
  const [name, setName] = useState(''), [preset, setPreset] = useState('');
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All');
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [storageError, setStorageError] = useState('');
  const [undo, setUndo] = useState(null);
  const file = useRef(null);
  const applied = normalizeAppearance(appearance);
  const sameAppearance = JSON.stringify(draft.appearance) === JSON.stringify(applied);
  const canUndo = undo && JSON.stringify(undo.applied) === JSON.stringify(applied);
  const document = useMemo(() => designDocument(draft), [draft.appearance, draft.layout]);
  const examples = filterStylingExamples({ query, category });
  const selected = draft.pieces.map(id => stylingExamples.find(example => example.id === id));

  useEffect(() => {
    try { localStorage.setItem(DESIGN_DRAFT_KEY, JSON.stringify(draft)); setStorageError(''); }
    catch { setStorageError('This draft could not be saved locally. Export the design to keep it.'); }
  }, [draft]);
  useEffect(() => {
    if (!stylingExamples.some(example => example.id === incomingExample?.id)) return;
    setDraft(current => ({ ...current, pieces: [...new Set([...current.pieces, incomingExample.id])] }));
    setNotice('Example added to the component board below.');
  }, [incomingExample]);

  function updateAppearance(patch) { setDraft(current => ({ ...current, appearance: normalizeAppearance({ ...current.appearance, ...patch }) })); setNotice(''); }
  function togglePiece(id) { setDraft(current => ({ ...current, pieces: current.pieces.includes(id) ? current.pieces.filter(piece => piece !== id) : [...current.pieces, id] })); }
  function movePiece(index, offset) {
    setDraft(current => { const pieces = [...current.pieces]; const [item] = pieces.splice(index, 1); pieces.splice(index + offset, 0, item); return { ...current, pieces }; });
  }
  function persistPresets(next) {
    try { localStorage.setItem(DESIGN_PRESETS_KEY, JSON.stringify(next)); setPresets(next); setError(''); return true; }
    catch { setError('The preset could not be saved locally. Export the design to keep a copy.'); return false; }
  }
  function savePreset() {
    const title = name.trim();
    if (!title) return;
    if (presets.length >= 30 && !presets.some(item => item.name === title)) { setError('You can keep 30 saved presets. Replace or delete one first.'); return; }
    const next = [...presets.filter(item => item.name !== title), { name: title, design: normalizeDesign(draft) }];
    if (persistPresets(next)) { setPreset(title); setNotice(`Saved “${title}” on this device.`); }
  }
  async function importFile(selectedFile) {
    if (!selectedFile) return;
    setError(''); setNotice('');
    try {
      if (selectedFile.size > 100000) throw new Error('Choose a design file under 100 KB.');
      setDraft(parseDesign(await selectedFile.text())); setPreset(''); setNotice('Design imported into the playground.');
    } catch (failure) { setError(failure.message); }
  }
  function openPreviewCode(kind) {
    onEdit?.({ kind, text: kind === 'css' ? designCSS(draft) : designDocument(draft), html: designHTML(draft), url: 'UI Playground · current preview' });
  }

  return <section className="design-playground" aria-label="UI customization playground">
    <div className="dp-intro"><div><h2>Your interface, piece by piece.</h2><p>Start with a template, then mix colors, type, spacing, and components.</p></div><span className="dp-draft-state">{sameAppearance ? 'Matches app appearance' : 'Previewing a draft'}</span></div>
    <section className="dp-templates" aria-label="Starting templates">{designTemplates.map(template => {
      const normalized = normalizeAppearance(template.appearance), colors = appearanceVariables(normalized);
      const selected = JSON.stringify(draft.appearance) === JSON.stringify(normalized);
      return <button type="button" key={template.id} className="dp-template" aria-pressed={selected} onClick={() => { setDraft(current => ({ ...current, appearance: normalized })); setPreset(''); setNotice(`${template.name} template loaded. Adjust any piece below.`); }}>
        <span className="dp-template-art" aria-hidden="true" style={{ background: colors['--bg-primary'], '--template-accent': colors['--accent'], '--template-panel': colors['--bg-card'], '--template-radius': colors['--ui-radius'] }}><i /><i /><i /></span>
        <strong>{template.name}</strong><span>{template.description}</span>
      </button>;
    })}</section>

    <div className="dp-workbench">
      <aside className="dp-controls" aria-label="Design controls">
        <section className="dp-control-section"><h3><span>01</span> Color &amp; type</h3>
          <SelectField label="Color theme" value={draft.appearance.theme} options={appearanceThemes} onChange={theme => updateAppearance({ theme })} />
          <fieldset className="dp-accent"><legend>Accent color</legend><div>{Object.entries(accentColors).map(([id, item]) => <button key={id} type="button" aria-label={`${item.label} accent`} title={item.label} aria-pressed={draft.appearance.accent === id}
            style={{ '--swatch': id === 'theme' ? appearanceThemes[draft.appearance.theme].colors.accent : item[appearanceThemes[draft.appearance.theme].scheme] }} onClick={() => updateAppearance({ accent: id })}><span aria-hidden="true">{draft.appearance.accent === id ? '✓' : ''}</span></button>)}</div></fieldset>
          <SelectField label="Interface font" value={draft.appearance.font} options={interfaceFonts} onChange={font => updateAppearance({ font })} />
          <SelectField label="Code and data font" value={draft.appearance.codeFont} options={codeFonts} onChange={codeFont => updateAppearance({ codeFont })} />
          <label className="dp-field">UI contrast <span>{draft.appearance.contrast}%</span><input type="range" min={uiContrastRange.min} max={uiContrastRange.max} step={uiContrastRange.step} value={draft.appearance.contrast}
            aria-label="Preview UI contrast" aria-valuetext={`${draft.appearance.contrast}%`} onChange={event => updateAppearance({ contrast: Number(event.target.value) })} /></label>
        </section>
        <section className="dp-control-section"><h3><span>02</span> Shape &amp; rhythm</h3>
          <SelectField label="Corner treatment" value={draft.appearance.corners} options={cornerOptions} onChange={corners => updateAppearance({ corners })} />
          <SelectField label="Information density" value={draft.appearance.density} options={densityOptions} onChange={density => updateAppearance({ density })} />
          <SelectField label="Card surfaces" value={draft.appearance.surface} options={surfaceOptions} onChange={surface => updateAppearance({ surface })} />
          <SelectField label="Action buttons" value={draft.appearance.buttons} options={buttonOptions} onChange={buttons => updateAppearance({ buttons })} />
          <SelectField label="Motion" value={draft.appearance.motion} options={motionOptions} onChange={motion => updateAppearance({ motion })} />
        </section>
      </aside>

      <div className="dp-preview-column">
        <section className="dp-preview-panel" aria-label="Live design preview">
          <header className="dp-preview-toolbar"><strong>Interactive styling playground</strong><span>LIVE PREVIEW</span></header>
          <div className="dp-preview-options"><SelectField label="Sample layout" value={draft.layout} options={designLayouts} onChange={layout => setDraft(current => ({ ...current, layout }))} />
            <SelectField label="Preview width" value={draft.width} options={designWidths} onChange={width => setDraft(current => ({ ...current, width }))} /></div>
          <div className={`dp-preview-stage dp-width-${draft.width}`}>{active && <iframe name="design-preview" title="Live UI design preview" sandbox="" referrerPolicy="no-referrer" srcDoc={document} />}</div>
          <div className="dp-preview-footer"><span>Try the fields, focus states, and buttons.</span><div><button type="button" onClick={() => openPreviewCode('css')}>Open preview CSS</button><button type="button" onClick={() => openPreviewCode('html')}>Open preview HTML</button></div></div>
        </section>
        <section className="dp-apply-panel"><div><h3>Bring this look into your app</h3><p>Apply colors, fonts, contrast, and shared control treatments. Sample layouts and library components stay in the playground.</p></div>
          <div className="dp-actions"><button type="button" className="dp-apply" disabled={sameAppearance} onClick={() => { setUndo({ previous: applied, applied: draft.appearance }); dispatch({ type: 'SET_APPEARANCE', payload: draft.appearance }); setNotice('Appearance applied to the app.'); }}>Apply to app</button>
            <button type="button" disabled={!canUndo} onClick={() => { dispatch({ type: 'SET_APPEARANCE', payload: undo.previous }); setUndo(null); setNotice('Previous app appearance restored. Your draft is still available.'); }}>Undo application</button>
            <button type="button" onClick={() => { setDraft(current => ({ ...current, appearance: applied })); setNotice('Current app appearance loaded into the preview.'); }}>Use app appearance</button></div>
        </section>
        <details className="dp-saved"><summary>Save, load &amp; export designs <span>{presets.length} saved</span></summary><div className="dp-saved-content">
          <div className="dp-save-row"><label className="dp-field">Preset name<input value={name} maxLength={60} placeholder="My workstation look" onChange={event => setName(event.target.value)} /></label><button type="button" disabled={!name.trim()} onClick={savePreset}>{presets.some(item => item.name === name.trim()) ? 'Replace named preset' : 'Save preset'}</button></div>
          <SelectField label="Saved designs" value={preset} options={{ '': 'Choose a saved design', ...Object.fromEntries(presets.map(item => [item.name, item.name])) }} onChange={setPreset} />
          <div className="dp-actions"><button type="button" disabled={!preset} onClick={() => { const saved = presets.find(item => item.name === preset); if (saved) { setDraft(normalizeDesign(saved.design)); setName(saved.name); setNotice(`Loaded “${saved.name}” into the playground.`); } }}>Load design</button>
            <button type="button" disabled={!preset} onClick={() => { if (persistPresets(presets.filter(item => item.name !== preset))) { setPreset(''); setNotice('Saved preset removed. The current draft is unchanged.'); } }}>Delete saved preset</button></div>
          <div className="dp-actions"><button type="button" onClick={() => downloadBlob(new Blob([serializeDesign(draft)], { type: 'application/json' }), 'workstation-design.json')}>Export design JSON</button>
            <button type="button" onClick={() => file.current.click()}>Import design JSON</button><button type="button" onClick={() => downloadBlob(new Blob([document], { type: 'text/html;charset=utf-8' }), 'workstation-preview.html')}>Save preview HTML</button></div>
          <input type="file" ref={file} hidden accept=".json,application/json" onChange={event => { void importFile(event.target.files[0]); event.target.value = ''; }} />
        </div></details>
      </div>
    </div>
    <div className="dp-feedback" aria-live="polite">{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}{storageError && <p role="alert">{storageError}</p>}</div>
    <section className="dp-components" aria-label="Component comparison board">
      <div className="dp-board-heading"><div><span className="design-eyebrow">03 · MIX YOUR COMPONENTS</span><h2>Build a comparison board</h2><p>Combine any of the {stylingExamples.length} library examples using your current colors and type.</p></div><span className="dp-draft-state">{selected.length} selected</span></div>
      <details className="dp-component-picker"><summary>Add or remove components</summary><div className="dp-picker-filters"><label className="dp-field">Find a component<input type="search" value={query} placeholder="Buttons, cards, animations…" onChange={event => setQuery(event.target.value)} /></label>
        <SelectField label="Component category" value={category} options={Object.fromEntries(['All', ...stylingCategories].map(name => [name, name]))} onChange={setCategory} /></div>
        <div className="dp-piece-options">{examples.map(example => <label key={example.id}><input type="checkbox" checked={draft.pieces.includes(example.id)} onChange={() => togglePiece(example.id)} /><span>{example.title}<small>{example.category}</small></span></label>)}</div>
        {!examples.length && <p>No matching components.</p>}
      </details>
      <div className="dp-board">{selected.map((example, index) => <article key={example.id} className="dp-piece"><header><div><span>{example.category}</span><h3>{example.title}</h3></div><div className="dp-piece-order">
        <button type="button" disabled={index === 0} aria-label={`Move ${example.title} earlier`} onClick={() => movePiece(index, -1)}>↑</button><button type="button" disabled={index === selected.length - 1} aria-label={`Move ${example.title} later`} onClick={() => movePiece(index, 1)}>↓</button><button type="button" aria-label={`Remove ${example.title}`} onClick={() => togglePiece(example.id)}>×</button></div></header>
        {active && <iframe title={`${example.title} mixed preview`} loading="lazy" sandbox="" referrerPolicy="no-referrer" srcDoc={previewDocument(example.html, designExampleCSS(example, draft))} />}
        <footer><button type="button" onClick={() => onEdit?.({ kind: 'css', text: designExampleCSS(example, draft), html: example.html, url: `UI Playground · ${example.title}` })}>Edit component CSS ↗</button></footer></article>)}</div>
      {!selected.length && <p className="dp-empty">Add components above, or send an example here from the Styling Library.</p>}
    </section>
  </section>;
}
