import { useEffect, useRef, useState } from "react";
import { NODE_DEFAULTS, NODE_PRESETS, nodeAppearancePreset, nodeOptions } from "../knowledgeNodeOptions";

export default function KnowledgeNodeEditor({ node, onPreview, onSave, disabled = false }) {
  const [draft, setDraft] = useState(() => nodeOptions(node));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const lock = useRef(false);
  const baseline = useRef(JSON.stringify(nodeOptions(node)));
  useEffect(() => {
    const saved = nodeOptions(node), previous = baseline.current;
    baseline.current = JSON.stringify(saved);
    setDraft(current => JSON.stringify(current) === previous ? saved : { ...current, icon: saved.icon });
  }, [node.options]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(nodeOptions(node));
  function change(patch) {
    const next = { ...draft, ...patch }; setDraft(next); onPreview(next); setError("");
  }
  async function save(event) {
    event.preventDefault(); if (lock.current) return;
    const tags = [...new Set(draft.tags.map(tag => tag.trim()).filter(Boolean))];
    if (tags.length > 12 || tags.some(tag => tag.length > 30)) {
      setError("Use up to 12 tags, each at most 30 characters."); return;
    }
    lock.current = true; setSaving(true); setError("");
    try { const saved = await onSave({ ...draft, tags }); setDraft(saved); }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setSaving(false); }
  }
  return <details className="vault-node-editor">
    <summary>Customize node</summary>
    <form onSubmit={save}>
      <fieldset disabled={saving || disabled}>
        <legend className="sr-only">Node appearance and organization</legend>
        <div className="vault-node-presets" aria-label="Node presets">{NODE_PRESETS.map(preset => <button type="button" key={preset.name} onClick={() => change(nodeAppearancePreset(preset))}>{preset.name}</button>)}</div>
        <label>Display name<input maxLength={100} value={draft.label} placeholder={node.filename} onChange={event => change({ label: event.target.value })} /></label>
        <div className="vault-node-fields">
          <label>Color<input type="color" value={draft.color} onChange={event => change({ color: event.target.value })} /></label>
          <label>Shape<select value={draft.shape} onChange={event => change({ shape: event.target.value })}>{["circle", "square", "diamond", "hexagon"].map(shape => <option key={shape}>{shape}</option>)}</select></label>
          <label>Border<select value={draft.border} onChange={event => change({ border: event.target.value })}>{["solid", "dashed", "none"].map(border => <option key={border}>{border}</option>)}</select></label>
        </div>
        <label>Size based on<select value={draft.size_mode} onChange={event => change({ size_mode: event.target.value })}><option value="chunks">Indexed chunks</option><option value="fixed">Fixed size</option></select></label>
        <label>Node size: {draft.size}<input type="range" min="14" max="48" value={draft.size} onChange={event => change({ size: Number(event.target.value) })} /></label>
        <label>Graph label<select value={draft.label_mode} onChange={event => change({ label_mode: event.target.value })}><option value="short">Short label</option><option value="full">Full label</option><option value="hidden">Hidden</option></select></label>
        <label>Label text size: {draft.font_size}<input type="range" min="10" max="20" value={draft.font_size} onChange={event => change({ font_size: Number(event.target.value) })} /></label>
        <label>Tags (comma separated)<input value={draft.tags.join(",")} onChange={event => change({ tags: event.target.value.split(",") })} placeholder="research, project, favorite" /></label>

        <label>Node note<textarea rows={3} maxLength={2000} value={draft.note} onChange={event => change({ note: event.target.value })} /></label>
        <label className="vault-node-lock"><input type="checkbox" checked={draft.locked} onChange={event => change({ locked: event.target.checked })} />Lock position</label>

        <div className="vault-node-actions"><button type="submit" disabled={!dirty}>{saving ? "Saving…" : "Save node"}</button><button type="button" disabled={!dirty} onClick={() => { const saved = nodeOptions(node); setDraft(saved); onPreview(null); setError(""); }}>Cancel</button><button type="button" onClick={() => change({ ...NODE_DEFAULTS, tags: [], icon: nodeOptions(node).icon })}>Reset options</button></div>
        <small role="status">{dirty ? "Unsaved preview" : "Node options saved"}</small>
      </fieldset>
      {error && <p role="alert">{error}</p>}
    </form>
  </details>;
}
