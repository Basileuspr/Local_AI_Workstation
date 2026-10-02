import { useState } from 'react';

export default function LocalDocument({ file, onSaved, onDirty, busy, run }) {
  const [changes, setChanges] = useState({}), [acknowledged, setAcknowledged] = useState(false);
  function edit(original, patch) {
    setChanges(previous => ({...previous, [original.id]: {...original, ...previous[original.id], ...patch}}));
    onDirty(true);
  }
  function paragraph(block, index) {
    return <div className="local-paragraph" key={index}>
      <small>{block.style}</small>
      {block.runs.map((original, i) => {
        const value = changes[original.id] || original;
        return original.editable ? <div className="local-run" key={original.id}>
          <textarea aria-label={`Text run ${original.id}`} value={value.text} disabled={busy}
            style={{fontWeight: value.bold ? 'bold' : undefined, fontStyle: value.italic ? 'italic' : undefined}}
            rows={Math.min(8, Math.max(1, Math.ceil(value.text.length / 100)))} onChange={e => edit(original, {text: e.target.value})}/>
          <button disabled={busy} aria-pressed={value.bold} aria-label={`Bold run ${original.id}`} onClick={() => edit(original, {bold: !value.bold})}><b>B</b></button>
          <button disabled={busy} aria-pressed={value.italic} aria-label={`Italic run ${original.id}`} onClick={() => edit(original, {italic: !value.italic})}><i>I</i></button>
        </div> : <span className="local-protected" key={i}>{original.text}</span>;
      })}
      {!block.runs.length && <p>Empty paragraph (preserved)</p>}
    </div>;
  }
  async function save(saveAs) {
    await run(async () => {
      const result = await window.workstationDesktop.saveLocalDocument({id: file.id, saveAs, acknowledged,
        changes: Object.values(changes).map(({id, text, bold, italic}) => ({id, text, bold, italic}))});
      if (result.error) throw new Error(result.error);
      if (!result.canceled) {setChanges({}); onDirty(false); onSaved(result);}
    });
  }
  return <div>
    <div className="local-toolbar"><button disabled={busy || !Object.keys(changes).length || !acknowledged} onClick={() => save(false)}>Save</button>
      <button disabled={busy || !acknowledged} onClick={() => save(true)}>Save As</button>
      <strong role="status">{Object.keys(changes).length ? 'Unsaved changes' : 'Saved'}</strong>
      {file.data.read_only && <span>Original is read-only. Use Save As.</span>}</div>
    <details open><summary>Preservation and editing limits</summary>{file.data.warnings.map(message => <p key={message}>{message}</p>)}

      <label><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/> I reviewed these limits before saving.</label></details>
    <div className="local-document">{file.data.blocks.map((block, index) => block.type === 'paragraph' ? paragraph(block, index) : block.type === 'table' ?
      <div className="local-table-scroll" key={index}><table><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{cell.paragraphs.map(paragraph)}</td>)}</tr>)}</tbody></table></div> : <p key={index}>{block.text}</p>)}</div>
  </div>;
}
