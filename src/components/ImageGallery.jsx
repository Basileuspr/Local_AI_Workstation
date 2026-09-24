import ProtectedImage from "../ImagePrivacy";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import CollectionPager from "./CollectionPager";
import WorkflowImageLibrary from "./WorkflowImageLibrary";
import ImageViewer from "./ImageViewer";
import ImageItemActions from "./ImageItemActions";
import { useAnalyzeIterate } from "../AnalyzeIterateContext";
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
import "./ImageLibrary.css";

export default function ImageGallery({ images, onOpen, onRemove, onDelete, onImagesRemoved, active = true, workspaceTarget, onNavigate }) {
  const iterate = useAnalyzeIterate();
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
  const pageSize = compact ? 36 : 18;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages - 1);

  const collections = [
    ["general", "General Images"], ["workflows", "Workflow Images"], ["saved", "Saved Images"],
    ["liked", "Liked Images"], ["disliked", "Disliked Images"], ["hidden", "Hidden Images"], ["locked", "Locked Images"],
  ];
  const title = selectedFolder?.name || collections.find(([id]) => id === folder)?.[1] || "Images";
  function chooseFolder(value) { setFolder(value); setPage(0); setQuery(""); setSelectedImageId(null); onNavigate?.(); }
  const navigation = <nav className="image-library-navigation" aria-label="Image collections">
    <p className="image-library-nav-label">Collections</p>
    {collections.map(([id, name]) => <button type="button" key={id} aria-current={folder === id ? "page" : undefined}
      className={id === "hidden" ? "image-library-private-start" : ""} onClick={() => chooseFolder(id)}>{name}</button>)}
    <div className="image-library-folder-heading"><p className="image-library-nav-label">Folders</p>
      <button type="button" aria-label="New image folder" title="New folder" onClick={() => { setFolderEditor({}); onNavigate?.(); }}>+</button></div>
    {library.folders.map(item => <button type="button" key={item.id} title={item.name}
      aria-current={folder === `folder:${item.id}` ? "page" : undefined} onClick={() => chooseFolder(`folder:${item.id}`)}>{item.name}</button>)}
    {!library.folders.length && <p className="image-library-folder-note">Create folders to organize your images.</p>}
  </nav>;

  const workspace = <section className="image-library-workspace" aria-label="Image library" data-density={compact ? "compact" : "comfortable"}>
    <header className="image-library-header"><div><p className="image-library-eyebrow">Image library</p><h1>{title}</h1></div>
      <span className="image-library-description">Browse, organize, and open your images.</span></header>
    <div className="image-library-toolbar">
      <label className="image-library-mobile-collection">Collection<select aria-label="Image collection" value={folder} onChange={event => chooseFolder(event.target.value)}>
        {collections.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        {library.folders.map(item => <option key={item.id} value={`folder:${item.id}`}>{item.name}</option>)}
      </select></label>
      <input type="search" aria-label="Search image library" placeholder={folder === "workflows" ? "Search workflows or runs…" : "Search images or chats…"}
        value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
      <div className="image-library-density" role="group" aria-label="Thumbnail size">
        <button type="button" aria-pressed={!compact} onClick={() => { setCompact(false); setPage(0); }}>Comfortable</button>
        <button type="button" aria-pressed={compact} onClick={() => { setCompact(true); setPage(0); }}>Compact</button>
      </div>
      {selectedFolder && <details className="image-library-folder-menu"><summary>Folder options</summary><div>
        <button type="button" onClick={() => setFolderEditor(selectedFolder)}>Rename folder</button><button type="button" onClick={async () => {
          if (!window.confirm(`Delete folder "${selectedFolder.name}"? Its images stay in Saved Images.`)) return;
          try { await libraryApi.deleteFolder(selectedFolder.id); chooseFolder("saved"); libraryApi.changed(); } catch (failure) { setError(failure.message); }
        }}>Delete folder</button>
      </div></details>}
    </div>
    {(error || library.error) && <p role="alert">{error || library.error}</p>}
    {folder === "workflows" && <WorkflowImageLibrary active={active} onFile={setFiling} onLock={lockImages} searchQuery={query} workspace />}
    {folder === "locked" && <LockedImages active={active} pending={locking} searchQuery={query} onImported={result => setLocking(current => current.filter(image => !result.succeeded.some(done => done.id === image.id)))} />}
    {(selectedFolder || ["saved", "liked", "disliked"].includes(folder)) && <CollectionImages key={folder} active={active} title={title} searchQuery={query} compactView={compact} workspace
      images={library.images.filter(image => !image.hidden && (selectedFolder ? image.folder_ids.includes(selectedFolder.id) : folder === "saved" ? !isReviewUpload(image) : image.rating === folder))}
      folderId={selectedFolder?.id} folders={library.folders} tags={library.tags} onLock={lockImages} onOpenSource={onOpen} />}
    {folderEditor && <FolderEditor folder={folderEditor.id ? folderEditor : null} onClose={() => setFolderEditor(null)} onSaved={saved => { setFolderEditor(null); setFolder(`folder:${saved.id}`); }} />}
    {filing && <FileImagesDialog images={filing} folders={library.folders} onClose={() => setFiling(null)} />}
    <div hidden={!["general", "hidden"].includes(folder)}>
    <div className="collection-toolbar image-library-results">
      <span className="image-library-result-count">{filtered.length} {query ? "matching " : ""}image{filtered.length === 1 ? "" : "s"}</span>
      <CollectionPager label="images" page={currentPage} pages={pages} onChange={setPage} />
      <BulkActions selection={selection} items={filtered} label="images" batch={batch} actions={[
        {label:hidden ? "Restore selected images" : "Hide selected images", onClick:items => hidden ? restoreSelected(items) : removeSelected(items, false)},
        {label:"Add selected to folder", onClick:setFiling},
        {label:"Lock selected images", onClick:lockImages},
        {label:"Delete selected images", danger:true, onClick:items => removeSelected(items, true)},
      ]} />
    </div>
    {!filtered.length && <div className="image-library-empty"><strong>{query ? "No matching images" : hidden ? "No hidden images" : "Your images, in one place"}</strong>
      <p>{query ? "Try another image name or chat title." : hidden ? "Images you hide from the gallery will appear here." : "Images uploaded or generated in chats will appear here. Choose Workflow Images to browse completed workflow runs."}</p>
      {query && <button type="button" onClick={() => setQuery("")}>Clear search</button>}</div>}
    <div className={`image-gallery ${compact ? "image-gallery-compact" : ""}`}>
      {filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((image) => (
        <div className="gallery-item-row" key={image.id}>
          <SelectionCheckbox selection={selection} item={image} label={`image ${image.name}`} disabled={batch.busy} />
          <button className={`gallery-item ${selection.has(image) ? "is-selected" : ""}`} type="button" title={`${selection.enabled ? "Select" : "Enlarge"} ${image.name}`}
            aria-pressed={selection.enabled ? selection.has(image) : undefined} disabled={batch.busy} onClick={() => selection.enabled ? selection.toggle(image) : setSelectedImageId(image.id)}>
            <span className="gallery-thumbnail"><ProtectedImage loading="lazy" src={image.url} alt={image.name} /></span>
            <span className="gallery-details">
              <span className="gallery-name">{image.name}</span>
              <span className="gallery-meta">{image.session_title || image.source || "Saved image"}</span>
            </span>
          </button>
          {selection.has(image) && <ImageItemActions image={image} />}
        </div>
      ))}
    </div>
    </div>
    <ImageViewer images={filtered.map(image => ({...image, caption: image.session_title}))} selectedId={selectedImageId}
      onAnalyze={iterate?.image}
      active={active && ["general", "hidden"].includes(folder) && !selection.enabled} onSelect={setSelectedImageId} onClose={() => setSelectedImageId(null)} onOpenSource={onOpen} actions={image => <>
        <button type="button" onClick={() => { setSelectedImageId(null); setFiling([image]); }}>Add to folder</button><button type="button" onClick={() => lockImages([image])}>Lock image</button>
        <button type="button" disabled={batch.busy} onClick={event => hidden ? restoreSelected([image]) : image.library ? removeSelected([image], false) : onRemove(image, event)}>{hidden ? "Restore to gallery" : "Hide from gallery"}</button>
        <button type="button" className="danger" disabled={batch.busy} onClick={event => image.library ? removeSelected([image], true) : onDelete(image, event)}>Delete image permanently</button>
      </>} />
  </section>;
  return <>{navigation}{workspaceTarget ? createPortal(workspace, workspaceTarget) : workspace}</>;
}
