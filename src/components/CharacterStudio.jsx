import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, listSessionImages } from "../api";
import * as api from "../characterPartsApi";
import * as libraryApi from "../imageLibraryApi";
import { browserFaceSource, desktopFaceSource } from "../faceImport";
import { DEFAULT_PARTS, runActive, newSelection, filterSelections, coverage, focusFilters, focusDescription, earlierFocus } from "../characterParts";
import FreshFileInput from "./FreshFileInput";
import ProtectedImage from "../ImagePrivacy";
import MediaCardActions from "./MediaCardActions";
import CharacterSilhouette from "./CharacterSilhouette";
import CharacterRegionEditor from "./CharacterRegionEditor";
import CharacterFocus from "./CharacterFocus";
import "./CharacterStudio.css";

const PAGE_SIZE = 36;
const LAST_DATASET = "law-character-parts-dataset";
function CaptionEditor({ source, onSave, busy }) {
  const [caption, setCaption] = useState(source.caption), [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setCaption(source.caption); }, [source.caption, dirty]);
  return <details className="character-caption"><summary>Full-image caption · {source.caption_reviewed ? "reviewed" : "review before export"}</summary>
    <label>Caption for the full source image<textarea rows={2} maxLength={2000} value={caption} onChange={event => { setCaption(event.target.value); setDirty(true); }} /></label>
    <button disabled={busy} onClick={async () => { if (await onSave(caption)) setDirty(false); }}>Save full-image caption</button>
  </details>;
}

function LibraryPicker({ images, onImport, onClose, busy }) {
  const dialog = useRef(null), [chosen, setChosen] = useState(new Set()), [query, setQuery] = useState(""), [page, setPage] = useState(0);
  useEffect(() => { dialog.current.showModal(); }, []);
  const visible = images.filter(item => `${item.name} ${item.session_title || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <dialog ref={dialog} className="character-dialog" aria-label="Choose training source images" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><h2>Choose source images</h2><p>General and saved library images. Hidden and locked images are excluded.</p></div><button disabled={busy} onClick={onClose}>Close</button></header>
    <label>Search images<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
    <div className="character-source-grid">{visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((item, index) => {
      const key = item.key;
      return <button key={key} type="button" aria-pressed={chosen.has(key)} aria-label={`Select ${item.name}`} disabled={busy || (!chosen.has(key) && chosen.size >= 100)} onClick={() => setChosen(current => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; })}>
        <ProtectedImage src={item.url} alt="" loading="lazy" /><span>{item.name || `Image ${index + 1}`}</span>
      </button>;
    })}</div>
    {!visible.length && <p>No matching library images. You can also import files or a folder.</p>}
    <footer><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous images</button><span>{chosen.size} selected</span><button disabled={(page + 1) * PAGE_SIZE >= visible.length} onClick={() => setPage(value => value + 1)}>Next images</button>
      <button className="character-primary" disabled={busy || !chosen.size} onClick={() => onImport(images.filter(item => chosen.has(item.key)).map(item => item.source))}>{busy ? "Importing…" : "Import selected"}</button></footer>
  </dialog>;
}

export default function CharacterStudio({ active }) {
  const [catalog, setCatalog] = useState(null), [datasets, setDatasets] = useState([]), [datasetId, setDatasetId] = useState(() => typeof localStorage === "undefined" ? "" : localStorage.getItem(LAST_DATASET) || "");
  const [dataset, setDataset] = useState(null), [sourceId, setSourceId] = useState(""), [run, setRun] = useState(null);
  const [newName, setNewName] = useState(""), [model, setModel] = useState(""), [parts, setParts] = useState(["buttocks"]), [subjectHint, setSubjectHint] = useState("");
  const [focusId, setFocusId] = useState(""), [focusNotes, setFocusNotes] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [filters, setFilters] = useState({ part: "buttocks", side: "", view: "", state: "", detail: "" }), [onlySource, setOnlySource] = useState(false);
  const [selected, setSelected] = useState(new Set()), [editor, setEditor] = useState(null), [library, setLibrary] = useState(null);
  const [sourcePage, setSourcePage] = useState(0), [page, setPage] = useState(0), [importing, setImporting] = useState(false);
  const current = useRef(null), currentId = useRef(datasetId), lock = useRef(false), importRef = useRef(null);
  const running = runActive(run), disabled = busy || importing;
  const desktop = typeof window === "undefined" ? null : window.workstationDesktop;
  function accept(value) { if (currentId.current !== value.id) return; current.current = value; setDataset(value); setSourceId(id => value.sources.some(item => item.id === id) ? id : value.sources[0]?.id || ""); }
  async function refresh(id = currentId.current) { if (id) accept(await api.get(id)); }
  async function refreshList() { const value = await api.list(); setDatasets(value.datasets); return value.datasets; }
  async function guard(action) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError("");
    try { await action(); return true; }
    catch (failure) { setError(failure.message); if (failure.status === 409) await refresh().catch(() => {}); return false; }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!active) return;
    let alive = true;
    Promise.all([api.catalog(), api.list()]).then(([next, list]) => {
      if (!alive) return;
      setCatalog(next); setDatasets(list.datasets);
      setModel(value => value || (next.models.length === 1 ? next.models[0].id : ""));
      setDatasetId(value => list.datasets.some(item => item.id === value) ? value : list.datasets[0]?.id || "");
    }).catch(failure => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, [active]);
  useEffect(() => {
    currentId.current = datasetId; current.current = null; setDataset(null); setSourceId(""); setSelected(new Set()); setRun(null); setSourcePage(0); setPage(0); setFocusId(""); setFocusNotes("");
    setFilters({ part: "buttocks", side: "", view: "", state: "", detail: "" }); setParts(["buttocks"]);
    if (!datasetId) return;
    localStorage.setItem(LAST_DATASET, datasetId);
    let alive = true;
    Promise.all([api.get(datasetId), api.run(datasetId)]).then(([data, status]) => { if (alive) { accept(data); setRun(status.run); } }).catch(failure => { if (alive) setError(failure.message); });
    return () => { alive = false; };
  }, [datasetId]);
  useEffect(() => {
    if (!running || !datasetId) return;
    let alive = true, timer;
    async function poll() {
      try { const status = await api.run(datasetId); if (!alive) return; setRun(status.run); await refresh(datasetId); }
      catch (failure) { if (alive) setError(failure.message); }
      if (alive) timer = setTimeout(poll, 1000);
    }
    timer = setTimeout(poll, 700);
    return () => { alive = false; clearTimeout(timer); };
  }, [datasetId, running]);
  useEffect(() => () => { if (importRef.current) importRef.current.cancelled = true; }, []);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [filters, onlySource, onlySource ? sourceId : ""]);
  const source = dataset?.sources.find(item => item.id === sourceId);
  const focus = dataset?.selections.find(item => item.id === focusId);
  const visible = useMemo(() => filterSelections(dataset?.selections || [], { ...filters, sourceId: onlySource ? sourceId : "" }), [dataset, filters, onlySource, sourceId]);
  const counts = useMemo(() => coverage(dataset?.selections || []), [dataset]);
  const acceptedCount = dataset?.selections.filter(item => item.state === "accepted").length || 0;
  const rejectedCount = dataset?.selections.filter(item => item.state === "rejected").length || 0;
  const exportMedia = scope => guard(async () => {
    await api.exportMedia(current.current, scope, scope === "selected" ? [...selected] : []);
    setNotice(`${scope === "selected" ? "Selected" : scope === "approved" ? "Approved" : "Rejected"} media ZIP download started. Originals and review states are unchanged.`);
  });

  async function importImages(open) {
    if (lock.current || importRef.current || !datasetId) return;
    const id = datasetId, control = { cancelled: false }; importRef.current = control; setImporting(true); setError("");
    let input, added = 0, failures = 0;
    try {
      input = await open();
      if (!input) return;
      while (!control.cancelled) {
        const batch = await input.next(); failures += batch.errors?.length || 0;
        if (batch.canceled || control.cancelled) break;
        if (batch.files.length) { const result = await api.upload(id, batch.files); added += result.added; failures += result.errors.length; accept(result.dataset); }
        setNotice(`Imported ${added} images${failures ? ` · ${failures} could not be imported` : ""}.`);
        if (batch.done) break;
      }
      setNotice(`${control.cancelled ? "Import stopped. " : ""}${added} images imported${failures ? `; ${failures} files could not be imported` : ""}. Existing duplicates are kept once.`);
      await refreshList();
    } catch (failure) { setError(failure.message); }
    finally { await input?.release().catch(() => {}); importRef.current = null; setImporting(false); }
  }
  function pickDesktop(directory) { return importImages(async () => { const choice = await desktop.chooseFaceInputs({ directory }); if (choice?.error) throw new Error(choice.error); return choice?.canceled ? null : desktopFaceSource(desktop, choice); }); }
  const startAnalysis = ids => guard(async () => { setRun(await api.analyze(datasetId, { source_ids: ids, model, parts: focus ? [focus.part] : parts, subject_hint: subjectHint,
    ...(focus ? { reference_selection_id: focus.id, focus_description: focusNotes } : {}) })); setNotice(""); });
  async function openLibrary() {
    await guard(async () => {
      const [saved, sessions] = await Promise.all([libraryApi.list(), listSessionImages()]);
      const libraryImages = (saved.images || []).filter(item => !item.hidden).map(item => ({ ...item, key: `library:${item.id}`, url: apiUrl(item.url), source: { kind: "library", id: item.id } }));
      const chatImages = (sessions.images || sessions || []).filter(item => !item.hidden).map(item => ({ ...item, key: `session:${item.session_id}:${item.image_id}`, url: item.url.startsWith("http") ? item.url : apiUrl(item.url), source: libraryApi.sourceFor(item) }));
      setLibrary([...libraryImages, ...chatImages]);
    });
  }
  async function saveSelection(value) {
    try { const data = await api.save(current.current, value); accept(data); await refreshList();
      const saved = value.id ? data.selections.find(item => item.id === value.id) : data.selections[data.selections.length - 1];
      if (value.id === focusId) { setFilters(focusFilters(saved)); setParts([saved.part]); }
      return saved;
    }
    catch (failure) { if (failure.status === 409) await refresh().catch(() => {}); throw failure; }
  }
  const decide = state => guard(async () => { accept(await api.decide(current.current, [...selected], state)); setSelected(new Set()); await refreshList(); });
  function useFocus(reference) { setFocusId(reference.id); setFocusNotes(focusDescription(reference)); setParts([reference.part]); setFilters(focusFilters(reference)); setOnlySource(false); }
  function clearFocus() { setFocusId(""); setFocusNotes(""); setFilters({ part: "", side: "", view: "", state: "", detail: "" }); setParts(DEFAULT_PARTS); }
  function chooseRegion(part, side = "") { setFocusId(""); setFocusNotes(""); setFilters(value => ({ ...value, part, side, detail: "" })); setParts(part ? [part] : DEFAULT_PARTS); }
  function drawFocus() { setEditor(newSelection(source.id, filters.part || "custom", filters.side || "unspecified")); }

  return <div className="character-studio">
    <header className="character-header"><div><span className="character-eyebrow">Training image curation</span><h1>Character Parts</h1><p>Select any area, compare it with a reference, and curate the examples you want.</p></div></header>
    {dataset && <section className="character-exports" aria-label="Export character media"><div className="character-actions">
      <button disabled={disabled || !selected.size} onClick={() => exportMedia("selected")}>Export Selected Media ({selected.size})</button>
      <button disabled={disabled || !acceptedCount} onClick={() => exportMedia("approved")}>Export Approved Media ({acceptedCount})</button>
      <button disabled={disabled || !rejectedCount} onClick={() => exportMedia("rejected")}>Export Reject Media ({rejectedCount})</button>
    </div><p className="character-help">ZIP copies with captions and a manifest. Selected uses checked items; approved and reject include the entire dataset, across filters. Each item keeps its Full image / Crop export choice.</p></section>}
    {error && <p className="character-error" role="alert">{error}</p>}{notice && <p className="character-notice" role="status">{notice}</p>}
    <div className="character-datasets"><label>Character dataset<select value={datasetId} disabled={disabled || running} onChange={event => setDatasetId(event.target.value)}><option value="">Choose a dataset</option>{datasets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <form onSubmit={event => { event.preventDefault(); guard(async () => { const data = await api.create(newName); await refreshList(); setDatasetId(data.id); setNewName(""); }); }}><label>New dataset name<input value={newName} maxLength={120} disabled={disabled || running} onChange={event => setNewName(event.target.value)} placeholder="Character name or training set" /></label><button disabled={disabled || running || !newName.trim()}>Create dataset</button></form>
    </div>
    {!dataset ? <div className="character-empty"><h2>Build a complete character training set</h2><p>Create a dataset, import source images, then review suggested regions or draw your own crops.</p><p>Full images and crops can be accepted separately for export. Rejected selections remain recoverable.</p></div> : <>
      <div className="character-actions">
        {desktop?.chooseFaceInputs ? <><button disabled={disabled} onClick={() => pickDesktop(false)}>Import files</button><button disabled={disabled} onClick={() => pickDesktop(true)}>Import folder</button></> : <label className="character-file-button">Import images<FreshFileInput type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={disabled} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) importImages(() => browserFaceSource(files)); }} /></label>}
        <button disabled={disabled} onClick={openLibrary}>Choose from library</button>
        {importing && <button onClick={() => { importRef.current.cancelled = true; }}>Stop import</button>}
        <span>{dataset.sources.length} source images · {dataset.selections.length} selections</span>
      </div>
      <div className="character-workspace">{catalog && <CharacterSilhouette part={filters.part} side={filters.side} onSelect={chooseRegion} catalog={catalog} />}
        <main className="character-content">
          {catalog && <CharacterFocus dataset={dataset} reference={focus} catalog={catalog} description={focusNotes} onDescription={setFocusNotes} onEdit={() => setEditor(focus)} onClear={clearFocus} onDraw={drawFocus} disabled={disabled || !source || running} />}
          <section className="character-source-section"><h2>Source images</h2>
            <div className="character-source-strip">{dataset.sources.slice(sourcePage * PAGE_SIZE, (sourcePage + 1) * PAGE_SIZE).map(item => <button type="button" key={item.id} aria-pressed={sourceId === item.id} aria-label={`Use source ${item.name}`} onClick={() => setSourceId(item.id)}><ProtectedImage src={api.sourceUrl(datasetId, item.id, true)} alt="" loading="lazy" /><span>{item.name}</span><small>{item.analysis ? "Analyzed" : "Not analyzed"}</small></button>)}</div>
            {!dataset.sources.length && <p className="character-help">Import images to begin. Originals are kept for later adjustments.</p>}
            {dataset.sources.length > PAGE_SIZE && <div className="character-actions"><button disabled={!sourcePage} onClick={() => setSourcePage(value => value - 1)}>Previous sources</button><span>{sourcePage + 1} / {Math.ceil(dataset.sources.length / PAGE_SIZE)}</span><button disabled={(sourcePage + 1) * PAGE_SIZE >= dataset.sources.length} onClick={() => setSourcePage(value => value + 1)}>Next sources</button></div>}
            {source && <><div className="character-actions"><strong>{source.name}</strong><button disabled={disabled || !catalog} onClick={drawFocus}>Draw a selection</button><button disabled={disabled || !catalog} onClick={() => setEditor(newSelection(source.id, "custom"))}>Select any area</button></div><CaptionEditor key={source.id} source={source} busy={disabled} onSave={caption => guard(async () => accept(await api.saveCaption(current.current, source.id, caption)))} />{source.analysis?.warnings?.length > 0 && <p className="character-flags">{source.analysis.warnings.join(" · ")}</p>}</>}
          </section>
          <details className="character-analysis" open><summary>Suggest regions and viewing angles</summary>
            <fieldset disabled={disabled || running}><div className="character-analysis-fields"><label>Local vision model<select value={model} onChange={event => setModel(event.target.value)}><option value="">Choose a vision model</option>{catalog?.models.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></label><label>Character to focus on (optional)<input value={subjectHint} maxLength={500} onChange={event => setSubjectHint(event.target.value)} placeholder="e.g. person in blue on the left" /></label></div>
              {focus ? <p className="character-help">Suggesting {catalog.parts[focus.part]} using your reference crop and focus description.</p> : <details><summary>Regions to suggest ({parts.length})</summary><div className="character-part-checks">{catalog && Object.entries(catalog.parts).filter(([id]) => id !== "custom").map(([id, name]) => <label key={id}><input type="checkbox" checked={parts.includes(id)} onChange={event => setParts(current => event.target.checked ? [...current, id] : current.filter(value => value !== id))} />{name}</label>)}</div></details>}
              {!focus && parts.includes("custom") && <p className="character-help">Draw and name an area, then choose Use as focus to suggest that area in other images.</p>}
              <div className="character-actions"><button className="character-primary" disabled={!source || !model || !parts.length || (!focus && parts.includes("custom"))} onClick={() => startAnalysis([source.id])}>{focus ? "Suggest focused area in this image" : source?.analysis ? "Analyze this image again" : "Analyze this image"}</button>{focus ? <button disabled={!model || !dataset.sources.some(item => item.id !== focus.source_id)} onClick={() => startAnalysis(dataset.sources.filter(item => item.id !== focus.source_id).slice(0, 500).map(item => item.id))}>Find this region in other images</button> : <button disabled={!model || !parts.length || parts.includes("custom") || !dataset.sources.some(item => !item.analysis)} onClick={() => startAnalysis(dataset.sources.filter(item => !item.analysis).slice(0, 500).map(item => item.id))}>Analyze remaining images</button>}</div>
            </fieldset>
            {catalog && !catalog.models.length && <p className="character-help">No local vision model is available. You can still draw and label selections manually.</p>}
            <p className="character-help">Suggestions are approximate. Check small fingers and toes, occluded regions, and left/right labels before accepting.</p>
            {run && <div className="character-run" role="status"><strong>{run.message}</strong><span>{run.processed} / {run.total} images</span>{running && <><progress max={run.total} value={run.processed} /><button disabled={run.status === "cancelling"} onClick={() => guard(async () => { setRun((await api.stop(datasetId, run.id)).run); await refresh(); })}>{run.status === "cancelling" ? "Stopping…" : "Stop analysis"}</button></>}{run.errors.length > 0 && <details><summary>{run.errors.length} image errors</summary>{run.errors.map((item, i) => <p key={i}>{dataset.sources.find(source => source.id === item.source_id)?.name}: {item.message}</p>)}</details>}</div>}
          </details>
          {catalog && <section className="character-selections"><h2>Review selections</h2><div className="character-filters">
            <label>Region<select value={filters.part} onChange={event => chooseRegion(event.target.value)}><option value="">All regions</option>{Object.entries(catalog.parts).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>Side<select value={filters.side} onChange={event => setFilters(value => ({ ...value, side: event.target.value }))}><option value="">All sides</option>{Object.entries(catalog.sides).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>View<select value={filters.view} onChange={event => setFilters(value => ({ ...value, view: event.target.value }))}><option value="">All viewing angles</option>{Object.entries(catalog.views).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label>Review state<select value={filters.state} onChange={event => setFilters(value => ({ ...value, state: event.target.value }))}><option value="">All selections</option><option value="pending">Not yet reviewed</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></label>
          </div><label className="character-inline-check"><input type="checkbox" checked={onlySource} onChange={event => setOnlySource(event.target.checked)} />Current source image only</label>
            <div className="character-actions"><button disabled={!visible.length} onClick={() => setSelected(new Set(visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(item => item.id)))}>Select this page</button><button disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear selection</button><span>{selected.size} selected · {visible.length} matching</span>{["accepted", "rejected", "pending"].map(state => <button key={state} disabled={disabled || !selected.size} onClick={() => decide(state)}>{state === "accepted" ? "Accept" : state === "rejected" ? "Reject" : "Review later"}</button>)}</div>
            <div className="character-selection-grid">{visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(item => <article key={item.id} className={`character-tile ${item.state} ${item.id === focusId ? "focus-reference" : ""}`}>
              <label className="character-tile-select"><input type="checkbox" aria-label={`Select ${catalog.parts[item.part]} ${item.detail}`} checked={selected.has(item.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} /><span>{item.state === "pending" ? "Unreviewed" : item.state}</span></label>
              <button className="character-tile-image" type="button" onClick={() => setEditor(item)} aria-label={`Review ${catalog.parts[item.part]} ${item.detail}`}><ProtectedImage src={api.cropUrl(datasetId, item.id, dataset.revision)} alt={`${catalog.parts[item.part]} crop`} loading="lazy" /></button>
              {selected.has(item.id) && <MediaCardActions image={{ id: item.id, name: `${catalog.parts[item.part]} ${item.detail} crop`, url: api.cropUrl(datasetId, item.id, dataset.revision) }} />}
              <div className="character-tile-info"><strong>{catalog.parts[item.part]}{item.detail ? ` · ${item.detail}` : ""}</strong><span>{catalog.sides[item.side]} · {catalog.views[item.view]}</span><small>{dataset.sources.find(source => source.id === item.source_id)?.name}</small><small>{item.export_mode === "both" ? "Full image + crop" : item.export_mode === "full" ? "Full image only" : "Crop only"}</small>{item.flags.length > 0 && <small className="character-flags">{item.flags.join(" · ")}</small>}{item.notes && <details><summary>{item.focus ? "Reference comparison" : "Review notes"}</summary>{earlierFocus(item, focus) && <small>Analysis used an earlier reference.</small>}<p>{item.notes}</p></details>}<button type="button" disabled={disabled || running || item.id === focusId} onClick={() => useFocus(item)}>{item.id === focusId ? "Current focus" : "Use as focus"}</button></div>
            </article>)}</div>
            {!visible.length && <p className="character-help">No selections match. Analyze an image, draw a region, or change the filters.</p>}
            {visible.length > PAGE_SIZE && <div className="character-actions"><button disabled={!page} onClick={() => setPage(value => value - 1)}>Previous selections</button><span>{page + 1} / {Math.ceil(visible.length / PAGE_SIZE)}</span><button disabled={(page + 1) * PAGE_SIZE >= visible.length} onClick={() => setPage(value => value + 1)}>Next selections</button></div>}
          </section>}
          {catalog && <details className="character-coverage"><summary>Training coverage · accepted source images by region and view</summary><div className="character-table-scroll"><table><thead><tr><th>Region</th>{Object.entries(catalog.views).map(([id, name]) => <th key={id}>{name}</th>)}</tr></thead><tbody>{Object.entries(catalog.parts).map(([id, name]) => <tr key={id}><th>{name}</th>{Object.keys(catalog.views).map(view => <td key={view}>{counts[`${id}:${view}`] || "—"}</td>)}</tr>)}</tbody></table></div></details>}
        </main>
      </div>
    </>}
    {editor && dataset && catalog && <CharacterRegionEditor key={editor.id || `new:${editor.source_id}`} initial={editor} source={dataset.sources.find(item => item.id === editor.source_id)} dataset={dataset} catalog={catalog} reference={focus} onFocus={running ? null : useFocus} onSave={saveSelection} onClose={() => setEditor(null)} />}
    {library && <LibraryPicker images={library} busy={busy} onClose={() => setLibrary(null)} onImport={sources => guard(async () => { const result = await api.importSources(datasetId, sources); accept(result.dataset); setNotice(`${result.added} source images imported${result.errors.length ? `; ${result.errors.length} failed: ${result.errors.map(item => item.message).join("; ")}` : ""}.`); setLibrary(null); await refreshList(); })} />}
  </div>;
}
