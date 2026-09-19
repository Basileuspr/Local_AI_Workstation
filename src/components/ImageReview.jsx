import FreshFileInput from "./FreshFileInput";
import { useEffect, useRef, useState } from "react";
import useImageLibrary from "../useImageLibrary";
import * as api from "../imageLibraryApi";
import { reviewImages } from "../imageReview";
import ProtectedImage from "../ImagePrivacy";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";
import CollectionPager from "./CollectionPager";
import ImageTagButtons from "./ImageTagButtons";
import ImageReviewMetadata from "./ImageReviewMetadata";
import FileImagesDialog from "./ImageFolderTools";

export default function ImageReview({ active }) {
  const library = useImageLibrary(active);
  const [folder, setFolder] = useState("pending");
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
  const filtered = reviewImages(library.images, folder, filters, query);
  // Filtered-out images cannot remain selected for Start slideshow.
  const selection = useSelection(filtered, image => image.id, folder);
  const batch = useBatchAction();
  const current = slides[position];
  const size = compact ? 12 : 6, pages = Math.max(1, Math.ceil(filtered.length / size)), currentPage = Math.min(page, pages - 1);
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
      setFolder("pending"); api.changed();
    });
  }
  function start(images = selection.enabled ? selection.items : filtered, index = 0) {
    if (!images.length) return;
    setSlides([...images]); setPosition(index); setError(""); setNotice("");
  }
  const saveCaption = () => editor.current?.save();
  const navigate = index => perform(async () => { await saveCaption(); setPosition(index); });
  const close = () => perform(async () => { await saveCaption(); setSlides([]); api.changed(); });
  function rate(rating) {
    if (!current) return;
    return perform(async () => {
      await saveCaption(); await api.edit(current.id, { rating });
      setSlides(items => items.map(item => item.id === current.id ? { ...item, rating } : item));
      if (position + 1 < slides.length) setPosition(value => value + 1);
      else { setSlides([]); setNotice("Review complete. Your preferences are saved in Liked Images and Disliked Images."); }
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
  return <section className="image-review" aria-label="Image Review">
    <header><p className="image-studio-eyebrow">IMAGE PREFERENCES</p><h1>Image Review</h1><p>Review images, save captions, and apply tags. Review uploads stay out of General Images.</p></header>
    <nav className="image-folders" aria-label="Review folders"><button type="button" aria-pressed={folder === "pending"} onClick={() => setFolder("pending")}>To review ({reviewImages(library.images, "pending").length})</button><button type="button" aria-pressed={folder === "liked"} onClick={() => setFolder("liked")}>👍 Liked Images</button><button type="button" aria-pressed={folder === "disliked"} onClick={() => setFolder("disliked")}>👎 Disliked Images</button></nav>
    {(error || library.error) && <p className="workflow-error" role="alert">{error || library.error}</p>}
    {notice && <p role="status">{notice}</p>}
    <ImageTagButtons filtering tags={library.tags} selected={filters} onToggle={id => { setFilters(current => id === null ? [] : current.includes(id) ? current.filter(value => value !== id) : [...current, id]); setPage(0); }} onChanged={tagsChanged} disabled={busy} />
    <div className="review-controls"><button type="button" disabled={busy} onClick={() => upload.current.click()}>Upload images</button><button type="button" disabled={busy || !(selection.enabled ? selection.items.length : filtered.length)} onClick={() => start()}>Start slideshow ({selection.enabled ? selection.items.length : filtered.length})</button><button type="button" onClick={() => setCompact(value => !value)}>{compact ? "Larger thumbnails" : "Compact view"}</button></div>
    <FreshFileInput type="file" hidden multiple ref={upload} accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; addFiles(files); }} />
    <input type="search" aria-label="Search images to review" placeholder="Search names or captions…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
    <p role="status">{filtered.length} matching image(s){filters.length ? " · matches all " + filters.length + " selected tag(s)" : ""}</p>
    <BulkActions selection={selection} items={filtered} label="images" batch={batch} disabled={busy} actions={[
      { label: "Add selected to folder", onClick: setFiling },
      ...(folder !== "pending" ? [{ label: "Return selected to review", onClick: items => batch.run({ items, selection, action: image => api.edit(image.id, { rating: null }), verb: "Returned to review:", after: api.changed }) }] : []),
      { label: "Delete selected copies", danger: true, onClick: items => batch.run({ items, selection, action: image => api.remove(image.id), confirm: "Delete " + items.length + " library copies? Original files and source chats/workflows are unchanged.", verb: "Deleted copies:", after: api.changed }) },
    ]} />
    <CollectionPager label="review images" page={currentPage} pages={pages} onChange={setPage} />
    <div className={"image-gallery " + (compact ? "image-gallery-compact" : "")}>{filtered.slice(currentPage * size, (currentPage + 1) * size).map(image => <div className="gallery-item-row" key={image.id}>
      <SelectionCheckbox selection={selection} item={image} label={"image " + image.name} disabled={busy || batch.busy} />
      <button className={"gallery-item " + (selection.has(image) ? "is-selected" : "")} type="button" disabled={busy || batch.busy} aria-pressed={selection.has(image)} onClick={() => {
        if (folder !== "pending" && !selection.enabled) start(filtered, filtered.findIndex(item => item.id === image.id));
        else { if (!selection.enabled) selection.start(); selection.toggle(image); }
      }}><span className="gallery-thumbnail"><ProtectedImage src={image.url} alt={image.name} /></span><span className="gallery-name">{image.name}</span></button>
    </div>)}</div>
    {filing && <FileImagesDialog images={filing} folders={library.folders} onClose={() => setFiling(null)} />}
    <dialog ref={dialog} className="review-slideshow" aria-label="Image review slideshow" onCancel={event => { event.preventDefault(); close(); }} onClose={() => { if (!active) saveCaption()?.catch(() => {}); }} onKeyDown={event => {
      if (busy || event.target.closest("input, textarea, select")) return;
      if (event.key === "ArrowRight") { event.preventDefault(); navigate(Math.min(slides.length - 1, position + 1)); }
      if (event.key === "ArrowLeft") { event.preventDefault(); navigate(Math.max(0, position - 1)); }
    }}>
      {current && <><header><div><h2>{current.name}</h2><p>{position + 1} of {slides.length}{current.rating ? " · " + current.rating : ""}</p></div><button type="button" autoFocus disabled={busy} onClick={close}>Close slideshow</button></header>
        <div className="review-slide-stage"><button type="button" aria-label="Previous review image" disabled={busy || position === 0} onClick={() => navigate(position - 1)}>‹</button><ProtectedImage src={current.url} alt={current.name} /><button type="button" aria-label="Next review image" disabled={busy || position === slides.length - 1} onClick={() => navigate(position + 1)}>›</button></div>
        <ImageReviewMetadata key={current.id} ref={editor} image={current} tags={library.tags} disabled={busy} onTagsChanged={tagsChanged} onSaved={update => {
          setSlides(items => items.map(item => item.id === update.id ? { ...item, ...update } : item));
          library.refresh();
        }} />
        <div className="review-votes"><button type="button" aria-label="Like image" disabled={busy} onClick={() => rate("liked")}>👍 Like</button><button type="button" aria-label="Dislike image" disabled={busy} onClick={() => rate("disliked")}>👎 Dislike</button></div>
        {error && <p role="alert">{error}</p>}
      </>}
    </dialog>
  </section>;
}

