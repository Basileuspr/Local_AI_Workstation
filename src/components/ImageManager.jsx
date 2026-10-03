import ImageThumbnail from "./ImageThumbnail";
import ImageManagerTools from './ImageManagerTools';
import VisualReview from './VisualReview';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useImageDestinations } from '../ImageDestinations';
import { useDispatch } from '../useStore';
import { sortNamedItems } from '../alphabetical';
import * as images from '../imageManagerApi';
import './ImageManager.css';
import {useRangeSelection} from '../useRangeSelection';
import {preventSelectionText} from '../fileSelection';

const emptyFilters = { search: '', folder_id: '', tag: '', format: '', month: '', favorite: false, hide_tagged: false, tagged_only: false, duplicates: false, digest: '', sort: 'date' };
const emptyPage = { images: [], total: 0, offset: 0, months: [], formats: [], tags: [] };
const emptyState = { folders: [], summary: { images: 0, bytes: 0, favorites: 0 }, functions: [], duplicates: [], receipts: [], plans: [] };
const layouts = { month: 'Year / month', day: 'Year / month / day', format: 'Image format', folders: 'Keep relative folders' };

export function ImageManagerFilters({ filters, page, folders, view, onFilter, onReset, pageSize = 48, onPageSize, density = 'comfortable', onDensity }) {
  const extra = [filters.format, filters.month, filters.favorite && 'Favorites', filters.hide_tagged && 'Untagged only', filters.tagged_only && 'Tagged images (including hidden)'].filter(Boolean);
  const tags = page.tags || [];
  return <>
    <div className="im-filters"><input aria-label="Search images or tags" placeholder="Search filenames or tags…" value={filters.search} onChange={event => onFilter('search', event.target.value)} maxLength={200}/>
      <select aria-label="Filter image folder" value={filters.folder_id} onChange={event => onFilter('folder_id', event.target.value)}><option value="">All catalog folders</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select>
      <select aria-label="Filter image tag" value={filters.tag} onChange={event => onFilter('tag', event.target.value)}><option value="">All tags</option>{filters.tag && !tags.includes(filters.tag) && <option value={filters.tag}>{filters.tag} (no matches)</option>}{tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select>
      <select aria-label="Sort images" value={filters.sort} onChange={event => onFilter('sort', event.target.value)}>{Object.entries({ date: 'Newest first', name: 'Filename', size: 'Largest files', dimensions: 'Largest dimensions' }).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <label className="im-page-size">Images per page<select aria-label="Images per page" value={pageSize} onChange={event => onPageSize?.(event.target.value)}>{images.IMAGE_PAGE_SIZES.map(size => <option value={size} key={size}>{size.toLocaleString()}</option>)}</select></label>
      <label className="im-view-density">View density<select aria-label="Image Manager view density" value={density} onChange={event => onDensity?.(event.target.value)}><option value="comfortable">Comfortable</option><option value="extra-comfortable">Extra comfortable</option><option value="compact">Compact</option></select></label>
      <button onClick={onReset}>Reset filters</button>
    </div>
    <details className="im-extra-filters"><summary>More filters{extra.length > 0 && ` · ${extra.join(' · ')}`}</summary><div className="im-controls">
      <label>Format<select aria-label="Filter image format" value={filters.format} onChange={event => onFilter('format', event.target.value)}><option value="">All formats</option>{page.formats.map(format => <option key={format}>{format}</option>)}</select></label>
      <label>Date<select aria-label="Filter image month" value={filters.month} onChange={event => onFilter('month', event.target.value)}><option value="">All dates</option>{page.months.map(month => <option key={month}>{month}</option>)}</select></label>
      <label className="im-check"><input type="checkbox" checked={filters.favorite} onChange={event => onFilter('favorite', event.target.checked)}/>Favorites</label>
      {view !== 'hidden' && <label className="im-check"><input type="checkbox" checked={filters.hide_tagged} onChange={event => onFilter('hide_tagged', event.target.checked)}/>Untagged only</label>}
    </div></details>
  </>;
}

function Dialog({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => { ref.current.showModal(); }, []);
  return createPortal(<dialog ref={ref} className="im-dialog" onCancel={onClose} aria-label={title}>
    <header><h2>{title}</h2><button onClick={onClose} aria-label="Close dialog">✕</button></header>{children}
  </dialog>, document.body);
}

function RecipeEditor({ value, folders, sourceIds, outputId, recursive, onSave, onClose }) {
  const [recipe, setRecipe] = useState(value || { name: '', folder_ids: sourceIds, output_id: outputId, recursive, layout: 'month', mode: 'copy', duplicate_members: 'extra', steps: ['scan', 'duplicates', 'report'] });
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const change = (key, value) => setRecipe(current => ({ ...current, [key]: value }));
  function move(index, delta) { const steps = [...recipe.steps]; [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]]; change('steps', steps); }
  const outputNeeded = recipe.steps.some(step => ['plan', 'report'].includes(step));
  return <Dialog title={value ? 'Edit image function' : 'Create image function'} onClose={onClose}>
    <form onSubmit={async event => { event.preventDefault(); setSaving(true); setError(''); try { await onSave(recipe); onClose(); } catch (error) { setError(error.message); } finally { setSaving(false); } }}>
      <label>Function name<input autoFocus required maxLength={80} value={recipe.name} onChange={event => change('name', event.target.value)} /></label>
      <fieldset><legend>Source folders</legend>{folders.filter(folder => folder.purpose === 'source').map(folder => <label className="im-check" key={folder.id}><input type="checkbox" checked={recipe.folder_ids.includes(folder.id)} onChange={event => change('folder_ids', event.target.checked ? [...recipe.folder_ids, folder.id] : recipe.folder_ids.filter(id => id !== folder.id))} />{folder.path}</label>)}</fieldset>
      <label className="im-check"><input type="checkbox" checked={recipe.recursive} onChange={event => change('recursive', event.target.checked)} />Include subfolders when scanning</label>
      <ol className="im-steps">{recipe.steps.map((step, index) => <li key={index}>
        {index > 0 && <span className="im-then">THEN</span>}
        <div><select aria-label={`Step ${index + 1}`} value={step} onChange={event => change('steps', recipe.steps.map((item, i) => i === index ? event.target.value : item))}>{Object.entries(images.imageSteps).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <button type="button" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
          <button type="button" aria-label={`Move step ${index + 1} down`} disabled={index === recipe.steps.length - 1} onClick={() => move(index, 1)}>↓</button>
          <button type="button" disabled={recipe.steps.length === 1} onClick={() => change('steps', recipe.steps.filter((_, i) => i !== index))}>Remove</button></div>
      </li>)}</ol>
      <button type="button" disabled={recipe.steps.length >= 12} onClick={() => change('steps', [...recipe.steps, 'report'])}>+ Add step</button>
      {outputNeeded && <label>Output folder<select required value={recipe.output_id} onChange={event => change('output_id', event.target.value)}><option value="">Choose a registered output folder</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>}
      {recipe.steps.some(step => ['plan', 'duplicate-plan'].includes(step)) && <div className="im-controls">{recipe.steps.includes('plan') && <label>Organization<select value={recipe.layout} onChange={event => change('layout', event.target.value)}>{Object.entries(layouts).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}<label>Plan action<select value={recipe.mode} onChange={event => change('mode', event.target.value)}><option value="copy">Copy</option><option value="move">Move</option></select></label></div>}
      {recipe.steps.includes('duplicate-plan') && <><label>Duplicate group members<select value={recipe.duplicate_members || 'extra'} onChange={event => change('duplicate_members', event.target.value)}><option value="extra">Extra copies — keep one per group in source</option><option value="all">Every matching image</option></select></label></>}

      {error && <p role="alert" className="im-error">{error}</p>}
      <footer><button type="button" onClick={onClose}>Cancel</button><button disabled={saving || !recipe.folder_ids.length}>Save image function</button></footer>
    </form>
  </Dialog>;
}

export default function ImageManager({ active = true }) {
  const dispatch = useDispatch(), destinations = useImageDestinations();
  const [state, setState] = useState(emptyState), [page, setPage] = useState(emptyPage), [view, setView] = useState('library');
  const [filters, setFilters] = useState(emptyFilters), [offset, setOffset] = useState(0), [selected, setSelected] = useState([]);
  const [pageSize, setPageSize] = useState(images.loadImagePageSize);
  const [density, setDensity] = useState(images.loadImageDensity);
  const [sourceIds, setSourceIds] = useState([]), [outputId, setOutputId] = useState(''), [recursive, setRecursive] = useState(true);
  const [layout, setLayout] = useState('month'), [mode, setMode] = useState('copy'), [plan, setPlan] = useState(null);
  const [preview, setPreview] = useState(null), [recipe, setRecipe] = useState(null), [tags, setTags] = useState('');
  const [savedTag, setSavedTag] = useState('');
  const existingTag = page.tags.includes(savedTag) ? savedTag : '';
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [forget, setForget] = useState(null), [deleteRecipe, setDeleteRecipe] = useState(null);
  const [duplicateFolder, setDuplicateFolder] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [fileReview, setFileReview] = useState(null);
  const [trash, setTrash] = useState([]), [trashSelected, setTrashSelected] = useState([]);
  const [trashLimit, setTrashLimit] = useState(48);
  const imageRange = useRangeSelection(page.images.map(image => image.id), selected, setSelected, {array:true, limit:1000, scope:JSON.stringify([view,filters,offset,pageSize])});
  const trashRange = useRangeSelection(trash.slice(0,trashLimit).map(entry => entry.id), trashSelected, setTrashSelected, {array:true, limit:1000, scope:view});
  const running = state.job?.status === 'running', lastResult = useRef('');
  async function refresh() { const value = await images.request(); setState(value); return value; }
  async function perform(action) { setBusy(true); setError(''); setNotice(''); try { await action(); } catch (error) { setError(error.message); } finally { setBusy(false); } }
  useEffect(() => {
    if (!active) return;
    let alive = true, timeout, controller;
    async function poll() {
      controller = new AbortController();
      try {
        const value = await images.request('/state', 'GET', undefined, controller.signal);
        if (!alive) return;
        setState(value);
        const job = value.job;
        const key = `${job?.id}:${job?.status}`;
        if (job && job.status !== 'running' && key !== lastResult.current) { lastResult.current = key; setRevision(v => v + 1); }
        timeout = setTimeout(poll, job?.status === 'running' ? 800 : 4000);
      } catch (error) { if (alive) { setError(error.message); timeout = setTimeout(poll, 5000); } }
    }
    poll(); return () => { alive = false; clearTimeout(timeout); controller?.abort(); };
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => images.request(`/images?${new URLSearchParams({ ...filters, visibility: images.imageVisibility(filters, view), offset, limit: pageSize })}`, 'GET', undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (offset > 0 && offset >= value.total) setOffset(Math.floor(Math.max(0, value.total - 1) / pageSize) * pageSize);
      else setPage(value);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }), 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, filters, view, offset, pageSize, revision]);
  useEffect(() => {
    if (!active || view !== 'trash') return;
    const controller = new AbortController();
    images.request('/trash', 'GET', undefined, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setTrash(value.entries); setTrashSelected(current => current.filter(id => value.entries.some(entry => entry.id === id)));
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [active, view, revision]);
  const resultPlan = state.job?.result?.plan_id;
  useEffect(() => {
    if (!active || !resultPlan) return;
    let alive = true;
    images.request(`/plans/${resultPlan}`).then(value => { if (alive) { setPlan(value); } }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, [active, resultPlan]);
  useEffect(() => {
    if (state.job?.kind !== 'apply' || state.job.status === 'running' || !plan) return;
    let alive = true;
    images.request(`/plans/${plan.id}`).then(value => { if (alive) setPlan(value); }).catch(error => { if (alive) setError(error.message); });
    return () => { alive = false; };
  }, [state.job?.id, state.job?.status]);
  function filter(key, value) { setFilters(current => images.updateImageFilters(current, key, value)); setOffset(0); if (['hide_tagged', 'tag', 'tagged_only'].includes(key)) setSelected([]); }
  function changePageSize(value) {
    const size = images.imagePageSize(value);
    setPageSize(size); setOffset(0); images.saveImagePageSize(size);
  }
  function changeDensity(value) {
    const next = images.imageDensity(value);
    setDensity(next); images.saveImageDensity(next);
  }
  function chooseView(next) {
    if (next !== view && ['library', 'duplicates', 'hidden'].includes(next)) { setSelected([]); setOffset(0); }
    if (next !== view && (next === 'hidden' || view === 'hidden')) {
      setSelected([]); setOffset(0); setPage(emptyPage);
      setFilters(current => ({ ...emptyFilters, folder_id: current.folder_id, sort: current.sort }));
    }
    setView(next);
  }
  async function choose(purpose) {
    if (!window.workstationDesktop?.chooseImageManagerFolder) throw new Error('Folder selection requires the desktop app.');
    const result = await window.workstationDesktop.chooseImageManagerFolder(purpose);
    if (result.error) throw new Error(result.error);
    if (result.canceled || !result.path) return;
    const folder = await images.request('/folders', 'POST', { path: result.path, purpose });
    if (purpose === 'source') setSourceIds(current => current.includes(folder.id) ? current : [...current, folder.id]);
    else setOutputId(folder.id);
    await refresh();
    return folder;
  }
  async function start(kind, payload) { const result = await images.task(kind, payload); await refresh(); return result; }
  const scope = { folder_ids: sourceIds, recursive, output_id: outputId, layout, mode };
  async function annotate(body) { await images.request('/metadata', 'PATCH', { ids: selected, ...body }); if (body.hidden !== undefined || ((body.tags || body.add_tags) && (filters.hide_tagged || filters.tagged_only))) { setSelected([]); setOffset(0); } setRevision(v => v + 1); await refresh(); }
  async function addExistingTag() {
    const count = selected.length;
    await annotate({ add_tags: [existingTag] });
    setNotice(`Added “${existingTag}” to ${count} selected image${count === 1 ? '' : 's'}.`);
  }
  async function hideTagged() {
    const result = await images.request('/visibility/hide-tagged', 'POST', { folder_id: filters.folder_id });
    setSelected([]); setOffset(0); setRevision(v => v + 1); await refresh();
    setNotice(`${result.updated} tagged image${result.updated === 1 ? '' : 's'} hidden. Restore them from Hidden.`);
  }
  async function unhideImages() {
    const result = await images.request('/visibility/unhide', 'POST', { folder_id: filters.folder_id });
    setSelected([]); setOffset(0); setRevision(v => v + 1); await refresh();
    setNotice(`${result.updated} image${result.updated === 1 ? '' : 's'} unhidden.`);
  }
  function toggleImage(id, event) { imageRange.toggle(id,event); }
  async function reviewFiles(action, ids) {
    const review = await images.request('/trash/review', 'POST', { action, ids });
    setPreview(null); setFileReview(review);
  }
  async function stage(image) {
    const file = await destinations.readImage(images.originalImage(image));
    dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'chats' });
    // Wait for the chat input to become the receiver; attachments remain pending until Send.
    await new Promise(resolve => setTimeout(resolve, 100));
    const event = new CustomEvent('stage-function-result', { detail: [file], cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('The chat input could not accept this image. Open the chat and try again.');
    setPreview(null);
  }
  const disabled = running || busy;
  return <section className="image-manager" data-density={density} aria-label="Image Manager">
    <header className="im-heading"><div><h2>Image Manager</h2></div><button onClick={() => setToolsOpen(true)}>Image tools</button></header>
    <VisualReview source="image-manager" active={active} ids={selected.length ? selected : page.images.map(image=>image.id)} onChanged={()=>setRevision(value=>value+1)} />

    <div className="im-stats"><span>{state.summary.images.toLocaleString()} images</span><span>{images.bytesLabel(state.summary.bytes)}</span><span>{state.summary.favorites} favorites</span><span>{state.duplicates.length} exact duplicate groups</span></div>
    <details className="im-folders" open={state.folders.length === 0}><summary>Folders & scan settings ({state.folders.length})</summary>
      <div className="im-controls"><button disabled={disabled} onClick={() => perform(() => choose('source'))}>+ Add source folder</button><button disabled={disabled} onClick={() => perform(() => choose('output'))}>Choose output folder</button><label className="im-check"><input type="checkbox" checked={recursive} onChange={event => setRecursive(event.target.checked)} />Include subfolders</label><button disabled={disabled || !sourceIds.length} onClick={() => perform(() => start('scan', scope))}>Scan folders</button></div>
      <div className="im-folder-list">{state.folders.filter(folder => folder.purpose === 'source').map(folder => <div key={folder.id}><label className="im-check"><input type="checkbox" checked={sourceIds.includes(folder.id)} onChange={event => setSourceIds(current => event.target.checked ? [...current, folder.id] : current.filter(id => id !== folder.id))} /><span title={folder.path}>{folder.path}</span><small>{folder.count} images</small></label><button disabled={disabled} onClick={() => setForget(folder)}>Forget</button></div>)}</div>
      <label>Output folder<select value={outputId} onChange={event => setOutputId(event.target.value)}><option value="">Choose an output folder</option>{state.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label>

    </details>
    {state.job && <div className={`im-job ${state.job.status}`} role="status"><div><strong>{state.job.status === 'running' ? images.imageSteps[state.job.phase] || state.job.phase : `Task ${state.job.status}`}</strong>{running && <button onClick={() => perform(() => images.request(`/tasks/${state.job.id}/stop`, 'POST', {}))}>Stop task</button>}</div><p>{state.job.message}</p>{state.job.total > 0 && <progress value={state.job.current} max={state.job.total} />}
      {state.job.steps.length > 1 && <p>{state.job.steps.map((step, index) => `${index + 1}. ${images.imageSteps[step.type] || step.type} (${step.status})`).join(' → ')}</p>}
      {state.job.result.scan && <p>{state.job.result.scan.images} images scanned · {state.job.result.scan.skipped} skipped{state.job.result.scan.partial ? ' · Scan limit reached; catalog may be incomplete.' : ''}</p>}
      {state.job.result.scan?.warnings?.length > 0 && <details><summary>Scan notes ({state.job.result.scan.warnings.length})</summary>{state.job.result.scan.warnings.map((note, index) => <p key={index}>{note}</p>)}</details>}
      {resultPlan && <button onClick={() => setView('organize')}>Review organization plan</button>}
      {state.job.result.report && <p className="im-path">Report saved: {state.job.result.report}</p>}
    </div>}
    {error && <p role="alert" className="im-error">{error}<button onClick={() => setError('')} aria-label="Dismiss error">✕</button></p>}
    {notice && <p role="status" className="im-note">{notice}</p>}
    <div className="im-sticky-controls">
    <nav className="im-tabs" aria-label="Image Manager views">{['library', 'duplicates', 'hidden', 'organize', 'functions', 'history', 'trash'].map(id => <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => chooseView(id)}>{id[0].toUpperCase() + id.slice(1)}{['trash', 'hidden'].includes(id) ? ` (${state.summary[id] || 0})` : ''}</button>)}</nav>
      {['library', 'duplicates', 'hidden'].includes(view) && <>
      <ImageManagerFilters filters={filters} page={page} folders={state.folders} view={view} onFilter={filter} onReset={() => { if (filters.tagged_only) setSelected([]); setFilters(emptyFilters); setOffset(0); }} pageSize={pageSize} onPageSize={changePageSize} density={density} onDensity={changeDensity}/>
      <div className="im-selection"><span title="Ctrl-click toggles files. Shift-click selects a range on the shown page. Ctrl+Shift adds a range.">{selected.length} selected · <span role="status">Showing {page.images.length} of {page.total} matches</span></span><button disabled={!page.images.length} onClick={() => setSelected(current => [...new Set([...current, ...page.images.map(image => image.id)])].slice(0, 1000))}>Select page</button>
        {view !== 'hidden' && <button disabled={disabled} title={`Hide every tagged image in ${filters.folder_id ? 'the chosen folder' : 'all catalog folders'}, across all pages and filters. Originals stay in place.`} onClick={() => perform(hideTagged)}>Hide tagged images</button>}
        {view !== 'hidden' && <button aria-pressed={filters.tagged_only} title="Show images with tags, including hidden images, within the current filters" onClick={() => filter('tagged_only', !filters.tagged_only)}>Show tagged images</button>}
        <button disabled={disabled || !state.summary.hidden} title={`Unhide every hidden image in ${filters.folder_id ? 'the chosen folder' : 'all catalog folders'}, across all pages and filters`} onClick={() => perform(unhideImages)}>Unhide images</button>
        {(view === 'hidden' || filters.tagged_only) && <button disabled={disabled || !selected.length} onClick={() => perform(() => annotate({ hidden: false }))}>Unhide selected</button>}
        {selected.length > 0 && <><button onClick={() => setSelected([])}>Clear selection</button>
          <label className="im-existing-tag">Existing tag<select aria-label="Existing tag for selected images" value={existingTag} disabled={disabled || !page.tags.length} onChange={event => setSavedTag(event.target.value)}>
            <option value="">{page.tags.length ? 'Choose a saved tag' : 'No saved tags yet'}</option>{page.tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select></label><button disabled={disabled || !existingTag} title="Add this tag to selected images, keeping their other tags" onClick={() => perform(addExistingTag)}>Add tag</button>
          <input aria-label="Selected image tags" value={tags} onChange={event => setTags(event.target.value)} placeholder="Tags, separated by commas" title="Replace tags on selected images; leave blank to clear them"/><button disabled={disabled} onClick={() => perform(() => annotate({ tags: tags.split(',').map(tag => tag.trim()).filter(Boolean) }))}>Set tags</button></>}
        <details className="im-more-actions"><summary>More actions</summary>
          <div className="im-controls"><button disabled={!selected.length} onClick={() => setView('organize')}>Organize selected</button><button disabled={disabled || !selected.length} onClick={() => perform(() => annotate({ favorite: true }))}>Favorite</button><button disabled={disabled || !selected.length} onClick={() => perform(() => annotate({ favorite: false }))}>Unfavorite</button>
            {view !== 'hidden' && <button disabled={disabled || !selected.length} onClick={() => perform(() => annotate({ hidden: true }))}>Hide selected</button>}
            <button className="im-delete" disabled={disabled || !selected.length} onClick={() => perform(() => reviewFiles('delete', selected))}>Delete selected ({selected.length})</button>
          </div>


        </details>
      </div>
      </>}
    </div>
    {['library', 'duplicates', 'hidden'].includes(view) && <>
      {view === 'duplicates' && <div className="im-duplicates"><div className="im-controls"><button disabled={disabled || !sourceIds.length} onClick={() => perform(() => start('duplicates', scope))}>Find exact duplicates</button><button onClick={() => { setFilters({ ...emptyFilters, duplicates: true }); setOffset(0); }}>Show all checked duplicates</button><button disabled={disabled || !state.duplicates.length || !state.folders.some(folder => folder.purpose === 'source')} onClick={() => setDuplicateFolder({ sourceId: state.folders.find(folder => folder.id === filters.folder_id && folder.purpose === 'source')?.id || sourceIds[0] || state.folders.find(folder => folder.purpose === 'source')?.id || '', mode: 'move', members: 'extra' })}>Send duplicates to folder</button></div>{state.duplicates.map(group => <button className={filters.digest === group.sha256 ? 'selected' : ''} key={group.sha256} onClick={() => { setFilters({ ...emptyFilters, digest: group.sha256 }); setOffset(0); }}>{group.count} files · {images.bytesLabel(group.bytes)} each · {group.sha256.slice(0, 12)}…</button>)}</div>}
      <div className="im-grid">{page.images.map(image => <article key={image.id} className={selected.includes(image.id) ? 'selected' : ''}>
        <div className="im-card-controls">
        <label className="im-select"><input type="checkbox" aria-label={`Select ${image.relative}`} checked={selected.includes(image.id)} onMouseDown={preventSelectionText} onClick={event => toggleImage(image.id,event)} onChange={() => {}} /></label>
        <button className="im-delete im-delete-item" aria-label={`Delete ${image.relative}`} disabled={disabled} onClick={() => perform(() => reviewFiles('delete', [image.id]))}>Delete</button>
        </div>
        <button className="im-image" onMouseDown={preventSelectionText} onClick={event => toggleImage(image.id,event)} aria-label={`Select image ${image.relative}`} aria-pressed={selected.includes(image.id)}><ImageThumbnail src={images.imageUrl(image, density === 'extra-comfortable')} alt={image.relative} /></button>
        <button className="im-name" title={`${image.folder_path} / ${image.relative}`} onMouseDown={preventSelectionText} onClick={event => toggleImage(image.id,event)} aria-pressed={selected.includes(image.id)}>{image.favorite ? '★ ' : ''}{image.relative}</button>{Boolean(image.hidden) && <small>Hidden</small>}<small>{image.width} × {image.height} · {image.format} · {images.bytesLabel(image.bytes)}</small><small>{image.date.slice(0, 10)} · {image.date_source}</small>{image.tags.length > 0 && <small className="im-tags">{image.tags.join(' · ')}</small>}<button className="im-preview-button" onClick={() => setPreview(image)} aria-label={`Preview ${image.relative}`}>Preview</button>
      </article>)}</div>
      {!page.total && <p className="im-empty">{state.summary.images ? 'No images match these filters.' : 'Add a source folder and scan it to browse your still images here.'}</p>}
      {page.total > pageSize && <div className="im-pagination"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button><span>{(page.offset || 0) + 1}–{(page.offset || 0) + page.images.length} of {page.total}</span><button disabled={offset + pageSize >= page.total} onClick={() => setOffset(offset + pageSize)}>Next</button></div>}
    </>}
    {view === 'organize' && <div className="im-organize"><h3>Prepare an organization plan</h3><p>{selected.length} selected images. Choose an output folder outside their source folder trees.</p><div className="im-controls"><label>Layout<select value={layout} onChange={event => setLayout(event.target.value)}>{Object.entries(layouts).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Action<select value={mode} onChange={event => setMode(event.target.value)}><option value="copy">Copy</option><option value="move">Move</option></select></label><button disabled={disabled || !selected.length || !outputId} onClick={() => perform(async () => { setPlan(null);  await start('plan', { ...scope, ids: selected }); })}>Prepare plan</button></div>

      {state.plans?.length > 0 && <label>Recent saved plans<select aria-label="Recent organization plans" value={plan?.id || ''} onChange={event => perform(async () => { setPlan(event.target.value ? await images.request(`/plans/${event.target.value}`) : null); })}><option value="">Choose a plan to review</option>{state.plans.map(item => <option key={item.id} value={item.id}>{item.mode} {item.count} · {item.status} · {item.created}</option>)}</select></label>}
      {plan && <><h3>{plan.mode === 'move' ? 'Move' : 'Copy'} plan · {plan.entries.length} images</h3><p className="im-path">Output: {plan.destination}</p><div className="im-table-wrap"><table><thead><tr><th>Source</th><th>Destination</th><th>SHA-256</th></tr></thead><tbody>{plan.entries.map(entry => <tr key={entry.id}><td>{entry.source}<small>{entry.date_source}</small></td><td>{entry.target}</td><td title={entry.sha256}>{entry.sha256.slice(0, 12)}…</td></tr>)}</tbody></table></div>
        {plan.kind === 'duplicates' && <><details className="im-kept"><summary>{plan.duplicate_members === 'all' ? 'Every matching image is included across duplicate batches' : `${plan.kept.length} original${plan.kept.length === 1 ? ' remains' : 's remain'} in the source folder`}</summary>{plan.kept.map(path => <p className="im-path" key={path}>{path}</p>)}</details>{plan.duplicate_remaining > 0 && <p className="im-note">This plan covers {plan.entries.length} of {plan.duplicate_total} matching images in this source. {plan.duplicate_remaining} remain for later batches.</p>}{plan.status === 'used' && plan.duplicate_remaining > 0 && state.receipts.some(receipt => receipt.plan_id === plan.id && receipt.status === 'complete') && <button disabled={disabled} onClick={() => perform(async () => { await start('duplicate-plan', { folder_ids: [plan.source_folder_id], mode: plan.mode, duplicate_members: plan.duplicate_members, duplicate_offset: plan.mode === 'copy' ? (plan.duplicate_offset || 0) + plan.entries.length : 0 }); })}>Prepare next duplicate batch</button>}</>}
        {plan.status === 'ready' ? <div className="im-confirm"><p>{plan.mode === 'move' ? 'Move removes the listed original files after verified copies succeed.' : 'Copy keeps every original file.'} Review the complete plan, then apply it below.</p><button disabled={disabled} onClick={() => perform(() => start('apply', { plan_id: plan.id, confirmation: images.confirmationFor(plan) }))}>Apply reviewed plan</button><button disabled={running} onClick={() => { setPlan(null); }}>Dismiss plan</button></div> : <p>This plan has been used. See History for its transfer receipt.</p>}
      </>}
    </div>}
    {view === 'functions' && <div className="im-functions"><div className="im-controls"><button disabled={disabled} onClick={() => setRecipe({ create: true })}>Create image function</button><button disabled={disabled || !sourceIds.length || !outputId} onClick={() => perform(() => start('report', scope))}>Save catalog report</button></div>{sortNamedItems(state.functions).map(item => <article key={item.id}><h3>{item.name}</h3><p>{item.steps.map(step => images.imageSteps[step]).join(' → ')}</p><div className="im-controls"><button disabled={disabled} onClick={() => perform(() => start('function', { function_id: item.id }))}>Run function</button><button disabled={disabled} onClick={() => setRecipe(item)}>Edit</button><button disabled={disabled} onClick={() => setDeleteRecipe(item)}>Delete function</button></div></article>)}</div>}
    {view === 'history' && <div className="im-history">{state.receipts.map(receipt => <details key={receipt.id}><summary>{receipt.mode} · {receipt.status} · {receipt.entries.length} images · {receipt.started}</summary>{receipt.entries.map((entry, index) => <p className="im-path" key={index}>{entry.status}: {entry.source} → {entry.target}<small>SHA-256 {entry.sha256}</small>{entry.error && <small className="im-error">{entry.error}</small>}</p>)}</details>)}{!state.receipts.length && <p>No copies or moves have been performed.</p>}</div>}
    {preview && <Dialog title={preview.relative} onClose={() => setPreview(null)}><img className="im-preview" src={images.imageUrl(preview, true)} alt={preview.relative} /><p>{preview.width} × {preview.height} · {preview.format} · {images.bytesLabel(preview.bytes)} · {preview.date_source}: {preview.date.slice(0, 10)}</p><p className="im-path">{preview.folder_path} / {preview.relative}</p><div className="im-controls"><button disabled={busy} onClick={() => perform(async () => { const result = await window.workstationDesktop?.revealManagedImage(preview.id); if (!result || result.error) throw new Error(result?.error || 'Show in folder requires the desktop app.'); })}>Show in folder</button><button disabled={busy} onClick={() => perform(async () => { await destinations.take(images.originalImage(preview), 'editor'); setPreview(null); })}>Edit image</button><button disabled={busy} onClick={() => perform(() => stage(preview))}>Add to chat draft</button><button disabled={busy} onClick={() => perform(async () => { await destinations.take(images.originalImage(preview), 'folder'); setPreview(null); })}>Save copy to Gallery</button></div>{error && <p role="alert" className="im-error">{error}</p>}</Dialog>}
    {duplicateFolder && <Dialog title="Send duplicates to folder" onClose={() => setDuplicateFolder(null)}><label>Source folder<select value={duplicateFolder.sourceId} onChange={event => setDuplicateFolder(current => ({ ...current, sourceId: event.target.value }))}>{state.folders.filter(folder => folder.purpose === 'source').map(folder => <option key={folder.id} value={folder.id}>{folder.path}</option>)}</select></label><label>Images to send<select value={duplicateFolder.members} onChange={event => setDuplicateFolder(current => ({ ...current, members: event.target.value }))}><option value="extra">Extra copies — keep one per group in source</option><option value="all">Every matching image</option></select></label><label>Action<select value={duplicateFolder.mode} onChange={event => setDuplicateFolder(current => ({ ...current, mode: event.target.value }))}><option value="move">Move</option><option value="copy">Copy</option></select></label><p className="im-path">Destination: {state.folders.find(folder => folder.id === duplicateFolder.sourceId)?.path} / Duplicates</p>{error && <p role="alert" className="im-error">{error}</p>}<footer><button onClick={() => setDuplicateFolder(null)}>Cancel</button><button disabled={disabled || !duplicateFolder.sourceId} onClick={() => perform(async () => { setPlan(null);  await start('duplicate-plan', { folder_ids: [duplicateFolder.sourceId], mode: duplicateFolder.mode, duplicate_members: duplicateFolder.members }); setDuplicateFolder(null); setView('organize'); })}>Prepare duplicate-folder plan</button></footer></Dialog>}
    {recipe && <RecipeEditor value={recipe.create ? null : recipe} folders={state.folders} sourceIds={sourceIds} outputId={outputId} recursive={recursive} onClose={() => setRecipe(null)} onSave={async value => { await images.request('/functions', 'POST', value); await refresh(); }} />}
    {forget && <Dialog title="Forget catalog folder" onClose={() => setForget(null)}><p>Remove {forget.path} and its image metadata from this catalog? Original files stay in place. Functions using this folder will need another source.</p><footer><button onClick={() => setForget(null)}>Cancel</button><button disabled={busy} onClick={() => perform(async () => { await images.request(`/folders/${forget.id}`, 'DELETE'); setSourceIds(ids => ids.filter(id => id !== forget.id)); if (outputId === forget.id) setOutputId(''); setSelected([]); setFilters(emptyFilters); setOffset(0); setForget(null); setRevision(v => v + 1); await refresh(); })}>Forget folder</button></footer></Dialog>}
    {deleteRecipe && <Dialog title="Delete image function" onClose={() => setDeleteRecipe(null)}><p>Delete “{deleteRecipe.name}”?</p><footer><button onClick={() => setDeleteRecipe(null)}>Cancel</button><button disabled={busy} onClick={() => perform(async () => { await images.request(`/functions/${deleteRecipe.id}`, 'DELETE'); setDeleteRecipe(null); await refresh(); })}>Delete function</button></footer></Dialog>}
    {view === 'trash' && <section className="im-trash" aria-label="Deleted images">
      <h3>Recoverable Trash · {trash.length} files</h3>
      <div className="im-controls"><button disabled={disabled || !trash.length} onClick={() => setTrashSelected(trash.slice(0, Math.min(trashLimit, 1000)).map(entry => entry.id))}>Select shown files</button><button disabled={disabled || !trashSelected.length} onClick={() => perform(() => reviewFiles('restore', trashSelected))}>Restore selected ({trashSelected.length})</button><button className="im-delete" disabled={disabled || !trashSelected.length} onClick={() => perform(() => reviewFiles('purge', trashSelected))}>Delete selected permanently</button><button disabled={!trashSelected.length} onClick={() => setTrashSelected([])}>Clear selection</button></div>
      <div className="im-table-wrap"><table><thead><tr><th>Select</th><th>File / original location</th><th>Size</th><th>Action</th></tr></thead><tbody>{trash.slice(0, trashLimit).map(entry => <tr key={entry.id}>
        <td><input type="checkbox" aria-label={`Select deleted ${entry.image.relative}`} checked={trashSelected.includes(entry.id)} onMouseDown={preventSelectionText} onClick={event => trashRange.toggle(entry.id,event)} onChange={() => {}} /></td>
        <td>{entry.image.relative}<small>{entry.original_path}</small>{entry.phase === 'copy-kept' && <small>Original retained after an incomplete move. Restore will check for collisions.</small>}</td>
        <td>{images.bytesLabel(entry.image.bytes)}</td><td><button disabled={disabled} onClick={() => perform(() => reviewFiles('restore', [entry.id]))}>Restore</button><button className="im-delete" disabled={disabled} onClick={() => perform(() => reviewFiles('purge', [entry.id]))}>Delete permanently</button></td>
      </tr>)}</tbody></table></div>
      {!trash.length && <p className="im-empty">Trash is empty.</p>}{trash.length > trashLimit && <button onClick={() => setTrashLimit(value => value + 48)}>Show more deleted files</button>}
    </section>}
    {fileReview && <Dialog title={fileReview.action === 'delete' ? 'Delete images to recoverable Trash' : fileReview.action === 'purge' ? 'Permanently delete images from Trash' : 'Restore deleted images'} onClose={() => { if (!busy) setFileReview(null); }}>
      <p>{fileReview.entries.length} files · {images.bytesLabel(fileReview.bytes)}. {fileReview.action === 'delete' ? 'Only these copies will move into Image Manager’s Trash. Other copies remain in place. You can restore them from the Trash tab.' : fileReview.action === 'purge' ? 'These Trash files will be permanently removed. This cannot be undone. Copies outside Trash stay in place.' : 'Files return to their original folders. Existing files will not be overwritten.'}</p>
      <div className="im-table-wrap"><table><thead><tr><th>File</th><th>Current location</th><th>Destination</th></tr></thead><tbody>{fileReview.entries.map(entry => <tr key={entry.id}><td>{entry.name}</td><td>{entry.source}</td><td>{fileReview.action === 'purge' ? 'Permanent deletion' : entry.target}</td></tr>)}</tbody></table></div>
      {error && <p className="im-error" role="alert">{error}</p>}
      <footer><button disabled={busy} autoFocus onClick={() => setFileReview(null)}>Cancel</button><button className={fileReview.action !== 'restore' ? 'im-delete' : ''} disabled={disabled} onClick={() => perform(async () => {
        await start('trash', { review_id: fileReview.id, confirmation: fileReview.confirmation }); setFileReview(null); setSelected([]); setTrashSelected([]);
      })}>{fileReview.action === 'delete' ? 'Delete reviewed files' : fileReview.action === 'purge' ? 'Permanently delete reviewed files' : 'Restore reviewed files'}</button></footer>
    </Dialog>}
    {toolsOpen && <ImageManagerTools Dialog={Dialog} folders={state.folders} selected={selected} folderId={filters.folder_id} outputId={outputId} job={state.job} disabled={disabled} chooseOutput={() => choose('output')} start={payload => start('image-tools', payload)} onClose={() => setToolsOpen(false)}/>}
  </section>;
}
