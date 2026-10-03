import { DEFAULT_STYLES, DOCUMENT_FONTS, documentStyles, currentStyle, paragraphStyle, selectedParagraphs, applyParagraphStyle, stylePreview, MAX_CUSTOM_STYLES } from '../documentStyles';

export function StylesRibbon({ editor, disabled, open, onToggle, Group, Button }) {
  const styles = documentStyles(editor.state.doc), selected = new Set(selectedParagraphs(editor.state).map(({ node }) => paragraphStyle(editor.state.doc, node).id));
  const value = selected.size === 1 ? [...selected][0] : '';
  return <Group name="Styles" className="de-styles-group"><div className="de-style-gallery">
    {['normal', 'heading-1', 'heading-2', 'quote'].map(id => { const style = styles.find(item => item.id === id); return <Button key={id} label={style.name} active={value === id} disabled={disabled || !selected.size} className="de-style" onClick={() => applyParagraphStyle(editor, id)}><span style={{ ...stylePreview(style), fontSize: Math.min(16, style.fontSize) }}>{style.name}</span></Button>; })}
    </div><div className="de-row"><select aria-label="Paragraph style" disabled={disabled || !selected.size} value={value} onChange={event => applyParagraphStyle(editor, event.target.value)}><option value="" disabled>{selected.size ? 'Mixed styles' : 'Select a paragraph'}</option>{styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}</select>
      <Button label="Show styles pane" active={open} onClick={onToggle}>Styles…</Button></div></Group>;
}

export function StylesPane({ editor, disabled, onClose, onCreate, onEdit, onDelete }) {
  const styles = documentStyles(editor.state.doc), current = currentStyle(editor), hasParagraph = !!selectedParagraphs(editor.state).length;
  const custom = !DEFAULT_STYLES.some(style => style.id === current.id);
  const count = selectedParagraphs(editor.state).length;
  return <aside className="de-styles-pane" aria-label="Paragraph styles">
    <div className="de-style-pane-tools"><header><h2>Styles</h2><button aria-label="Close styles pane" onClick={onClose}>×</button></header>
    <p>Apply to the current paragraph or selection.</p>
    <div className="de-style-actions"><button disabled={disabled || styles.length >= DEFAULT_STYLES.length + MAX_CUSTOM_STYLES} onClick={onCreate}>New style…</button><button disabled={disabled || !hasParagraph} onClick={() => onEdit(current)}>Modify style…</button>
      <button disabled={disabled || !hasParagraph} onMouseDown={event => event.preventDefault()} onClick={() => applyParagraphStyle(editor, current.id, true)}>Reset to style</button><button disabled={disabled || !custom} onClick={() => onDelete(current)}>Delete style…</button></div></div>
    <div className="de-styles-list">{styles.map(style => <button key={style.id} type="button" aria-label={`Apply ${style.name} style`} aria-pressed={hasParagraph && current.id === style.id} disabled={disabled || !hasParagraph} onMouseDown={event => event.preventDefault()} onClick={() => applyParagraphStyle(editor, style.id)}>
      <span style={{ ...stylePreview(style), fontSize: Math.min(19, style.fontSize) }}>{style.name}</span><small>{style.level ? `Heading level ${style.level}` : 'Paragraph'}</small>
    </button>)}</div>
    <p>{hasParagraph ? `${count} paragraph${count === 1 ? '' : 's'} selected.` : 'Place the cursor in a paragraph to apply a style.'} Direct text formatting is kept when applying a style. Reset to style clears those overrides and keeps links.</p>
  </aside>;
}

export function ParagraphStyleFields({ fields, setFields, creating }) {
  const builtin = DEFAULT_STYLES.some(style => style.id === fields.id);
  const change = (key, value) => setFields(previous => ({ ...previous, [key]: value, error: '' }));
  return <>
    <label>Name<input aria-label="Style name" required maxLength={60} value={fields.name} disabled={builtin} onChange={event => change('name', event.target.value)}/></label>
    <div className="de-setting-grid"><label>Font<select aria-label="Style font" value={fields.fontFamily} onChange={event => change('fontFamily', event.target.value)}>{DOCUMENT_FONTS.map(font => <option key={font}>{font}</option>)}</select></label>
      <label>Size (pt)<input aria-label="Style font size" type="number" required min={6} max={96} step={.5} value={fields.fontSize} onChange={event => change('fontSize', event.target.value)}/></label></div>
    <div className="de-setting-row"><label><input type="checkbox" checked={fields.bold} onChange={event => change('bold', event.target.checked)}/>Bold</label><label><input type="checkbox" checked={fields.italic} onChange={event => change('italic', event.target.checked)}/>Italic</label>
      <label>Color<input className="de-style-hex" aria-label="Style text color" pattern="#[0-9a-fA-F]{6}" required maxLength={7} value={fields.color} onChange={event => change('color', event.target.value)} title="Six-digit hexadecimal color, for example #2F5496"/></label></div>
    <div className="de-setting-grid"><label>Alignment<select aria-label="Style paragraph alignment" value={fields.textAlign} onChange={event => change('textAlign', event.target.value)}>{['left', 'center', 'right', 'justify'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Heading level<select aria-label="Style heading level" disabled={!creating} value={fields.level} onChange={event => change('level', event.target.value)}><option value={0}>Body text</option>{[1, 2, 3].map(value => <option key={value} value={value}>Heading {value}</option>)}</select></label>
      {[['spaceBefore', 'Space before (pt)', 0, 72], ['spaceAfter', 'Space after (pt)', 0, 72], ['lineSpacing', 'Line spacing', 1, 3], ['indent', 'Left indent (in)', 0, 1.5]].map(([key, label, min, max]) => <label key={key}>{label}<input aria-label={`Style ${label}`} type="number" required min={min} max={max} step="any" value={key === 'indent' ? fields.indent / 4 : fields[key]} onChange={event => change(key, key === 'indent' ? Number(event.target.value) * 4 : event.target.value)}/></label>)}</div>
    <div className="de-style-preview" style={stylePreview({ ...fields, fontSize: Math.min(36, Math.max(6, Number(fields.fontSize) || 12)) })}>The quick brown fox jumps over the lazy dog.</div>
    {creating ? <label><input type="checkbox" checked={fields.apply} onChange={event => change('apply', event.target.checked)}/>Apply to selected paragraphs</label> : <p className="de-setting-hint">Changes update every paragraph using this style. Direct formatting remains in place. Use Reset to style to remove overrides.</p>}
    {fields.error && <p role="alert" className="de-warning">{fields.error}</p>}
  </>;
}
