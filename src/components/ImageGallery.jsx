import ProtectedImage from "../ImagePrivacy";
import { useEffect, useState } from "react";
import CollectionPager from "./CollectionPager";
import WorkflowImageLibrary from "./WorkflowImageLibrary";
import ImageViewer from "./ImageViewer";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";
import * as api from "../api";
import useImageLibrary from "../useImageLibrary";
import * as libraryApi from "../imageLibraryApi";
import CollectionImages from "./CollectionImages";
import FileImagesDialog, { FolderEditor } from "./ImageFolderTools";
import LockedImages from "./LockedImages";
import { orderImageDeletions } from "../bulkActions";
import { isReviewUpload } from "../imageReview";
import CollapsibleImageFolder from "./CollapsibleImageFolder";

export default function ImageGallery({ images, onOpen, onRemove, onDelete, onImagesRemoved, active = true }) {
  const [folder, setFolder] = useState("general");
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(true);
  const [page, setPage] = useState(0);
  const library = useImageLibrary(active);
  const [hiddenImages, setHiddenImages] = useState([]);
  const [folderEditor, setFolderEditor] = useState(null);
  const [filing, setFiling] = useState(null);
  const [locking, setLocking] = useState([]);
  const [error, setError] = useState("");
  const hidden = folder === "hidden";
  const originalIds = new Set(images.map(image => image.id));
  const owned = library.images.filter(image => !isReviewUpload(image) && !!image.hidden === hidden && !(image.origin?.kind === "session" && originalIds.has(`${image.origin.session_id}:${image.origin.message_id}:${image.origin.image_id}`)) && image.origin?.kind !== "workflow");
  const shown = [...(hidden ? hiddenImages : images), ...owned];
  const selection = useSelection(shown, item => item.id, folder);
  const selectedFolder = library.folders.find(item => `folder:${item.id}` === folder);
  function lockImages(items) { setLocking(items); setSelectedImageId(null); setFolder("locked"); }
  useEffect(() => {
    if (!active || !hidden) return;
    let ignore = false;
    const refresh = () => api.listSessionImages(true).then(items => { if (!ignore) setHiddenImages(items); }).catch(error => { if (!ignore) setError(error.message); });
    refresh(); window.addEventListener("image-library-changed", refresh);
    return () => { ignore = true; window.removeEventListener("image-library-changed", refresh); };
  }, [active, hidden]);
  function restoreSelected(items) {
    return batch.run({ items, selection, verb: "Restored to gallery:", action: image => image.library ? libraryApi.edit(image.id, { hidden: false }) : api.restoreSessionImage(image.session_id, image.image_id), after: libraryApi.changed });
  }
  const batch = useBatchAction();
  function removeSelected(items, permanent) {
    return batch.run({items:permanent ? orderImageDeletions(items) : items, selection, verb:permanent ? "Permanently deleted" : "Hidden from gallery:",
      confirm:permanent ? `Permanently delete ${items.length} selected image(s) from their chats and disk? This cannot be undone.`
        : `Remove ${items.length} selected image(s) from the gallery? They will stay in their chats.`,
      action:image => image.library ? (permanent ? libraryApi.remove(image.id) : libraryApi.edit(image.id, { hidden: true })) : (permanent ? api.permanentlyDeleteSessionImage : api.removeSessionImage)(image.session_id, image.image_id),
      after:async result => { await onImagesRemoved?.(result, permanent); libraryApi.changed(); }});
  }
  const filtered = shown.filter((image) => [image.name, image.session_title, image.source]
    .some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const pageSize = compact ? 12 : 6;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);

  return <section aria-label="Image library">
    <nav className="image-folders" aria-label="Image folders">
      <button type="button" aria-pressed={folder === "general"} onClick={() => setFolder("general")}>General Images</button>
      <button type="button" aria-pressed={folder === "workflows"} onClick={() => setFolder("workflows")}>📁 Workflow Images</button>
      <button type="button" aria-pressed={folder === "liked"} onClick={() => setFolder("liked")}>👍 Liked</button>
    </nav>
    <div className="collection-toolbar">
      <button type="button" aria-pressed={hidden} aria-expanded={hidden} onClick={() => setFolder(value => value === "hidden" ? "general" : "hidden")}>See hidden Images</button>
      <button type="button" aria-pressed={folder === "locked"} onClick={() => setFolder("locked")}>🔒 Locked Images</button>
      <label>Image folder<select aria-label="Image folder" value={folder.startsWith("folder:") || ["saved", "liked", "disliked"].includes(folder) ? folder : ""} onChange={event => { if (event.target.value) setFolder(event.target.value); }}>
        <option value="">Choose a folder…</option><option value="saved">Saved Images</option><option value="liked">Liked Images</option><option value="disliked">Disliked Images</option>
        {library.folders.map(item => <option key={item.id} value={`folder:${item.id}`}>{item.name}</option>)}
      </select></label>
      <button type="button" onClick={() => setFolderEditor({})}>+ New folder</button>
      {selectedFolder && <><button type="button" onClick={() => setFolderEditor(selectedFolder)}>Rename folder</button><button type="button" onClick={async () => {
        if (!window.confirm(`Delete folder "${selectedFolder.name}"? Its images stay in Saved Images.`)) return;
        try { await libraryApi.deleteFolder(selectedFolder.id); setFolder("saved"); libraryApi.changed(); } catch (failure) { setError(failure.message); }
      }}>Delete folder</button></>}
    </div>
    {(error || library.error) && <p role="alert">{error || library.error}</p>}
    {folder === "workflows" && <CollapsibleImageFolder key={folder} name="Workflow Images"><WorkflowImageLibrary active={active} onFile={setFiling} onLock={lockImages} /></CollapsibleImageFolder>}
    {folder === "locked" && <CollapsibleImageFolder key={folder} name="Locked Images"><LockedImages active={active} pending={locking} onImported={result => setLocking(current => current.filter(image => !result.succeeded.some(done => done.id === image.id)))} /></CollapsibleImageFolder>}
    {(selectedFolder || ["saved", "liked", "disliked"].includes(folder)) && <CollapsibleImageFolder key={folder} name={selectedFolder?.name || {saved:"Saved Images", liked:"Liked Images", disliked:"Disliked Images"}[folder]}><CollectionImages active={active} title={selectedFolder?.name || {saved:"Saved Images", liked:"Liked Images", disliked:"Disliked Images"}[folder]}
      images={library.images.filter(image => !image.hidden && (selectedFolder ? image.folder_ids.includes(selectedFolder.id) : folder === "saved" ? !isReviewUpload(image) : image.rating === folder))}
      folderId={selectedFolder?.id} folders={library.folders} tags={library.tags} onLock={lockImages} onOpenSource={onOpen} /></CollapsibleImageFolder>}
    {folderEditor && <FolderEditor folder={folderEditor.id ? folderEditor : null} onClose={() => setFolderEditor(null)} onSaved={saved => { setFolderEditor(null); setFolder(`folder:${saved.id}`); }} />}
    {filing && <FileImagesDialog images={filing} folders={library.folders} onClose={() => setFiling(null)} />}
    <div hidden={!["general", "hidden"].includes(folder)}>
    <div className="collection-toolbar">
      <div className="collection-heading">
        <span>{hidden ? "Hidden Images" : "Images"} ({shown.length})</span>
        <button type="button" onClick={() => {
          setCompact(!compact); setPage(0);
        }}>{compact ? "Larger thumbnails" : "Compact view"}</button>
      </div>
      <input type="search" aria-label="Search image library" placeholder="Search images or chats…"
        value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
      {query && <small>{filtered.length} matching images</small>}
      <CollectionPager label="images" page={currentPage} pages={pages} onChange={setPage} />
      <BulkActions selection={selection} items={filtered} label="images" batch={batch} actions={[
        {label:hidden ? "Restore selected images" : "Hide selected images", onClick:items => hidden ? restoreSelected(items) : removeSelected(items, false)},
        {label:"Add selected to folder", onClick:setFiling},
        {label:"Lock selected images", onClick:lockImages},
        {label:"Delete selected images", danger:true, onClick:items => removeSelected(items, true)},
      ]} />
    </div>
    {!filtered.length && <p className="gallery-empty">{images.length
      ? "No matching images. Try another name or chat."
      : "Images uploaded or generated in chats will appear here."}</p>}
    <div className={`image-gallery ${compact ? "image-gallery-compact" : ""}`}>
      {filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((image) => (
        <div className="gallery-item-row" key={image.id}>
          <SelectionCheckbox selection={selection} item={image} label={`image ${image.name}`} disabled={batch.busy} />
          <button className="gallery-item" type="button" title={`${selection.enabled ? "Select" : "Enlarge"} ${image.name}`}
            aria-pressed={selection.enabled ? selection.has(image) : undefined} disabled={batch.busy} onClick={() => selection.enabled ? selection.toggle(image) : setSelectedImageId(image.id)}>
            <span className="gallery-thumbnail"><ProtectedImage loading="lazy" src={image.url} alt={image.name} /></span>
            <span className="gallery-details">
              <span className="gallery-name">{image.name}</span>
              {!compact && <span className="gallery-meta">{image.source}</span>}
            </span>
          </button>
          <button className="gallery-remove-btn" type="button" title={hidden ? "Restore to gallery" : "Remove from gallery"}
            disabled={batch.busy}
            aria-label={hidden ? `Restore ${image.name} to gallery` : `Remove ${image.name} from gallery`} onClick={(event) => hidden ? restoreSelected([image]) : image.library ? removeSelected([image], false) : onRemove(image, event)}>{hidden ? "Restore" : "×"}</button>
          <button className="gallery-purge-btn" type="button" title="Permanently delete from this chat and disk"
            disabled={batch.busy}
            aria-label={`Permanently delete ${image.name}`} onClick={(event) => image.library ? removeSelected([image], true) : onDelete(image, event)}>Del</button>
        </div>
      ))}
    </div>
    </div>
    <ImageViewer images={filtered.map(image => ({...image, caption: image.session_title}))} selectedId={selectedImageId}
      active={active && ["general", "hidden"].includes(folder) && !selection.enabled} onSelect={setSelectedImageId} onClose={() => setSelectedImageId(null)} onOpenSource={onOpen} actions={image => <><button type="button" onClick={() => { setSelectedImageId(null); setFiling([image]); }}>Add to folder</button><button type="button" onClick={() => lockImages([image])}>Lock image</button></>} />
  </section>;
}
