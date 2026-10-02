import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useStore } from "../useStore.jsx";
import * as api from "../api";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import SaveImagePrompts from "./SaveImagePrompts";
import { useSelection, useBatchAction } from "../useSelection";
import { announceIndexKnowledgeChange, useIndexKnowledgeLinks } from "../indexKnowledgeLinks";
import { IndexEntryKnowledgeLinks } from "./IndexKnowledgeLinks";

const EMPTY_ENTRY = { title: "", content: "", source: "", tags: "" };

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function tagsToText(tags) {
  return (tags || []).join(", ");
}

function parseTags(tags) {
  return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export default function PromptIndex({ active = true }) {
  const dispatch = useDispatch();
  const entryTarget = useStore()?.indexEntryTarget;
  const knowledgeLinks = useIndexKnowledgeLinks(active);
  const [selectedEntry, setSelectedEntry] = useState("");
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(EMPTY_ENTRY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const selection = useSelection(entries);
  const batch = useBatchAction();
  const draftRef = useRef({ editor: null, form: EMPTY_ENTRY, search: "" });
  const draftTimerRef = useRef(null);
  const initializedRef = useRef(false);
  const saveErrorShownRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const loadRevisionRef = useRef(0);
  const entriesLoadingRef = useRef(true);
  const draftWriteRef = useRef(Promise.resolve());
  const titleRef = useRef(null);

  function writeDraft(value) {
    const write = draftWriteRef.current.catch(() => {}).then(() => api.savePromptIndexDraft(value));
    draftWriteRef.current = write;
    return write;
  }

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  function applyDraft(nextDraft, persist = true) {
    draftRevisionRef.current += 1;
    draftRef.current = nextDraft;
    setEditor(nextDraft.editor);
    setForm(nextDraft.form);
    setSearch(nextDraft.search);
    if (persist && initializedRef.current) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = window.setTimeout(() => {
        writeDraft(draftRef.current).catch(() => {
          if (!saveErrorShownRef.current) {
            saveErrorShownRef.current = true;
            showToast("Index draft could not be saved", "error");
          }
        });
      }, 500);
    }
  }

  async function clearDraft() {
    window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    try {
      const clear = draftWriteRef.current.catch(() => {}).then(() => api.clearPromptIndexDraft());
      draftWriteRef.current = clear;
      await clear;
    } catch {
      showToast("Index draft could not be cleared", "error");
    }
  }

  async function refreshEntries() {
    entriesLoadingRef.current = true;
    const loadRevision = ++loadRevisionRef.current;
    const draftRevision = draftRevisionRef.current;
    try {
      setLoading(true);
      const data = await api.loadPromptIndexState();
      if (loadRevision !== loadRevisionRef.current) return;
      setEntries(data.entries || []);
      const saved = data.draft || {};
      // Hydrate once. Later tab visits must not replace local edits with the
      // previous debounce snapshot, nor may a slow first load erase new input.
      if (!initializedRef.current && draftRevision === draftRevisionRef.current) applyDraft({
        editor: saved.editor || null,
        form: { ...EMPTY_ENTRY, ...(saved.form || {}) },
        search: saved.search || "",
      }, false);
      initializedRef.current = true;
    } catch (error) {
      showToast(error.message || "Could not load Index", "error");
    } finally {
      if (loadRevision === loadRevisionRef.current) { entriesLoadingRef.current = false; setLoading(false); }
    }
  }

  useEffect(() => {
    return () => {
      window.clearTimeout(draftTimerRef.current);
      if (initializedRef.current) writeDraft(draftRef.current).catch(() => {});
    };
  }, []);

  // The pane stays mounted across navigation now, so reload entries whenever it
  // becomes visible instead of relying on a fresh mount.
  useEffect(() => {
    if (active) refreshEntries();
  }, [active]);

  useEffect(() => {
    if (active && editor) titleRef.current?.focus();
  }, [active, editor]);

  useEffect(() => {
    if (!active || loading || entriesLoadingRef.current || !entryTarget || !initializedRef.current) return;
    const entry = entries.find(item => item.id === entryTarget.id);
    if (entry) {
      // Reveal the saved card without replacing an unfinished editor draft.
      updateSearch(""); setSelectedEntry(entry.id);
      requestAnimationFrame(() => {
        const card = document.getElementById(`index-entry-${entry.id}`);
        card?.scrollIntoView({ block: "nearest" }); card?.focus({ preventScroll: true });
      });
    } else showToast("Index entry no longer exists", "error");
    dispatch({ type: "CLEAR_INDEX_ENTRY_TARGET" });
  }, [active, loading, entries, entryTarget]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return entries;
    return entries.filter((entry) =>
      [entry.title, entry.content, entry.source, ...(entry.tags || [])]
        .filter(Boolean)
        .some((value) => value.toLocaleLowerCase().includes(query))
    );
  }, [entries, search]);

  function updateForm(changes) {
    applyDraft({ ...draftRef.current, form: { ...draftRef.current.form, ...changes } });
  }

  function updateSearch(nextSearch) {
    applyDraft({ ...draftRef.current, search: nextSearch });
  }

  function openNewEntry() {
    applyDraft({ ...draftRef.current, editor: "new", form: { ...EMPTY_ENTRY } });
  }

  function openEditEntry(entry) {
    applyDraft({
      ...draftRef.current,
      editor: entry.id,
      form: {
        title: entry.title,
        content: entry.content,
        source: entry.source || "",
        tags: tagsToText(entry.tags),
      },
    });
  }

  async function closeEditor() {
    applyDraft({ ...draftRef.current, editor: null, form: { ...EMPTY_ENTRY } }, false);
    await clearDraft();
  }

  async function handleSave(event) {
    event.preventDefault();
    const entry = {
      title: form.title.trim(),
      content: form.content.trim(),
      source: form.source.trim(),
      tags: parseTags(form.tags),
    };
    if (!entry.title || !entry.content) {
      showToast("Title and content are required", "error");
      return;
    }

    try {
      setSaving(true);
      if (editor === "new") {
        await api.createPromptIndexEntry(entry);
        showToast("Index entry saved", "success");
      } else {
        await api.updatePromptIndexEntry(editor, entry);
        showToast("Index entry updated", "success");
      }
      await closeEditor();
      await refreshEntries();
    } catch (error) {
      showToast(error.message || "Could not save Index entry", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entry) {
    return deleteEntries([entry]);
  }

  function deleteEntries(items) {
    return batch.run({items, selection, verb:"Deleted",
      confirm:`Delete ${items.length} selected Index entry/entries? This cannot be undone.`,
      action:entry => api.deletePromptIndexEntry(entry.id), after:result => {
        const removed = new Set(result.succeeded.map(item => item.id));
        setEntries(current => current.filter(item => !removed.has(item.id)));
        announceIndexKnowledgeChange();
        if (removed.has(draftRef.current.editor)) closeEditor();
      }});
  }

  return (
    <section id="prompt-index" aria-label="Index">
      <header className="prompt-index-header">
        <div>
          <div className="prompt-index-eyebrow">Reference Library</div>
          <h1>Index</h1>
        </div>
        <div className="save-image-prompts-actions">
          <SaveImagePrompts label="Import from Generate" onSaved={refreshEntries} />
          <button className="prompt-index-add" type="button" onClick={openNewEntry} disabled={batch.busy || saving}>+ Add entry</button>
        </div>
      </header>

      <div className="prompt-index-toolbar">
        <input aria-label="Search Index" value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Search entries" />
        <span>{filteredEntries.length} entries</span>
      </div>

      <BulkActions selection={selection} items={filteredEntries} label="entries" batch={batch} disabled={saving || loading}
        actions={[{label:"Delete selected entries", danger:true, onClick:deleteEntries}]} />
      {knowledgeLinks.error && <p className="index-link-status" role="alert">Knowledge connections: {knowledgeLinks.error} <button type="button" onClick={knowledgeLinks.refresh}>Retry connections</button></p>}
      {knowledgeLinks.notice && <p className="index-link-status" role="status">{knowledgeLinks.notice}</p>}
      <div className={`prompt-index-layout ${editor ? "editing" : ""}`}>
        <div className="prompt-index-list">
          {loading ? <div className="prompt-index-empty">Loading entries...</div> : filteredEntries.length === 0 ? (
            <div className="prompt-index-empty">{search ? "No entries match this search." : "No saved entries yet."}</div>
          ) : filteredEntries.map((entry) => (
            <article id={`index-entry-${entry.id}`} tabIndex={-1} className={`prompt-index-entry${selectedEntry === entry.id ? " index-entry-selected" : ""}`} key={entry.id}>
              <div className="prompt-index-entry-heading">
                <SelectionCheckbox selection={selection} item={entry} label={`entry ${entry.title}`} disabled={batch.busy || saving} />
                <div><h2>{entry.title}</h2><div className="prompt-index-date">Saved {formatDate(entry.created_at)}</div></div>
                <div className="prompt-index-entry-actions">
                  <button type="button" onClick={() => copyText(entry.content).then(() => showToast("Copied", "success")).catch(() => showToast("Copy failed", "error"))}>Copy</button>
                  <button type="button" onClick={() => openEditEntry(entry)} disabled={batch.busy || saving}>Edit</button>
                  <button type="button" className="danger" onClick={() => handleDelete(entry)} disabled={batch.busy || saving}>Delete</button>
                </div>
              </div>
              {entry.source && <div className="prompt-index-source">{entry.source}</div>}
              <pre>{entry.content}</pre>
              {entry.tags?.length > 0 && <div className="prompt-index-tags">{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
              <IndexEntryKnowledgeLinks entry={entry} catalog={knowledgeLinks} disabled={batch.busy || saving} />
            </article>
          ))}
        </div>

        {editor && (
          <form className="prompt-index-editor" onSubmit={handleSave}>
            <div className="prompt-index-editor-header"><h2>{editor === "new" ? "New entry" : "Edit entry"}</h2><button type="button" title="Close editor" onClick={closeEditor}>&times;</button></div>
            <label><span>Title</span><input ref={titleRef} value={form.title} maxLength={120} onChange={(event) => updateForm({ title: event.target.value })} /></label>
            <label><span>Saved from / purpose</span><input value={form.source} maxLength={160} onChange={(event) => updateForm({ source: event.target.value })} /></label>
            <label><span>Tags</span><input value={form.tags} onChange={(event) => updateForm({ tags: event.target.value })} placeholder="notes, research, reference" /></label>
            <label className="prompt-index-editor-content"><span>Content</span><textarea value={form.content} onChange={(event) => updateForm({ content: event.target.value })} /></label>
            <div className="prompt-index-editor-actions"><button type="button" onClick={closeEditor}>Cancel</button><button type="submit" disabled={saving || batch.busy}>{saving ? "Saving..." : "Save entry"}</button></div>
          </form>
        )}
      </div>
    </section>
  );
}
