import ProtectedImage from "../ImagePrivacy";
import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../api";
import * as api from "../imageWorkflowApi";
import CollectionPager from "./CollectionPager";
import WorkflowExportControls from "./WorkflowExportControls";
import ImageViewer from "./ImageViewer";
import ImageItemActions from "./ImageItemActions";
import { useAnalyzeIterate } from "../AnalyzeIterateContext";
import BulkActions from "./BulkActions";
import { useSelection } from "../useSelection";

export function workflowViewerImages(runs) {
  return runs.flatMap(run => [...run.outputs.map(output => ({ ...output, name: `Stage ${output.stage_number}` })),
    ...run.composites.map(item => ({ ...item, id: item.layout, name: `Stitched ${item.layout}` }))]
    .map(image => ({ ...image, id: `${run.workflow_id}:${run.id}:${image.id}`, url: apiUrl(image.url),
      caption: `${run.workflow_name} · Run ${run.id.slice(0, 8)}`, run })));
}

export function WorkflowImageCards({ runs, onOpen, selection }) {
  return runs.map(run => <section className="workflow-library-run" key={`${run.workflow_id}:${run.id}`}>
    <h3>{run.workflow_name}</h3>
    <small>Run {run.id.slice(0, 8)} · {new Date(run.created_at).toLocaleString()}</small>
    <div className="image-gallery image-gallery-compact">
      {[...run.outputs.map(output => ({ ...output, name: `Stage ${output.stage_number}` })),
        ...run.composites.map(item => ({ ...item, id: item.layout, name: `Stitched ${item.layout}` }))].map(image =>
        <div className="gallery-item-row" key={image.id}><button className="gallery-item" type="button" title={`Open ${image.name} · ${run.workflow_name}`}
          aria-pressed={selection?.enabled ? selection.ids.has(`${run.workflow_id}:${run.id}:${image.id}`) : undefined}
          onClick={() => onOpen({ run, image })}>
          <span className="gallery-thumbnail"><ProtectedImage loading="lazy" src={apiUrl(image.url)} alt={`${run.workflow_name} · ${image.name}`} /></span>
          <span className="gallery-details"><span className="gallery-name">{image.name}</span></span>
        </button>{selection?.ids.has(`${run.workflow_id}:${run.id}:${image.id}`) && <ImageItemActions image={{ ...image, run, id: `${run.workflow_id}:${run.id}:${image.id}`, url: apiUrl(image.url) }} />}</div>)}
    </div>
    <button type="button" onClick={() => onOpen({ run, image: null })}>Save / stitch this run ({run.outputs.length})</button>
  </section>);
}

export default function WorkflowImageLibrary({ active, onFile, onLock, searchQuery, workspace = false }) {
  const iterate = useAnalyzeIterate();
  const [runs, setRuns] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [localQuery, setQuery] = useState("");
  const query = searchQuery ?? localQuery;
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const dialog = useRef(null);
  const allImages = workflowViewerImages(runs);
  const selection = useSelection(allImages);
  useEffect(() => { setPage(0); }, [query]);

  useEffect(() => {
    if (!active) return;
    let ignore = false, timer;
    async function load() {
      try {
        const data = await api.images();
        if (!ignore) { setRuns(data.runs); setWarnings(data.warnings); setError(""); setLoaded(true); }
      } catch (err) { if (!ignore) setError(err.message); }
      if (!ignore) timer = setTimeout(load, 10000);
    }
    load();
    return () => { ignore = true; clearTimeout(timer); };
  }, [active, refresh]);

  useEffect(() => {
    const changed = () => { setSelectedImageId(null); setSelected(null); setRefresh(value => value + 1); };
    window.addEventListener("image-library-changed", changed);
    const storage = event => { if (event.key === "image-library-revision") changed(); };
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener("image-library-changed", changed); window.removeEventListener("storage", storage); };
  }, []);

  useEffect(() => {
    if (selected && active) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected, active]);

  const filtered = runs.filter(run => `${run.workflow_name} ${run.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 4));
  const currentPage = Math.min(page, pages - 1);
  return <section className="workflow-image-library" aria-label="Workflow Images folder">
    <div className={`collection-toolbar ${workspace ? "image-library-results" : ""}`}>
      <div className="collection-heading"><span>Workflow Images ({runs.reduce((count, run) => count + run.outputs.length + run.composites.length, 0)})</span>
        <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
      {!workspace && <input type="search" aria-label="Search workflow images" placeholder="Search workflows or runs…" value={query}
        onChange={event => { setQuery(event.target.value); setPage(0); }} />}
      <CollectionPager label="workflow runs" page={currentPage} pages={pages} onChange={setPage} />
    </div>
    <p className="workflow-muted">Completed workflow images and stitched references, separate from Generate and chat images.</p>
    {(onFile || onLock) && <BulkActions selection={selection} items={workflowViewerImages(filtered)} label="workflow images" actions={[
      ...(onFile ? [{label:"Add selected to folder", onClick:onFile}] : []),
      ...(onLock ? [{label:"Lock selected images", onClick:onLock}] : []),
    ]} />}
    {error && <p className="workflow-error" role="alert">{error}</p>}
    {warnings.map(warning => <p className="workflow-error" key={warning}>{warning}</p>)}
    {!loaded && !error && <p role="status">Loading workflow images…</p>}
    {loaded && !filtered.length && <p className="gallery-empty">{query ? "No matching workflows." : "Completed workflow images will appear here automatically."}</p>}
    <WorkflowImageCards runs={filtered.slice(currentPage * 4, currentPage * 4 + 4)} selection={selection} onOpen={picked => {
      if (picked.image) {
        const id = `${picked.run.workflow_id}:${picked.run.id}:${picked.image.id}`;
        if (selection.enabled) selection.toggle(allImages.find(image => image.id === id));
        else setSelectedImageId(id);
      } else setSelected(picked);
    }} />
    <ImageViewer images={workflowViewerImages(filtered)} selectedId={selectedImageId} active={active && !selection.enabled}
      onAnalyze={iterate?.image}
      onSelect={setSelectedImageId} onClose={() => setSelectedImageId(null)}
      actions={image => <><button type="button" onClick={() => { setSelectedImageId(null); setSelected({run:image.run, image:null}); }}>Save / stitch this run</button>
        {onFile && <button type="button" onClick={() => { setSelectedImageId(null); onFile([image]); }}>Add to folder</button>}
        {onLock && <button type="button" onClick={() => { setSelectedImageId(null); onLock([image]); }}>Lock image</button>}</>} />
    <dialog ref={dialog} className="workflow-image-dialog" aria-label="Workflow image preview" onClose={() => setSelected(null)}>
      {selected && <>
        <header><h2>{selected.run.workflow_name} · Run {selected.run.id.slice(0, 8)}</h2><button type="button" autoFocus onClick={() => setSelected(null)}>Close preview</button></header>
        {selected.image && <figure><ProtectedImage src={apiUrl(selected.image.url)} alt={selected.image.name} /><figcaption>{selected.image.name} · {selected.image.width} × {selected.image.height}</figcaption></figure>}
        {selected.image?.layout && <a href={`${api.stitchedUrl(selected.run.workflow_id, selected.run.id, selected.image.layout)}?download=true`} download>Save this stitched PNG</a>}
        <WorkflowExportControls key={`${selected.run.workflow_id}:${selected.run.id}`} record={selected.run}
          onCreated={() => setRefresh(value => value + 1)} />
        <p className="workflow-muted">To use a stitched image as a reference, save its PNG and attach it to any workflow or chat. The Image Workflows run panel also has Keep stitched as reference.</p>
      </>}
    </dialog>
  </section>;
}
