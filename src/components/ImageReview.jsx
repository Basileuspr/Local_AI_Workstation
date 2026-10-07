import {preventSelectionText} from '../fileSelection';
import ImageThumbnail from "./ImageThumbnail";
import VisualReview from './VisualReview';
import ReviewWorkflow from './ReviewWorkflow';
import {useImageDestinations} from '../ImageDestinations';
import {useDispatch} from '../useStore';
import * as workflowApi from '../imageWorkflowApi';
import {downloadBlob} from '../downloadBlob';
import FreshFileInput from "./FreshFileInput";
import { useEffect, useRef, useState } from "react";
import useImageLibrary from "../useImageLibrary";
import * as api from "../imageLibraryApi";
import { reviewImages, canReadReviewImage, reviewFileMessage, completeReview } from "../imageReview";
import ProtectedImage from "../ImagePrivacy";
import ImageItemActions from "./ImageItemActions";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";
import CollectionPager from "./CollectionPager";
import ImageTagButtons from "./ImageTagButtons";
import ImageReviewMetadata from "./ImageReviewMetadata";
import FileImagesDialog from "./ImageFolderTools";
import "./ImageReview.css";

export default function ImageReview({ active }) {
  const library = useImageLibrary(active);
  const destinations=useImageDestinations(),dispatch=useDispatch();
  const [folder, setFolder] = useState("pending");
  const [view, setView] = useState("images"), [favoritesOnly, setFavoritesOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slides, setSlides] = useState([]);
  const [position, setPosition] = useState(0);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState([]);
  const [page, setPage] = useState(0);
  const [compact, setCompact] = useState(true);
  const [filing, setFiling] = useState(null);
  const upload = useRef(null), dialog = useRef(null), action = useRef(false), editor = useRef(null);
  const filtered = reviewImages(library.images, folder, filters, query, favoritesOnly);
  // Filtered-out images cannot remain selected for Start slideshow.
  const batch = useBatchAction();
  const current = slides[position];
  const size = compact ? 12 : 6, pages = Math.max(1, Math.ceil(filtered.length / size)), currentPage = Math.min(page, pages - 1);
  const selection = useSelection(filtered, image => image.id, folder, filtered.slice(currentPage * size, (currentPage + 1) * size));
  useEffect(() => {
    if (current && active) dialog.current?.showModal(); else dialog.current?.close();
  }, [!!current, active]);
  useEffect(() => {
    const known = new Set(library.tags.map(tag => tag.id));
    setFilters(current => current.filter(id => known.has(id)));
  }, [library.tags]);
  useEffect(() => {
    const privacy = () => {
      api.list().then(data => setSlides(current => current.filter(image => data.images.some(item => item.id === image.id)))).catch(() => setSlides([]));
    };
    const storage = event => { if (event.key === "image-library-revision") privacy(); };
    window.addEventListener("image-library-changed", privacy); window.addEventListener("storage", storage);
    return () => { window.removeEventListener("image-library-changed", privacy); window.removeEventListener("storage", storage); };
  }, []);
  async function perform(work) {
    if (action.current) return;
    action.current = true; setBusy(true); setError("");
    try { await work(); } catch (failure) { setError(failure.message); }
    finally { action.current = false; setBusy(false); }
  }
  async function addFiles(files) {
    if (!files.length) return;
    return perform(async () => {
      const result = await api.upload(files);
      setNotice(new Set(result.images.map(image => image.id)).size + " image(s) ready in Image Review. Duplicate uploads keep their saved captions, tags, and ratings.");
      if (result.errors.length) setError(result.errors.map(item => item.name + ": " + item.error).join("\n"));
      setFolder("pending"); setFavoritesOnly(false); api.changed();
    });
  }
  function start(images = selection.enabled ? selection.items : filtered, index = 0) {
    if (!images.length) return;
    setSlides([...images]); setPosition(index); setError(""); setNotice("");
  }
  const saveCaption = () => editor.current?.save();
  const navigate = index => perform(async () => { await saveCaption(); setPosition(index); });
  const close = () => perform(async () => { await saveCaption(); setSlides([]); api.changed(); });
  function rate(rating, review_status) {
    if (!current) return;
    return perform(async () => {
      await saveCaption(); const updated = await api.edit(current.id, { rating, ...(review_status ? {review_status} : {}) });
      setSlides(items => items.map(item => item.id === current.id ? { ...item, ...updated } : item));
      if (position + 1 < slides.length) setPosition(value => value + 1);
      else { setSlides([]); setNotice("Review complete. Captions, tags and review decisions are saved."); }
      api.changed();
    });
  }
  async function tagsChanged() {
    const data = await api.list();
    setSlides(items => items.map(image => {
      const updated = data.images.find(item => item.id === image.id);
      return updated ? { ...image, tag_ids: updated.tag_ids } : image;
    }));
    await library.refresh();
  }
  function take(image,destination){return perform(async()=>{await saveCaption();await destinations.take(image,destination);setSlides([]);});}
  function fileReviewed(images) { return perform(async () => { await saveCaption(); setSlides([]); setFiling(images); }); }
  function exportSet(images,label='selected'){return perform(async()=>{await saveCaption();downloadBlob(await api.exportImages(images.map(image=>image.id)),`review-${label}.zip`);setNotice(`Exported ${images.length} images with captions, ratings and tags.`);});}
  function startWorkflow(images){return perform(async()=>{
    if(images.length>100)throw new Error('A workflow supports up to 100 reference images. Select fewer images.');
    await saveCaption();
    for(const image of images)await destinations.readImage(image);
    let workflow=await workflowApi.create();
    for(const image of images)workflow=await workflowApi.importSource(workflow,api.sourceFor(image));
    setSlides([]);dispatch({type:'OPEN_IMAGE_WORKFLOW',payload:workflow.id});
  });}
  return <section className="image-review" aria-label="Image Review">
    <header className="review-page-heading"><div><h1>Image Review</h1><p>Review images, add notes, and keep your favorites.</p></div></header>
    <nav className="review-view-switcher" aria-label="Review tools">
      {[['images','Images'],['classify','People & scenes'],['organize','Organize files']].map(([key,label])=><button type="button" key={key} aria-pressed={view===key} onClick={()=>setView(key)}>{label}</button>)}
    </nav>
    {(error || library.error) && <p className="workflow-error" role="alert">{error || library.error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div hidden={view !== 'images'}>
    <div className="review-main-toolbar">
      <button className="review-primary" type="button" disabled={busy || !(selection.enabled ? selection.items.length : filtered.length)} onClick={() => start()}>Start review{filtered.length ? ` (${selection.enabled ? selection.items.length : filtered.length})` : ''}</button>
      <button type="button" disabled={busy} onClick={() => upload.current.click()}>Upload images</button>
      <input type="search" aria-label="Search images to review" placeholder="Search images…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
    </div>
    <div className="review-filter-bar">
      <label>Show<select aria-label="Image review filter" value={folder} onChange={event=>{setFolder(event.target.value);setPage(0);}}>
        <option value="all">All images</option><option value="pending">To review</option><option value="reviewed">Reviewed (no rating)</option><option value="liked">Liked</option><option value="disliked">Disliked</option>
      </select></label>
      <label title="Favorites are bookmarks, independent of the review rating"><input type="checkbox" checked={favoritesOnly} onChange={event=>{setFavoritesOnly(event.target.checked);setPage(0);}}/>★ Favorites only</label>
      <details className="review-tag-filters"><summary>Tags{filters.length ? ` (${filters.length})` : ''}</summary>
        <ImageTagButtons filtering tags={library.tags} selected={filters} onToggle={id => { setFilters(current => id === null ? [] : current.includes(id) ? current.filter(value => value !== id) : [...current, id]); setPage(0); }} onChanged={tagsChanged} disabled={busy} />
      </details>
      <button type="button" className="review-density" onClick={() => setCompact(value => !value)}>{compact ? "Larger thumbnails" : "Compact view"}</button>
    </div>
    <FreshFileInput type="file" hidden multiple ref={upload} accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; addFiles(files); }} />
    <p role="status">{filtered.length} matching image(s){filters.length ? " · matches all " + filters.length + " selected tag(s)" : ""}</p>
    <BulkActions compact selection={selection} items={filtered} label="images" batch={batch} disabled={busy} actions={[
      { label: "Add selected to folder", onClick: setFiling },
      { label: "Start workflow with selected", onClick: startWorkflow },
      { label: "Add to favorites", onClick: items=>batch.run({items,selection,action:image=>api.edit(image.id,{favorite:true}),verb:'Bookmarked:',after:api.changed}) },
      { label: "Remove from favorites", onClick: items=>batch.run({items,selection,action:image=>api.edit(image.id,{favorite:false}),verb:'Removed bookmark:',after:api.changed}) },
      { label: "Mark reviewed without rating", onClick: items=>batch.run({items,selection,action:image=>api.edit(image.id,{review_status:'reviewed',rating:null}),verb:'Reviewed:',after:api.changed}) },
      { label: "Export selected", onClick: items=>exportSet(items) },
      { label: "Like", primary: true, onClick: items=>batch.run({items,selection,action:image=>api.edit(image.id,{rating:'liked'}),verb:'Liked:',after:api.changed}) },
      { label: "Dislike", primary: true, onClick: items=>batch.run({items,selection,action:image=>api.edit(image.id,{rating:'disliked'}),verb:'Disliked:',after:api.changed}) },
      ...(folder !== "pending" ? [{ label: "Return selected to review", onClick: items => batch.run({ items, selection, action: image => api.edit(image.id, { rating: null }), verb: "Returned to review:", after: api.changed }) }] : []),
      { label: "Delete selected copies", danger: true, onClick: items => batch.run({ items, selection, action: image => api.remove(image.id), confirm: "Delete " + items.length + " library copies? Original files and source chats/workflows are unchanged.", verb: "Deleted copies:", after: api.changed }) },
    ]} />
    {pages > 1 && <CollectionPager label="review images" page={currentPage} pages={pages} onChange={setPage} />}
    {!filtered.length && <div className="review-empty"><h2>{library.images.length ? "No images match these filters" : "Your review starts here"}</h2><p>{library.images.length ? "Try All images, clear tags, or turn off Favorites only." : "Upload images to review them. Your original files stay in place."}</p>{library.images.length > 0 && <button type="button" onClick={()=>{setFolder("all");setFilters([]);setFavoritesOnly(false);setQuery("");setPage(0);}}>Show all images</button>}</div>}
    <div className={"image-gallery " + (compact ? "image-gallery-compact" : "")}>{filtered.slice(currentPage * size, (currentPage + 1) * size).map(image => <div className="gallery-item-row" key={image.id}>
      <SelectionCheckbox selection={selection} item={image} label={"image " + image.name} disabled={busy || batch.busy} />
      <button className={"gallery-item " + (selection.has(image) ? "is-selected" : "")} type="button" disabled={busy || batch.busy} aria-pressed={selection.has(image)} onMouseDown={preventSelectionText} onClick={event => selection.activate(image,event,()=>start(filtered, filtered.findIndex(item => item.id === image.id)))}><span className="gallery-thumbnail">{canReadReviewImage(image)?<ImageThumbnail src={image.url} alt={image.name} />:<span>{reviewFileMessage(image)}</span>}</span><span className="gallery-name">{image.name}</span></button>
      <div className="review-destinations"><button type="button" disabled={busy||batch.busy} onClick={()=>fileReviewed([image])}>Add to folder</button><details className="review-card-more"><summary>More</summary><button type="button" disabled={busy||batch.busy||!destinations||!canReadReviewImage(image)} onClick={()=>take(image,'editor')}>Edit Image</button><button type="button" disabled={busy||batch.busy||!destinations||!canReadReviewImage(image)} onClick={()=>take(image,'workflow')}>Start Workflow</button></details></div>
      {selection.has(image) && canReadReviewImage(image) && <ImageItemActions image={image} />}
    </div>)}</div>
    </div>
    <div hidden={view !== 'classify'}><VisualReview embedded source="library" active={active&&view==='classify'} ids={(selection.enabled ? selection.items : filtered.slice(currentPage*size,(currentPage+1)*size)).map(image=>image.id)} onChanged={()=>{api.changed();library.refresh();}} /></div>
    <div hidden={view !== 'organize'}><ReviewWorkflow embedded source="library" active={active&&view==='organize'} ids={selection.items.map(image=>image.id)} onChanged={()=>{api.changed();library.refresh();}} /></div>
    {filing && <FileImagesDialog images={filing} folders={library.folders} onClose={() => setFiling(null)} />}
    <dialog ref={dialog} className="review-slideshow" aria-label="Image review slideshow" onCancel={event => { event.preventDefault(); close(); }} onClose={() => { if (!active) saveCaption()?.catch(() => {}); }} onKeyDown={event => {
      if (busy || event.target.closest("input, textarea, select")) return;
      if (event.key === "ArrowRight") { event.preventDefault(); navigate(Math.min(slides.length - 1, position + 1)); }
      if (event.key === "ArrowLeft") { event.preventDefault(); navigate(Math.max(0, position - 1)); }
    }}>
      {current && <><header><div><h2>{current.name}</h2><p>{position + 1} of {slides.length}{current.rating ? " · " + current.rating : ""}</p></div><button type="button" autoFocus disabled={busy} onClick={close}>Close slideshow</button></header>
        <div className="review-slide-stage"><button type="button" aria-label="Previous review image" disabled={busy || position === 0} onClick={() => navigate(position - 1)}>‹</button>{canReadReviewImage(current)?<ProtectedImage src={current.url} alt={current.name} />:<p role="status">{reviewFileMessage(current)}</p>}<button type="button" aria-label="Next review image" disabled={busy || position === slides.length - 1} onClick={() => navigate(position + 1)}>›</button></div>
        <div className="review-votes">
          <button type="button" aria-label="Like image" disabled={busy} onClick={() => rate("liked")}>👍 Like</button>
          <button type="button" aria-label="Dislike image" disabled={busy} onClick={() => rate("disliked")}>👎 Dislike</button>
          <button type="button" disabled={busy} onClick={() => {const decision=completeReview(current);rate(decision.rating,decision.review_status);}}>Done & next</button>
          <button type="button" aria-pressed={!!current.favorite} disabled={busy} title="Bookmark independently of the review rating" onClick={()=>perform(async()=>{await saveCaption();const updated=await api.edit(current.id,{favorite:!current.favorite});setSlides(items=>items.map(item=>item.id===current.id?{...item,...updated}:item));api.changed();})}>{current.favorite?'★ Favorite':'☆ Favorite'}</button>
        </div>
        <details className="review-use-image"><summary>Use image</summary>
        <div className="review-destinations" aria-label="Use reviewed image"><button type="button" disabled={busy} onClick={()=>fileReviewed([current])}>Add to folder</button><button type="button" disabled={busy||!destinations||!canReadReviewImage(current)} onClick={()=>take(current,'editor')}>Edit Image</button><button type="button" disabled={busy||!destinations||!canReadReviewImage(current)} onClick={()=>take(current,'workflow')}>Start Workflow</button><button type="button" disabled={busy||!canReadReviewImage(current)} onClick={()=>exportSet([current],'image')}>Export image &amp; caption</button></div>
        {canReadReviewImage(current) && <ImageItemActions image={current} />}
        </details>
        <ImageReviewMetadata key={current.id} ref={editor} image={current} tags={library.tags} disabled={busy} onTagsChanged={tagsChanged} onSaved={update => {
          setSlides(items => items.map(item => item.id === update.id ? { ...item, ...update } : item));
          library.refresh();
        }} />
        {error && <p role="alert">{error}</p>}
      </>}
    </dialog>
  </section>;
}

