import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as faces from "../faceApi";
import { list as listLibrary, imageUrl } from "../imageLibraryApi";
import FreshFileInput from "./FreshFileInput";
import FaceBank from "./FaceBank";
import ProtectedImage from "../ImagePrivacy";
import MediaCardActions from "./MediaCardActions";
import CharacterNameDialog from "./CharacterNameDialog";
import { browserFaceSource, desktopFaceSource, scanFaceBatches } from "../faceImport";
import "./FaceStudio.css";

const SORTS = [
  { id: "added", label: "Date added" },
  { id: "similarity", label: "Similarity to reference" },
  { id: "filename", label: "Source filename" },
  { id: "confidence", label: "Detection confidence" },
  { id: "size", label: "Face size" },
  { id: "sharpness", label: "Sharpness" },
  { id: "cluster", label: "Cluster" },
];
const FILTERS = [
  { id: "all", label: "All faces" },
  { id: "pending", label: "Not yet decided" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
  { id: "flagged", label: "Quality flags" },
  { id: "duplicates", label: "Duplicates" },
  { id: "outliers", label: "Outliers" },
  { id: "similar", label: "Similar to reference" },
];
const TERMINAL = new Set(["complete", "error", "cancelled"]);

export default function FaceStudio({ active }) {
  const [providers, setProviders] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [datasetId, setDatasetId] = useState("");
  const [dataset, setDataset] = useState(null);
  const [run, setRun] = useState(null);
  const [runName, setRunName] = useState("");
  const [runHistory, setRunHistory] = useState([]);
  const [renamingRun, setRenamingRun] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [reference, setReference] = useState("");
  const [scores, setScores] = useState(null);
  const [threshold, setThreshold] = useState(0.45);
  const [view, setView] = useState({ sort: "added", order: "desc", filter: "all", search: "" });
  const [revision, setRevision] = useState(0);
  const [library, setLibrary] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState("extractor");
  const [characterDraft, setCharacterDraft] = useState(null);
  const [importProgress, setImportProgress] = useState(null);
  const [importing, setImporting] = useState(false);
  const importRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => () => { importRef.current?.abort(); }, []);

  const ready = providers.some((item) => item.ready);
  const provider = providers[0];

  const refreshDatasets = useCallback(async () => {
    const data = await faces.listDatasets();
    setDatasets(data.datasets);
    return data.datasets;
  }, []);

  // Switching datasets quickly can resolve loads out of order; only the most
  // recently requested dataset may update the view.
  const claimLoad = useMemo(() => faces.latestRequest(), []);
  const loadDataset = useCallback(async (id) => {
    const isCurrent = claimLoad();
    if (!id) return setDataset(null);
    const data = await faces.getDataset(id);
    const runs = (await faces.listRuns(id)).runs;
    if (!isCurrent()) return null;
    setDataset(data);
    setRun(data.run);
    setRunHistory(runs);
    if (data.settings) setThreshold(data.settings.similar_threshold);
    return data;
  }, [claimLoad]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      try {
        const [catalog, list] = await Promise.all([faces.listProviders(), refreshDatasets()]);
        if (!alive) return;
        setProviders(catalog.providers);
        if (!datasetId && list.length) setDatasetId(list[0].id);
      } catch (failure) {
        if (alive) setError(failure.message);
      }
    })();
    return () => { alive = false; };
  }, [active, refreshDatasets]);

  useEffect(() => { loadDataset(datasetId).catch((failure) => setError(failure.message)); }, [datasetId, loadDataset]);

  // Poll only while an extraction is actually running.
  useEffect(() => {
    if (importing || !datasetId || !run || TERMINAL.has(run.status)) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const next = (await faces.getRun(datasetId)).run;
        if (!alive) return;
        setRun(next);
        if (next && TERMINAL.has(next.status)) {
          await loadDataset(datasetId);
          await refreshDatasets();
        }
      } catch { /* transient; the next tick retries */ }
    }, 900);
    return () => { alive = false; clearInterval(timer); };
  }, [datasetId, run?.status, importing, loadDataset, refreshDatasets]);

  const allFaces = dataset?.faces || [];
  const visible = useMemo(
    () => faces.arrangeFaces(allFaces, { ...view, scores, threshold }),
    [allFaces, view, scores, threshold]
  );

  async function guard(label, action) {
    setBusy(label); setError(""); setNotice("");
    try { return await action(); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(""); }
  }

  const installModels = () => guard("install", async () => {
    setNotice("Downloading face models (about 190 MB). This runs once.");
    const status = await faces.installModels();
    setProviders((current) => current.map((item) => (item.key === status.key ? status : item)));
    setNotice(status.ready ? "Face models installed." : status.detail);
  });

  const newDataset = () => guard("dataset", async () => {
    const created = await faces.createDataset(`Faces ${new Date().toLocaleDateString()}`);
    await refreshDatasets();
    setDatasetId(created.id);
    setImportProgress(null);
    setSelected(new Set()); setScores(null); setReference("");
  });

  const removeDataset = () => guard("dataset", async () => {
    if (!window.confirm(`Delete "${dataset.name}" and its face crops? Source images are not touched.`)) return;
    await faces.deleteDataset(datasetId);
    const list = await refreshDatasets();
    setDatasetId(list[0]?.id || "");
    setImportProgress(null);
  });

  async function importImages(openSource) {
    if (importRef.current || !datasetId || (run && !TERMINAL.has(run.status))) return;
    const controller = new AbortController();
    importRef.current = controller;
    setImporting(true); setError(""); setNotice(""); setImportProgress(null);
    try {
      const source = await openSource();
      if (!source) return;
      const result = await scanFaceBatches({ datasetId, source, api: faces, signal: controller.signal, onProgress: setImportProgress, runName });
      setNotice(result.message);
    } catch (failure) { setError(failure.message); }
    finally {
      try { await loadDataset(datasetId); await refreshDatasets(); }
      catch (failure) { setError(failure.message); }
      importRef.current = null; setImporting(false);
    }
  }

  function startUpload(input) {
    const files = Array.from(input || []);
    if (files.length) return importImages(async () => browserFaceSource(files));
  }

  // The desktop chooser keeps its own privacy rules (always starts at home,
  // never records the folder); the browser build uses multi-select instead.
  const desktop = typeof window !== "undefined" && window.workstationDesktop;
  const pickImages = directory => importImages(async () => {
    const result = await desktop.chooseFaceInputs({ directory });
    if (result?.error) throw new Error(result.error);
    if (result?.canceled) return null;
    return desktopFaceSource(desktop, result);
  });

  const scanLibrary = (ids) => guard("scan", async () => {
    setImportProgress(null);
    const sources = ids.map((id) => ({ kind: "library", id }));
    setRun(await faces.extractFrom(datasetId, sources, runName));
    setLibrary(null);
  });

  const stop = () => guard("scan", async () => {
    if (importRef.current) {
      importRef.current.abort();
      setImportProgress(current => current && ({ ...current, status: "cancelling", message: "Stopping the current image; keeping faces already extracted…" }));
      return;
    }
    setRun((await faces.stopRun(datasetId)).run);
    await loadDataset(datasetId);
  });

  const changeSetting = (key, value) => guard("settings", async () => {
    setDataset(await faces.saveSettings(datasetId, { [key]: value }));
  });

  const applyRecrop = () => guard("recrop", async () => {
    const result = await faces.recrop(datasetId, [...selected]);
    await loadDataset(datasetId);
    setRevision((value) => value + 1);
    setNotice(`Re-cropped ${result.recropped} face${result.recropped === 1 ? "" : "s"}.`);
  });

  const decide = (state) => guard("state", async () => {
    await faces.setFaceState(datasetId, [...selected], state);
    await loadDataset(datasetId);
    await refreshDatasets();
    setNotice(`${selected.size} face${selected.size === 1 ? "" : "s"} marked ${state}.`);
    setSelected(new Set());
  });

  const removeSelected = () => guard("state", async () => {
    if (!window.confirm(`Remove ${selected.size} face crop(s) from this dataset? Source images are not touched.`)) return;
    await faces.removeFaces(datasetId, [...selected]);
    await loadDataset(datasetId);
    setSelected(new Set());
  });

  const findSimilar = (faceId) => guard("similar", async () => {
    const result = await faces.findSimilar(datasetId, faceId, threshold);
    setScores(result.scores);
    setReference(faceId);
    setView((current) => ({ ...current, sort: "similarity", order: "desc", filter: "similar" }));
    setNotice(`${result.matches.length} face(s) at or above ${threshold.toFixed(2)}. Similar looks alike — it is not a confirmed identity.`);
  });

  const analyse = () => guard("analyse", async () => {
    const [dupes, groups] = [await faces.findDuplicates(datasetId), await faces.runCluster(datasetId)];
    await loadDataset(datasetId);
    setNotice(`${groups.clusters} cluster(s), ${groups.outliers} outlier(s), ${dupes.duplicates} duplicate(s).`);
  });

  // The bridge from a curated dataset to a reusable identity: the character
  // records these face ids, it does not copy their crops.
  function nameCharacter() {
    if (!datasetId || !selected.size || busy) return;
    setError(""); setNotice("");
    setCharacterDraft({ datasetId, faceIds: [...selected] });
  }

  async function saveAsCharacter(name) {
    await faces.createCharacter({ name, dataset_id: characterDraft.datasetId, face_ids: characterDraft.faceIds });
    setNotice(`Character "${name}" saved with ${characterDraft.faceIds.length} reference face(s). Open the Character Bank to curate it.`);
    setSelected(new Set());
  }

  const saveToFolder = () => guard("export", async () => {
    const faceIds = selected.size ? [...selected] : allFaces.map(face => face.id);
    const result = await desktop.saveFaceFolder({ datasetId, faceIds });
    if (result?.error) throw new Error(result.error);
    if (result?.canceled) return;
    setNotice(`Saved ${result.saved} of ${result.total} face crops to ${result.folder}`);
    if (result.saved !== result.total) setError("Some crops could not be saved. Completed copies are in the folder; the original extracted faces are still available.");
  });

  const openLibrary = () => guard("library", async () => {
    const data = await listLibrary();
    setLibrary({ images: (data.images || []).filter((item) => !item.hidden).map(imageUrl), chosen: new Set() });
  });

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function onDrop(event) {
    event.preventDefault();
    setDragging(false);
    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("image/"));
    if (files.length) startUpload(files);
  }

  const running = importing || (run && !TERMINAL.has(run.status));
  const progress = importing ? importProgress : run;

  return <section className="face-studio">
    <header className="face-header">
      <div>
        <p className="face-eyebrow">Character datasets</p>
        <h1>Face Extractor</h1>
        <p className="face-note">Import images, detect every face, crop and compare them, then export a dataset. Source images are never modified.</p>
      </div>
      <div className="face-modes" role="tablist">
        {/* Clear this view's messages on the way out; a notice about a dataset
            is confusing once the character bank is on screen. */}
        <button type="button" role="tab" aria-selected={mode === "extractor"}
                className={mode === "extractor" ? "active" : ""}
                onClick={() => { setMode("extractor"); setNotice(""); setError(""); }}>Extractor</button>
        <button type="button" role="tab" aria-selected={mode === "bank"}
                className={mode === "bank" ? "active" : ""}
                onClick={() => { setMode("bank"); setNotice(""); setError(""); }}>Character Bank</button>
      </div>
      <div className="face-dataset-picker" hidden={mode !== "extractor"}>
        <label htmlFor="face-dataset">Dataset</label>
        <select id="face-dataset" value={datasetId} disabled={running} onChange={(event) => { setDatasetId(event.target.value); setSelected(new Set()); setScores(null); setReference(""); setImportProgress(null); }}>
          {!datasets.length && <option value="">No datasets yet</option>}
          {datasets.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.face_count} faces</option>)}
        </select>
        <button type="button" onClick={newDataset} disabled={busy === "dataset" || running}>New dataset</button>
        {dataset && <button type="button" onClick={removeDataset} disabled={Boolean(busy) || running}>Delete</button>}
      </div>
    </header>

    {!ready && provider && <div className="face-banner" role="status">
      <strong>{provider.name}</strong>
      <p>{provider.detail}</p>
      <button type="button" onClick={installModels} disabled={busy === "install"}>
        {busy === "install" ? "Downloading…" : "Install face models"}
      </button>
    </div>}
    {ready && provider && <p className="face-device">Detector: {provider.name} · running on {provider.device.toUpperCase()}</p>}

    {error && <p className="face-alert" role="alert">{error}</p>}
    {notice && <p className="face-notice" role="status">{notice}</p>}

    {mode === "bank" && <FaceBank onOpenExtractor={() => setMode("extractor")} />}

    {mode === "extractor" && !dataset && ready && <p className="face-note">Create a dataset to begin.</p>}

    {mode === "extractor" && dataset && <>
      <div className={`face-import ${dragging ? "dragging" : ""}`}
           onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
           onDragLeave={() => setDragging(false)}
           onDrop={onDrop}>
        <h2>1 · Import images</h2>
        <label className="face-run-name">Run name<input value={runName} maxLength={120} disabled={running} onChange={event => setRunName(event.target.value)} placeholder="e.g. Alex · outdoor portraits" /></label>
        <p className="face-note">Drop images here, choose files or folders, or pick from your image library. Every visible face is detected — not just the largest. Large file and folder selections are processed in batches automatically.</p>
        <div className="face-row">
          <FreshFileInput ref={fileRef} accept="image/png,image/jpeg,image/webp,image/gif" multiple
                          disabled={!ready || running}
                          onClick={event => { if (desktop?.chooseFaceInputs) { event.preventDefault(); pickImages(false); } }}
                          onChange={(event) => { startUpload([...event.target.files]); event.target.value = ""; }} />
          {desktop?.chooseFaceInputs && <button type="button" onClick={() => pickImages(true)} disabled={!ready || running || busy === "scan"}>Choose a folder</button>}
          <button type="button" onClick={openLibrary} disabled={!ready || running || busy === "library"}>Add from image library</button>
          {running && <button type="button" onClick={stop}>Stop scanning</button>}
        </div>
        {running && <div className="face-progress">
          <progress aria-label="Images scanned" max={progress?.total || 1} value={progress ? progress.processed : undefined} />
          <span>{runName || run?.name || "Face scan"} · {progress ? `${progress.processed} / ${progress.total} images · ${progress.faces || 0} faces. ${progress.message}` : "Opening image selection…"}</span>
        </div>}
        {!running && (importProgress || run)?.errors?.length > 0 && <details className="face-errors">
          <summary>{(importProgress || run).error_count || (importProgress || run).errors.length} image(s) could not be scanned</summary>
          <ul>{(importProgress || run).errors.map((item, index) => <li key={index}>{item.source}: {item.error}</li>)}</ul>
        </details>}
      </div>

      <details className="face-run-history"><summary>Named run history ({runHistory.length})</summary>{runHistory.map(item => <div className="face-row" key={item.id}><span><strong>{item.name}</strong> · {item.status} · {item.processed}/{item.total} images · {new Date(item.started_at).toLocaleString()}</span><button disabled={running || Boolean(busy)} onClick={() => setRenamingRun(item)}>Rename</button></div>)}</details>
      {renamingRun && <CharacterNameDialog initialName={renamingRun.name} fieldLabel="Run name" saveLabel="Save run name" title="Rename face run" onClose={() => setRenamingRun(null)} onSave={async name => { await faces.renameRun(datasetId, renamingRun.id, name); setRunHistory((await faces.listRuns(datasetId)).runs); setRenamingRun(null); }} />}

      {library && <div className="face-library" role="dialog" aria-label="Choose library images">
        <div className="face-row face-library-head">
          <strong>Pick images to scan ({library.chosen.size} selected)</strong>
          <button type="button" onClick={() => scanLibrary([...library.chosen])} disabled={!library.chosen.size}>Scan selected</button>
          <button type="button" onClick={() => setLibrary(null)}>Cancel</button>
        </div>
        <div className="face-library-grid">
          {library.images.map((item) => <button type="button" key={item.id}
            className={library.chosen.has(item.id) ? "chosen" : ""}
            onClick={() => setLibrary((current) => {
              const chosen = new Set(current.chosen);
              chosen.has(item.id) ? chosen.delete(item.id) : chosen.add(item.id);
              return { ...current, chosen };
            })}>
            <img src={item.url} alt={item.name} loading="lazy" />
          </button>)}
          {!library.images.length && <p className="face-note">Your image library is empty.</p>}
        </div>
      </div>}

      <div className="face-settings">
        <h2>2 · Crop &amp; quality</h2>
        <div className="face-row">
          <label>Crop
            <select value={dataset.settings.crop_mode} onChange={(event) => changeSetting("crop_mode", event.target.value)}>
              <option value="tight">Tight face</option>
              <option value="head">Head</option>
              <option value="portrait">Portrait</option>
            </select>
          </label>
          <label>Padding {dataset.settings.padding.toFixed(2)}
            <input type="range" min="-0.5" max="1.5" step="0.05" value={dataset.settings.padding}
                   onChange={(event) => changeSetting("padding", Number(event.target.value))} />
          </label>
          <label>Output
            <select value={dataset.settings.size} onChange={(event) => changeSetting("size", Number(event.target.value))}>
              <option value={0}>Original crop</option>
              <option value={512}>512 × 512</option>
              <option value={768}>768 × 768</option>
              <option value={1024}>1024 × 1024</option>
            </select>
          </label>
          <label>Detect threshold {dataset.settings.detect_threshold.toFixed(2)}
            <input type="range" min="0.1" max="0.95" step="0.05" value={dataset.settings.detect_threshold}
                   onChange={(event) => changeSetting("detect_threshold", Number(event.target.value))} />
          </label>
          <button type="button" onClick={applyRecrop} disabled={!allFaces.length || running || busy === "recrop"}>
            {busy === "recrop" ? "Re-cropping…" : selected.size ? `Re-crop ${selected.size} selected` : "Re-crop all"}
          </button>
        </div>
        <p className="face-note">Crops stay square and never read past the image edge. Output sizes pad rather than stretch. Re-crop reuses the stored detections; it does not scan again.</p>
      </div>

      <div className="face-browser">
        <h2>3 · Browse, compare &amp; select</h2>
        <div className="face-row face-toolbar">
          <label>Sort
            <select value={view.sort} onChange={(event) => setView({ ...view, sort: event.target.value })}>
              {SORTS.map((item) => <option key={item.id} value={item.id} disabled={item.id === "similarity" && !scores}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setView({ ...view, order: view.order === "asc" ? "desc" : "asc" })}>
            {view.order === "asc" ? "Ascending" : "Descending"}
          </button>
          <label>Show
            <select value={view.filter} onChange={(event) => setView({ ...view, filter: event.target.value })}>
              {FILTERS.map((item) => <option key={item.id} value={item.id} disabled={item.id === "similar" && !scores}>{item.label}</option>)}
            </select>
          </label>
          <label>Source <input type="search" value={view.search} placeholder="filename"
                               onChange={(event) => setView({ ...view, search: event.target.value })} /></label>
          <label>Similarity {threshold.toFixed(2)}
            <input type="range" min="0" max="1" step="0.01" value={threshold}
                   onChange={(event) => setThreshold(Number(event.target.value))}
                   onMouseUp={() => changeSetting("similar_threshold", threshold)} />
          </label>
          <button type="button" onClick={analyse} disabled={!allFaces.length || busy === "analyse"}>Cluster &amp; find duplicates</button>
        </div>
        <div className="face-row face-actions">
          <span>{visible.length} of {allFaces.length} shown · {selected.size} selected</span>
          <button type="button" onClick={() => setSelected(new Set(visible.map((face) => face.id)))} disabled={!visible.length}>Select shown</button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear</button>
          <button type="button" onClick={() => decide("accepted")} disabled={!selected.size}>Accept</button>
          <button type="button" onClick={() => decide("rejected")} disabled={!selected.size}>Reject</button>
          <button type="button" onClick={() => decide("pending")} disabled={!selected.size}>Undecide</button>
          <button type="button" onClick={removeSelected} disabled={!selected.size}>Remove crops</button>
          <button type="button" onClick={nameCharacter} disabled={!selected.size || Boolean(busy)}>
            Save {selected.size || ""} as character
          </button>
          {desktop?.saveFaceFolder && <button type="button" onClick={saveToFolder} disabled={!allFaces.length || Boolean(busy) || running}>
            {busy === "export" ? "Saving face crops…" : `Save ${selected.size ? `${selected.size} selected` : `all ${allFaces.length}`} faces to folder…`}
          </button>}
          <a className="face-export" href={faces.exportUrl(datasetId)}
             aria-disabled={!allFaces.some((face) => face.state === "accepted")}>Export accepted faces</a>
        </div>

        <div className="face-grid">
          {visible.map((face) => {
            const score = scores?.[face.id];
            return <figure key={face.id} className={`face-card ${selected.has(face.id) ? "selected" : ""} ${face.id === reference ? "reference" : ""} state-${face.state}`}>
              <button type="button" className="face-thumb" onClick={() => toggle(face.id)}
                      aria-pressed={selected.has(face.id)} aria-label={`Face ${face.face_index + 1} from ${face.source_name}`}>
                <ProtectedImage src={faces.cropUrl(dataset.id, face.id, revision)} alt="" loading="lazy" />
              </button>
              <figcaption>
                <span className="face-source" title={face.source_name}>{face.source_name}</span>
                <span className="face-meta">face {face.face_index + 1} · {Math.round(face.metrics.face_width)}×{Math.round(face.metrics.face_height)}px</span>
                <span className="face-meta">conf {face.metrics.confidence.toFixed(2)} · sharp {Math.round(face.metrics.sharpness)}</span>
                {face.cluster !== null && <span className="face-meta">cluster {face.cluster}{face.outlier ? " · outlier" : ""}</span>}
                {typeof score === "number" && <span className="face-score">similarity {score.toFixed(3)}</span>}
                {face.duplicate_of && <span className="face-flag">duplicate</span>}
                {face.flags.map((flag) => <span key={flag} className="face-flag">{flag}</span>)}
                <button type="button" className="face-link" onClick={() => findSimilar(face.id)}>Find similar to this</button>
                {selected.has(face.id) && <MediaCardActions image={{ id: face.id, name: `Face ${face.face_index + 1} from ${face.source_name}`, url: faces.cropUrl(dataset.id, face.id, revision) }} />}
              </figcaption>
            </figure>;
          })}
        </div>
        {!visible.length && <p className="face-note">
          {allFaces.length ? "No faces match the current filter." : "No faces yet — import some images above."}
        </p>}
      </div>
    </>}
    {characterDraft && <CharacterNameDialog title="Save character"
      description={`Save ${characterDraft.faceIds.length} selected face(s) as a character.`}
      onSave={saveAsCharacter} onClose={() => setCharacterDraft(null)} />}
  </section>;
}
