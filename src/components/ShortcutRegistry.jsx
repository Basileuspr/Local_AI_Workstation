import { useRef, useState } from "react";
import { builtInEntries, entryTypes, filterRegistry, loadPersonalEntries, savePersonalEntries, registryMarkdown, WORD_SCOPE, loadRegistryFolders, saveRegistryFolders, registryFolders } from "../shortcutRegistry";
import { downloadBlob } from "../downloadBlob";
import { applicationIconKey, loadRegistryIcons, saveRegistryIcons, readApplicationIcon } from "../registryApplicationIcons";
import RegistryApplicationIcon from "./RegistryApplicationIcon";
import ActionMenu from './ActionMenu';
import "./Tools.css";
import "./ShortcutRegistry.css";

const emptyDraft = { application: "Microsoft Word", platform: WORD_SCOPE, type: "Shortcut", category: "General", title: "", keys: "", description: "", steps: "", notes: "" };
export default function ShortcutRegistry() {
  const [loaded] = useState(() => { try { return { entries: loadPersonalEntries(), error: "" }; } catch (error) { return { entries: [], error: `Personal entries could not be loaded: ${error.message} Stored data has been preserved.` }; } });
  const [personal, setPersonal] = useState(loaded.entries);
  const [loadedFolders] = useState(() => { try { return { names: loadRegistryFolders(), error: "" }; } catch (failure) { return { names: [], error: `Application folders could not be loaded: ${failure.message} Stored folder data has been preserved.` }; } });
  const [folderNames, setFolderNames] = useState(loadedFolders.names);
  const [folderError, setFolderError] = useState(loadedFolders.error);
  const [loadedIcons] = useState(() => { try { return { icons: loadRegistryIcons(), error: "" }; } catch (failure) { return { icons: {}, error: `Application icons could not be loaded: ${failure.message} Stored icon data has been preserved.` }; } });
  const [customIcons, setCustomIcons] = useState(loadedIcons.icons), [iconError, setIconError] = useState(loadedIcons.error);
  const [iconApplication, setIconApplication] = useState(null), [iconBusy, setIconBusy] = useState(false);
  const iconInput = useRef(null), iconButton = useRef(null);
  const [newFolder, setNewFolder] = useState(null), [expandedFolders, setExpandedFolders] = useState({});
  const folderInput = useRef(null);
  const [error, setError] = useState(loaded.error), [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({ query: "", application: "", category: "", type: "" });
  const [draft, setDraft] = useState(null), [removed, setRemoved] = useState(null);
  const titleInput = useRef(null), addButton = useRef(null);
  const entries = [...builtInEntries, ...personal];
  const visible = filterRegistry(entries, filters);
  const applications = registryFolders(entries, folderNames).map(folder => folder.application);
  const folders = registryFolders(entries, folderNames, filters);
  const filtering = !!(filters.query.trim() || filters.application || filters.category || filters.type);
  const categories = [...new Set(entries.filter(entry => !filters.application || entry.application === filters.application).map(entry => entry.category))].sort();
  const setFilter = (name, value) => { setExpandedFolders({}); setFilters(previous => ({ ...previous, [name]: value, ...(name === "application" ? { category: "" } : {}) })); };
  function createFolder(event) {
    event.preventDefault();
    const name = newFolder.trim();
    if (applications.some(application => application.toLowerCase() === name.toLowerCase())) { setFolderError("That application folder already exists."); return; }
    try {
      setFolderNames(saveRegistryFolders([...folderNames, name]));
      setFolderError(""); setNewFolder(null);
      setFilters({ query: "", application: name, category: "", type: "" });
      setExpandedFolders({ [name]: true }); setNotice(`Created ${name} folder. Add an entry to fill it.`);
    } catch (failure) { setFolderError(`Could not save application folder: ${failure.message}`); }
  }
  function addToFolder(application) {
    openEditor({ ...emptyDraft, application, platform: application === "Microsoft Word" ? WORD_SCOPE : "" });
  }
  function closeIconEditor() { setIconApplication(null); requestAnimationFrame(() => iconButton.current?.focus()); }
  function persistIcon(application, source) {
    if (loadedIcons.error) return;
    const next = { ...customIcons }, key = applicationIconKey(application);
    if (source) next[key] = source; else delete next[key];
    setCustomIcons(saveRegistryIcons(next)); setIconError("");
    setNotice(source ? `Icon saved locally for ${application}.` : `Automatic icon restored for ${application}.`);
  }
  async function chooseIcon(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setIconBusy(true); setIconError("");
    try { persistIcon(iconApplication, await readApplicationIcon(file)); }
    catch (failure) { setIconError(`Could not save application icon: ${failure.message}`); }
    finally { setIconBusy(false); }
  }
  function persist(next) {
    if (loaded.error) { setError("Stored personal entries could not be read. Saving is disabled to preserve them."); return false; }
    try { const saved = savePersonalEntries(next); setPersonal(saved); setError(""); return true; }
    catch (failure) { setError(`Could not save personal entries: ${failure.message}`); return false; }
  }
  function openEditor(entry = { ...emptyDraft, application: filters.application || "Microsoft Word", platform: filters.application && filters.application !== "Microsoft Word" ? "" : WORD_SCOPE }) {
    setDraft({ ...entry }); setNotice(""); requestAnimationFrame(() => titleInput.current?.focus());
  }
  function closeEditor() { setDraft(null); requestAnimationFrame(() => addButton.current?.focus()); }
  function save(event) {
    event.preventDefault();
    const entry = { ...draft, id: draft.id || crypto.randomUUID() };
    const next = draft.id ? personal.map(item => item.id === draft.id ? entry : item) : [...personal, entry];
    if (persist(next)) { setExpandedFolders({}); setFilters({ query: "", application: entry.application.trim(), category: "", type: "" }); setNotice("Personal entry saved locally."); closeEditor(); }
  }
  function remove(entry) {
    const remaining = personal.filter(item => item.id !== entry.id);
    if (persist(remaining)) {
      const available = [...builtInEntries, ...remaining];
      setFilters(previous => {
        const application = registryFolders(available, folderNames).some(folder => folder.application.toLowerCase() === previous.application.toLowerCase()) ? previous.application : "";
        const category = available.some(item => (!application || item.application === application) && item.category === previous.category) ? previous.category : "";
        return { ...previous, application, category };
      });
      setRemoved(entry); setNotice(`Removed ${entry.title}. You can undo this removal.`);
    }
  }
  const field = (name, label, required = false, multiline = false) => <label key={name}>{label}{multiline
    ? <textarea rows={3} maxLength={8000} required={required} value={draft[name]} onChange={event => setDraft({ ...draft, [name]: event.target.value })} />
    : <input ref={name === "title" ? titleInput : undefined} list={name === "application" ? "registry-applications" : undefined} maxLength={name === "description" ? 8000 : 300} required={required} value={draft[name]} onChange={event => setDraft({ ...draft, [name]: event.target.value })} />}</label>;
  return <section className="tools-workspace shortcut-registry" aria-labelledby="shortcut-registry-title">
    <header className="tools-heading"><p className="tools-eyebrow">Reference library</p><h1 id="shortcut-registry-title">Shortcut Registry</h1>
      </header>
    <div className="tools-toolbar">
      <button type="button" disabled={!!loadedFolders.error} onClick={() => { setNewFolder(""); requestAnimationFrame(() => folderInput.current?.focus()); }}>New application folder</button>
      <button type="button" ref={addButton} disabled={!!loaded.error} onClick={() => openEditor()}>Add personal entry</button>
      <ActionMenu label="Reference options" actions={[
        {label:'Save reference (.md)', disabled:!visible.length, onClick:() => {try{downloadBlob(new Blob([registryMarkdown(visible)],{type:'text/markdown;charset=utf-8'}),'shortcut-reference.md');}catch(failure){setError(failure.message);}}},
        {label:'Copy reference', disabled:!visible.length, onClick:async() => {try{await navigator.clipboard.writeText(registryMarkdown(visible));setNotice("Matching reference copied, including entries in collapsed folders.");}catch(failure){setError(`Could not copy: ${failure.message}`);}}},
      ]}/>
    </div>

    {error && <p className="functions-error" role="alert">{error}</p>}
    {folderError && <p className="functions-error" role="alert">{folderError}</p>}
    {iconError && <p className="functions-error" role="alert">{iconError}</p>}
    {notice && <p role="status">{notice} {removed && <button type="button" onClick={() => { if (persist([...personal, removed])) { setRemoved(null); setNotice("Removal undone."); } }}>Undo removal</button>}</p>}
    {iconApplication && <section className="registry-icon-editor" aria-label="Application icon"
      onKeyDown={event => { if (event.key === "Escape" && !iconBusy) { event.preventDefault(); closeIconEditor(); } }}>
      <header><RegistryApplicationIcon application={iconApplication} customIcon={customIcons[applicationIconKey(iconApplication)]} /><strong>{iconApplication} icon</strong></header>
      <label>Choose icon image<input ref={iconInput} type="file" accept=".png,.jpg,.jpeg,.webp,.ico,image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon" disabled={iconBusy} onChange={chooseIcon} /></label>

      <div className="tools-toolbar"><button type="button" disabled={iconBusy || !customIcons[applicationIconKey(iconApplication)]}
        onClick={() => { try { persistIcon(iconApplication, null); } catch (failure) { setIconError(`Could not restore application icon: ${failure.message}`); } }}>Use automatic icon</button>
        <button type="button" disabled={iconBusy} onClick={closeIconEditor}>{iconBusy ? "Saving icon…" : "Close icon settings"}</button></div>
    </section>}
    {newFolder !== null && <form className="registry-folder-editor" onSubmit={createFolder} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setNewFolder(null); } }}>
      <label>Application folder name<input ref={folderInput} required maxLength={300} placeholder="Microsoft Excel" value={newFolder} onChange={event => setNewFolder(event.target.value)} /></label>
      <button type="submit">Create folder</button><button type="button" onClick={() => setNewFolder(null)}>Cancel folder</button>
    </form>}
    {draft && <form className="registry-editor" onSubmit={save} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeEditor(); } }}>
      <h2>{draft.id ? "Edit personal entry" : "New personal entry"}</h2>
      <div className="registry-editor-fields">{field("title", "Title", true)}{field("application", "Application", true)}{field("platform", "Platform / version")}
        <label>Type<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}>{entryTypes.map(type => <option key={type}>{type}</option>)}</select></label>
        {field("category", "Category")}{field("keys", "Keys (for shortcuts)", draft.type === "Shortcut")}
        {field("description", "What happens", true, true)}{field("steps", "Menu / steps", false, true)}{field("notes", "Notes / examples", false, true)}</div>
      <datalist id="registry-applications">{applications.map(application => <option key={application} value={application} />)}</datalist>

      <div className="tools-toolbar"><button type="submit">Save entry</button><button type="button" onClick={closeEditor}>Cancel</button></div>
    </form>}
    <div className="registry-filters">
      <label>Search<input type="search" value={filters.query} placeholder="Try Ctrl+Enter, formatting, or review" onChange={event => setFilter("query", event.target.value)} /></label>
      <label>Application<select value={filters.application} onChange={event => setFilter("application", event.target.value)}><option value="">All applications</option>{applications.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Category<select value={filters.category} onChange={event => setFilter("category", event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Type<select value={filters.type} onChange={event => setFilter("type", event.target.value)}><option value="">All types</option>{entryTypes.map(value => <option key={value}>{value}</option>)}</select></label>
      <button type="button" onClick={() => { setExpandedFolders({}); setFilters({ query: "", application: "", category: "", type: "" }); }}>Clear filters</button>
    </div>
    <div className="registry-folder-tools"><p className="tools-note" role="status">{visible.length} of {entries.length} entries · {folders.length} application {folders.length === 1 ? "folder" : "folders"}</p>
      <button type="button" onClick={() => setExpandedFolders(Object.fromEntries(applications.map(application => [application, false])))}>Collapse all folders</button></div>
    <div className="registry-folders">{folders.map((folder, index) => {
      const open = Object.hasOwn(expandedFolders, folder.application) ? expandedFolders[folder.application] : filtering;
      return <section className="registry-folder" key={folder.application}>
        <div className="registry-folder-heading"><h2><button type="button" className="registry-folder-toggle" aria-expanded={open} aria-controls={`registry-folder-${index}`} onClick={() => setExpandedFolders(previous => ({ ...previous, [folder.application]: !open }))}>
          <span aria-hidden="true">{open ? "▾" : "▸"}</span><RegistryApplicationIcon application={folder.application} customIcon={customIcons[applicationIconKey(folder.application)]} /><span className="registry-folder-name">{folder.application}</span><small>{filtering ? `${folder.entries.length} matching / ` : ""}{folder.total} {folder.total === 1 ? "entry" : "entries"}</small></button></h2>
          <div className="registry-folder-actions"><button type="button" disabled={!!loadedIcons.error} aria-label={`Change icon for ${folder.application}`}
            onClick={event => { iconButton.current = event.currentTarget; setIconApplication(folder.application); setIconError(""); requestAnimationFrame(() => iconInput.current?.focus()); }}>Icon</button>
          <button type="button" disabled={!!loaded.error} aria-label={`Add entry to ${folder.application}`} onClick={() => addToFolder(folder.application)}>Add entry</button></div></div>
        <div id={`registry-folder-${index}`} hidden={!open} className="registry-folder-content">{open && <>
          {!folder.entries.length && <p className="tools-empty">This folder is empty. Add an entry for {folder.application}.</p>}
          <div className="registry-entries">{folder.entries.map(entry => <article key={entry.id} className="registry-entry">
      <div className="registry-entry-heading"><div><span className="registry-type">{entry.type} · {entry.category} · {entry.builtIn ? "Built-in" : "Personal"}</span><h3>{entry.title}</h3></div>{entry.keys && <kbd>{entry.keys}</kbd>}</div>
      <p className="registry-scope">{entry.application} · {entry.platform || "Platform unspecified"}</p>
      <p>{entry.description}</p>
      {entry.steps && <p><strong>Menu / steps:</strong> {entry.steps}</p>}{entry.notes && <p><strong>Notes:</strong> {entry.notes}</p>}
      {entry.builtIn ? <a href={entry.source} target="_blank" rel="noreferrer">Microsoft Support · checked {entry.verified}</a>
        : <div className="tools-toolbar"><button type="button" aria-label={`Edit ${entry.title}`} onClick={() => openEditor(entry)}>Edit</button><button type="button" disabled={!!loaded.error} aria-label={`Remove ${entry.title}`} onClick={() => remove(entry)}>Remove</button></div>}
          </article>)}</div>
        </>}</div>
      </section>;
    })}</div>
    {!folders.length && <p className="tools-empty">No entries match. Clear the filters or add a personal entry.</p>}
  </section>;
}
