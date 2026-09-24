import { useState } from "react";
import "./PromptPhraseButtons.css";
import { useRefs } from "../useStore.jsx";
import { createMessageId } from "../messageIds";
import { copyPromptPhrase, loadPromptPhrases, savePromptPhrases } from "../promptPhrases";
import CollectionPager from "./CollectionPager";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection } from "../useSelection";

export default function PromptPhraseButtons() {
  const refs = useRefs();
  const [loaded] = useState(() => {
    try { return { phrases: loadPromptPhrases(), error: "" }; }
    catch { return { phrases: [], error: "Could not load saved buttons. Reload the app to try again." }; }
  });
  const [phrases, setPhrases] = useState(loaded.phrases);
  const selection = useSelection(phrases);
  const [draft, setDraft] = useState(null);
  const [managing, setManaging] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(loaded.error);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const filtered = phrases.filter((phrase) => `${phrase.name}\n${phrase.text}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pages - 1);

  function persist(next) {
    try {
      const sorted = savePromptPhrases(next);
      setPhrases(sorted);
      setError("");
      return sorted;
    } catch {
      setError("Could not save buttons locally. Your changes have not been saved.");
      return false;
    }
  }

  function save(event) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.text.trim()) return;
    const entry = { ...draft, name: draft.name.trim() };
    const next = phrases.some((item) => item.id === entry.id)
      ? phrases.map((item) => item.id === entry.id ? entry : item)
      : [...phrases, entry];
    const saved = persist(next);
    if (saved) {
      setDraft(null);
      setFeedback("");
      setQuery("");
      setPage(Math.floor(saved.findIndex((item) => item.id === entry.id) / 12));
    }
  }

  async function copy(phrase) {
    try {
      await copyPromptPhrase(phrase.text, refs.imagePromptTarget);
      setFeedback(`Copied ${phrase.name} — Ctrl+V to paste`);
      setError("");
    } catch {
      setFeedback("");
      setError("Could not copy. Click the phrase button to try again.");
    }
  }

  return (
    <section className="prompt-phrases" aria-label="Phrase buttons">
      <div className="prompt-phrases-heading">
        <button type="button" className="prompt-phrases-toggle" aria-expanded={!collapsed}
          aria-controls="prompt-phrases-content" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? "▸" : "▾"} Phrase buttons ({phrases.length})
        </button>
        <button type="button" disabled={!!loaded.error || !!draft} onClick={() => {
          setDraft({ id: createMessageId(), name: "", text: "" });
          setCollapsed(false);
          setFeedback("");
        }}>+ Add</button>
      </div>
      <div id="prompt-phrases-content" hidden={collapsed}>
      {draft && <form className="prompt-phrase-editor" onSubmit={save}>
        <label>Button name
          <input autoFocus required maxLength={80} value={draft.name} placeholder="e.g. 🚫💪"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label>Text to copy
          <textarea required rows={5} value={draft.text} placeholder="e.g. malformed limbs, extra arms, bad anatomy"
            onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
        </label>
        <div className="prompt-phrase-actions">
          <button type="submit" disabled={!draft.name.trim() || !draft.text.trim()}>Save button</button>
          <button type="button" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </form>}
      <p className="prompt-phrases-hint">Click to copy, then Ctrl+V in your prompt.</p>
      {phrases.length > 0 && <div className="collection-toolbar">
        <input type="search" aria-label="Search phrase buttons" placeholder="Find a button or phrase…"
          value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
        <div className="collection-heading">
          <small>{filtered.length} {query ? "matches" : "buttons"}</small>
          <button type="button" className="prompt-phrases-manage" aria-pressed={managing}
            onClick={() => setManaging(!managing)}>{managing ? "Done editing" : "Edit buttons"}</button>
        </div>
        <CollectionPager label="phrases" page={currentPage} pages={pages} onChange={setPage} />
        {managing && <BulkActions selection={selection} items={filtered} label="phrase buttons" disabled={!!draft}
          actions={[{label:"Remove selected buttons", danger:true, onClick:items => {
            if (!window.confirm(`Remove ${items.length} selected phrase button(s)? This cannot be undone.`)) return;
            const ids = new Set(items.map(item => item.id));
            if (persist(phrases.filter(item => !ids.has(item.id)))) { selection.forget(items); setFeedback(`Removed ${items.length} phrase buttons.`); }
          }}]} />}
      </div>}
      <div className={`prompt-phrases-list ${managing ? "is-managing" : ""}`}>
        {filtered.slice(currentPage * 12, (currentPage + 1) * 12).map((phrase) => (
          <div className="prompt-phrase-row" key={phrase.id}>
            {managing && <SelectionCheckbox selection={selection} item={phrase} label={`phrase ${phrase.name}`} disabled={!!draft} />}
            <button type="button" className="prompt-phrase-copy" title={phrase.text}
              onMouseDown={(event) => { if (event.button === 0) event.preventDefault(); }}
              onClick={() => copy(phrase)}>{phrase.name}</button>
            {managing && <>
              <button type="button" aria-label={`Edit ${phrase.name}`} disabled={!!draft}
                onClick={() => setDraft({ ...phrase })}>Edit</button>
              <button type="button" aria-label={`Remove ${phrase.name}`} disabled={!!draft}
                onClick={() => {
                  if (window.confirm(`Remove phrase button "${phrase.name}"?`)) {
                    persist(phrases.filter((item) => item.id !== phrase.id));
                  }
                }}>×</button>
            </>}
          </div>
        ))}
      </div>
      {phrases.length > 0 && !filtered.length && <p className="prompt-phrases-hint">No matching buttons. Try another word.</p>}
      {!phrases.length && !draft && !loaded.error && <p className="prompt-phrases-hint">Add your first button, for example 🚫💪 for a negative anatomy phrase.</p>}
      <p className="prompt-phrases-feedback" role="status">{feedback}</p>
      </div>
      {error && <p className="prompt-phrases-error" role="alert">{error}</p>}
    </section>
  );
}
