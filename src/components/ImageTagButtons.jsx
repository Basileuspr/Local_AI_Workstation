import { useState } from "react";
import { sortNamedItems } from "../alphabetical";
import * as api from "../imageLibraryApi";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";
import "./PromptPhraseButtons.css";

export default function ImageTagButtons({ tags, selected = [], onToggle, onChanged, onCreated, disabled = false, filtering = false }) {
  const [draft, setDraft] = useState(null);
  const [managing, setManaging] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selection = useSelection(tags), batch = useBatchAction();
  const filtered = sortNamedItems(tags).filter(tag => tag.name.toLowerCase().includes(query.toLowerCase()));
  async function run(action) {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try { await action(); } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="prompt-phrases image-tags" aria-label={filtering ? "Image tag filters" : "Image tags"}>
    <div className="prompt-phrases-heading"><strong>{filtering ? "Filter by image tags" : "Tag this image"}</strong><button type="button" disabled={disabled || busy || !!draft} onClick={() => setDraft({ name: "" })}>+ Add</button></div>
    <p className="prompt-phrases-hint">{filtering ? "Match every selected tag. Images may have additional tags." : "Click a tag to apply or remove it. New tags are applied to this image automatically."}</p>
    {draft && <form className="prompt-phrase-editor" onSubmit={event => { event.preventDefault(); run(async () => {
      const saved = await api.tag(draft.name, draft.id);
      const creating = !draft.id; setDraft(null); await onChanged();
      if (creating && onCreated) await onCreated(saved);
    }); }}>
      <label>Tag name<input aria-label="Image tag name" autoFocus required maxLength={80} value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. GOOD FACE" /></label>
      <div className="prompt-phrase-actions"><button disabled={busy || !draft.name.trim()}>Save tag</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>
    </form>}
    {!!tags.length && <div className="image-tag-tools"><input type="search" aria-label={filtering ? "Find tag filters" : "Find image tags"} placeholder="Find tags…" value={query} onChange={event => setQuery(event.target.value)} /><button type="button" onClick={() => setManaging(value => !value)}>{managing ? "Done editing tags" : "Edit tags"}</button>{filtering && selected.length > 0 && <button type="button" onClick={() => onToggle(null)}>Clear tag filters</button>}</div>}
    {managing && <BulkActions selection={selection} items={filtered} label="image tags" batch={batch} disabled={busy || disabled} actions={[{ label: "Delete selected tags", danger: true, onClick: items => batch.run({ items, selection, action: tag => api.deleteTag(tag.id), verb: "Deleted tags:", confirm: `Delete ${items.length} tag(s) and remove their assignments from images? Images and captions will be kept.`, after: onChanged }) }]} />}
    <div className="image-tag-list">{filtered.map(tag => <div className="image-tag-item" key={tag.id}>
      {managing && <SelectionCheckbox selection={selection} item={tag} label={`tag ${tag.name}`} disabled={busy || batch.busy} />}
      <button type="button" aria-pressed={selected.includes(tag.id)} disabled={disabled || busy || batch.busy} onClick={() => run(() => onToggle(tag.id))}>{tag.name}</button>
      {managing && <button type="button" aria-label={`Rename tag ${tag.name}`} disabled={busy || !!draft} onClick={() => setDraft({ ...tag })}>Edit</button>}
    </div>)}</div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
