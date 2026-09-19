import { useState } from "react";
import ProtectedImage from "../ImagePrivacy";
import ImageViewer from "./ImageViewer";
import CollectionPager from "./CollectionPager";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";
import * as api from "../imageLibraryApi";
import FileImagesDialog from "./ImageFolderTools";

export default function CollectionImages({ images, folders = [], tags = [], title = "Saved Images", active = true, onOpenSource, onLock, extraActions = [], folderId }) {
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(true);
  const [page, setPage] = useState(0);
  const [view, setView] = useState(null);
  const [filing, setFiling] = useState(null);
  const selection = useSelection(images, item => item.id, title);
  const batch = useBatchAction();
  const filtered = images.filter(image => `${image.name} ${image.origin?.title || ""}`.toLowerCase().includes(query.toLowerCase()));
  const size = compact ? 12 : 6, pages = Math.max(1, Math.ceil(filtered.length / size)), current = Math.min(page, pages - 1);
  const apply = (items, action, verb, confirm) => batch.run({ items, action, verb, confirm, selection, after: api.changed });
  return <section aria-label={title}>
    <div className="collection-toolbar"><h3>{title} ({images.length})</h3><button type="button" onClick={() => setCompact(value => !value)}>{compact ? "Larger thumbnails" : "Compact view"}</button>
      <input type="search" aria-label={`Search ${title}`} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search names…" />
      <BulkActions selection={selection} items={filtered} label="images" batch={batch} actions={[
        ...extraActions,
        { label: "Add selected to folder", onClick: setFiling },
        ...(folderId ? [{ label: "Remove selected from folder", onClick: items => apply(items, item => api.edit(item.id, { folder_ids: item.folder_ids.filter(id => id !== folderId) }), "Removed from folder:") }] : []),
        ...(onLock ? [{ label: "Lock selected images", onClick: onLock }] : []),
        { label: "Delete selected copies", danger: true, onClick: items => apply(items, item => api.remove(item.id), "Deleted copies:", `Delete ${items.length} library image copy/copies and their ratings? Source chats, workflows and original uploaded files are unchanged.`) },
      ]} />
      <CollectionPager label="images" page={current} pages={pages} onChange={setPage} />
    </div>
    {!images.length && <p className="gallery-empty">No images here yet.</p>}
    <div className={`image-gallery ${compact ? "image-gallery-compact" : ""}`}>{filtered.slice(current * size, (current + 1) * size).map(image => <div className="gallery-item-row" key={image.id}>
      <SelectionCheckbox selection={selection} item={image} label={`image ${image.name}`} disabled={batch.busy} />
      <button className={`gallery-item ${selection.has(image) ? "is-selected" : ""}`} type="button" disabled={batch.busy} aria-pressed={selection.enabled ? selection.has(image) : undefined} onClick={() => selection.enabled ? selection.toggle(image) : setView(image.id)}>
        <span className="gallery-thumbnail"><ProtectedImage src={image.url} alt={image.name} loading="lazy" /></span><span className="gallery-details"><span className="gallery-name">{image.name}</span></span>
      </button>
    </div>)}</div>
    <ImageViewer active={active && !selection.enabled} selectedId={view} images={filtered.map(image => ({ ...image, session_id: image.origin?.session_id, message_id: image.origin?.message_id, caption: image.rating ? `Preference: ${image.rating}` : "Not rated" }))} onClose={() => setView(null)} onSelect={setView} onOpenSource={onOpenSource}
      actions={image => <><div className="collection-annotations"><p>{image.annotations?.caption || "No caption yet."}</p><p>{tags.filter(tag => image.tag_ids?.includes(tag.id)).map(tag => tag.name).join(" · ") || "No image tags yet."}</p></div><button type="button" onClick={() => { setView(null); setFiling([image]); }}>Add to folder</button>{onLock && <button type="button" onClick={() => { setView(null); onLock([image]); }}>Lock image</button>}</>} />
    {filing && <FileImagesDialog images={filing} folders={folders} onClose={() => setFiling(null)} />}
  </section>;
}
