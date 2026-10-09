import { CAPTION_FORMATS, DEFAULT_CAPTION_LABELS, captionsIn, captionContext, captionSettings, crossReferenceTargets, crossReferenceText, moveCaption } from '../documentCaptions';
import { goToReference } from '../documentReferences';

export function CaptionsRibbon({ editor, disabled, openDialog, Group, Button }) {
  const { captions, references } = captionsIn(editor.state.doc), targets = crossReferenceTargets(editor.state.doc);
  const missing = references.filter(item => !targets.has(item.target)).length;
  return <Group name="Captions & Cross-references">
    <Button label="Insert caption" disabled={disabled} onClick={() => openDialog('Insert caption', { label:'Figure', text:'', position:'after' })}>Insert caption…</Button>
    <Button label="Manage captions" onClick={() => openDialog('Manage captions')}>Manage captions…</Button>
    <Button label="Caption numbering" disabled={disabled} onClick={() => openDialog('Caption numbering', { label:'Figure', ...(captionSettings(editor.state.doc).Figure || { format:'decimal', start:1 }) })}>Numbering…</Button>
    <Button label="Insert cross-reference" disabled={disabled || !targets.size} onClick={() => openDialog('Insert cross-reference', { target:targets.keys().next().value, display:'full', hyperlink:true })}>Cross-reference…</Button>
    <Button label="Check cross-references" onClick={() => openDialog('Check cross-references')}>Check references{missing ? ` (${missing})` : ''}</Button>
    <span className="de-shortcut">{captions.length} captions · live numbering</span>
  </Group>;
}
export function CaptionFields({ editor, fields, setFields, disabled, inserting }) {
  const labels = [...new Set([...DEFAULT_CAPTION_LABELS, ...Object.keys(captionSettings(editor.state.doc)), ...captionsIn(editor.state.doc).captions.map(item => item.label)])];
  const custom = fields.custom || !labels.includes(fields.label);
  return <><fieldset disabled={disabled} className="de-caption-fields">
    <label>Caption label<select value={custom ? '__custom' : fields.label} onChange={event => setFields({ ...fields, label:event.target.value === '__custom' ? '' : event.target.value, custom:event.target.value === '__custom', invalid:'' })}>{labels.map(label => <option key={label}>{label}</option>)}<option value="__custom">Custom label…</option></select></label>
    {custom && <label>Custom label<input required maxLength={30} value={fields.label} onChange={event => setFields({ ...fields, label:event.target.value, invalid:'' })}/></label>}
    <label>Caption text<input maxLength={1000} value={fields.text} onChange={event => setFields({ ...fields, text:event.target.value, invalid:'' })}/></label>
    {inserting && <label>Caption position<select value={fields.position} onChange={event => setFields({ ...fields, position:event.target.value })}><option value="after">Below current picture, table or paragraph</option><option value="before">Above current picture, table or paragraph</option></select></label>}
    </fieldset><p>Numbering is continuous for each label. Captions are independent blocks; moving the related picture or table does not move its caption automatically. Caption edits and numbering support Undo.</p>
    {fields.invalid && <p role="alert">{fields.invalid}</p>}</>;
}
export function CaptionNumberFields({ editor, fields, setFields }) {
  const labels = [...new Set([...DEFAULT_CAPTION_LABELS, ...Object.keys(captionSettings(editor.state.doc)), ...captionsIn(editor.state.doc).captions.map(item => item.label)])];
  return <><label>Numbering label<select value={fields.label} onChange={event => setFields({ label:event.target.value, ...(captionSettings(editor.state.doc)[event.target.value] || { format:'decimal', start:1 }) })}>{labels.map(label => <option key={label}>{label}</option>)}</select></label>
    <label>Number format<select value={fields.format} onChange={event => setFields({ ...fields, format:event.target.value })}>{CAPTION_FORMATS.map(([id,text]) => <option key={id} value={id}>{text}</option>)}</select></label>
    <label>Start at<input required type="number" min={1} max={9999} step={1} value={fields.start} onChange={event => setFields({ ...fields, start:event.target.value })}/></label>
    <p>Updates all captions with this label and their cross-references. Chapter numbering and per-section restarts are upcoming pieces.</p>{fields.invalid && <p role="alert">{fields.invalid}</p>}</>;
}
export function CaptionManager({ editor, disabled, openDialog }) {
  const { captions } = captionContext(editor.state.doc), refs = captionsIn(editor.state.doc).references;
  return <><p>Click a caption in the document or Edit here to change its label or text. Deleting it retains references as visible repair placeholders.</p><ul className="de-reference-list">{captions.map(item => <li key={item.id}><strong>{item.full}</strong><span>{refs.filter(ref => ref.target === item.id).length} cross-references</span>
    <button type="button" aria-label={`Go to caption ${item.labelNumber}`} onClick={() => goToReference(editor,item.id)}>Go to</button>
    <button type="button" disabled={disabled} aria-label={`Edit caption ${item.labelNumber}`} onClick={() => openDialog('Edit caption', { ...item.node.attrs })}>Edit</button>
    <button type="button" disabled={disabled || item.pos === 0} aria-label={`Move caption ${item.labelNumber} up`} onClick={() => moveCaption(editor,item.id,-1)}>Move up</button>
    <button type="button" disabled={disabled || item.pos + item.node.nodeSize === editor.state.doc.content.size} aria-label={`Move caption ${item.labelNumber} down`} onClick={() => moveCaption(editor,item.id,1)}>Move down</button></li>)}</ul>{!captions.length && <p>No captions yet. Place the cursor in a paragraph or select a picture/table, then Insert caption.</p>}</>;
}
export function CrossReferenceFields({ editor, fields, setFields, disabled }) {
  const targets = crossReferenceTargets(editor.state.doc), current = targets.get(fields.target);
  return <><fieldset disabled={disabled} className="de-caption-fields"><label>Reference to<select value={fields.target || ''} required onChange={event => setFields({ ...fields, target:event.target.value, display:'full', invalid:'' })}>
    {!targets.has(fields.target) && <option value={fields.target || ''}>{fields.target ? `Missing: ${fields.target}` : 'Choose a destination…'}</option>}
    {[...targets].map(([id,item]) => <option key={id} value={id}>{item.kind === 'caption' ? 'Caption: ' : item.kind === 'heading' ? 'Heading: ' : 'Bookmark: '}{item.full}</option>)}</select></label>
    <label>Reference display<select value={fields.display} onChange={event => setFields({ ...fields, display:event.target.value })}><option value="full">{current?.kind === 'caption' ? 'Entire caption' : current?.kind === 'bookmark' ? 'Bookmark name' : 'Heading text'}</option>{(current?.kind === 'caption' || !current) && <><option value="labelNumber">Label and number</option><option value="number">Number only</option><option value="text">Caption text only</option></>}</select></label>
    <label><input type="checkbox" checked={fields.hyperlink} onChange={event => setFields({ ...fields, hyperlink:event.target.checked })}/> Insert as hyperlink</label></fieldset>
    <p className="de-citation-preview">Preview: {fields.target ? crossReferenceText(fields,editor.state.doc) : 'Choose a destination'}</p>
    <p>Selected text stays in place. Click a reference to edit it; Ctrl+click follows a hyperlink. Read-only hyperlinks navigate with a plain click. Bookmark references display the bookmark name; these are point bookmarks.</p>{fields.invalid && <p role="alert">{fields.invalid}</p>}</>;
}
export function CrossReferenceCheck({ editor, disabled, openDialog }) {
  const targets = crossReferenceTargets(editor.state.doc), { references } = captionsIn(editor.state.doc), missing = references.filter(item => !targets.has(item.target));
  return <><p>{references.length} cross-references · {missing.length} missing destinations.</p><ul className="de-reference-list">{references.map(item => <li key={item.id}><strong>{crossReferenceText(item,editor.state.doc)}</strong>
    <button type="button" disabled={!targets.has(item.target)} onClick={() => goToReference(editor,item.target)}>Go to destination</button>
    <button type="button" aria-label={`Inspect cross-reference ${crossReferenceText(item,editor.state.doc)}`} onClick={() => openDialog('Edit cross-reference', { ...item.node.attrs })}>{disabled ? 'Inspect' : 'Edit / retarget'}</button></li>)}</ul>{!references.length && <p>No cross-references yet.</p>}<p>Retarget or delete references whose destination was removed, or Undo the deletion. This check makes no network requests.</p></>;
}
