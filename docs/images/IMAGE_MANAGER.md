# Image Manager and folder tools

The browsing toolbar keeps views, filters, thumbnail density, page size, Image
tools and selection actions available while scrolling. Its height follows the
actual pane, including split layouts. Scroll inside the toolbar or use Tab to
reach the rest of a large group; the image list retains its scrolling space.

Image Manager catalogs external still-image folders without importing their
originals. Its separate SQLite catalog survives app-data reset/import. Desktop
storage defaults to its user-data area; direct-backend use has a separate default.
`LAW_IMAGE_MANAGER_DIR` overrides the catalog location. External image files
are not included merely by backing up that catalog.

## Register and browse folders

1. Add a source/output folder and scan it to populate the catalog.
2. Choose **Browse folder** explicitly. A new view starts at **No folder selected**.
3. Filter, inspect and select the catalogued images.

Scan checkboxes select scan targets; they do not choose the browsed folder.
**Reset filters** clears browsing/filter/selection state without deleting metadata.
**Forget folder** removes its catalog entries and metadata while preserving
external bytes. It is blocked for a folder with relevant Trash/active work.

Scans skip links and excluded locations, including NVIDIA data. They use a
100,000-entry bound and preserve unvisited entries after partial scans. File
previews retain only small cached images and decode one source per worker slot.
Original-file handoffs have no 64 MiB gate; available memory, disk and decoder
support still determine whether a particular processing tool can open a file.

## Preview navigation and stitcher

Open **Preview**, then use **Previous image**, **Next image**, or the left/right
arrow keys. Browsing follows the current filters and sort across page boundaries,
wraps at either end, and shows your position among matching images. Escape closes
the preview. Existing edit, reveal, chat-draft and Gallery-copy actions use the
currently displayed image. Refresh retains the browsing view during a scan;
preview and selection state are temporary.

Use **+ / −**, **Fit**, **100%**, mouse-wheel zoom and drag pan to inspect detail.
Zoom loads original pixels instead of enlarging the preview. When the zoomed
surface has focus, arrow keys pan; the browse buttons still move between images.

Enable **Image stitcher** to pick frames on cards, add a frame from Preview, or
use **Selection options → Add selected to stitcher**. Picks retain their order
across pages and filters. The numbered tray supports reordering, reversing and
removal. **Preview stitch** uses Gallery's existing strip/grid controls, frame
size, spacing and background options. **Save stitched image** creates an independent
PNG in Saved Images; **Save image as…** exports its full resolution and confirms
the saved location, with buttons to open or reveal the saved copy.

Stitching reads revalidated catalog originals without importing or changing them
or their manual metadata. Missing, changed or locked frames stop the operation.
Rescan changed files or remove/restore the affected frame before retrying. Only
the display preview is reduced; large outputs need temporary disk space.

## Metadata and duplicates

Review tags and captions before saving. Duplicate detection matches file bytes,
not visual similarity; hardlinks may be reported separately from distinct copies.
Reviewed duplicate-folder operations are bounded and use new destination names.
The retained original is revalidated before a plan removes a duplicate.

## Copy, move, delete and restore

Copy/Move organization uses a reviewed plan, with up to 1,000 items per operation.
Inspect the sources, destinations and actions, then click **Apply reviewed plan**.
The current UI supplies its confirmation token internally; there is no phrase to
type. Execution revalidates the plan rather than trusting an earlier scan.

Deletion moves reviewed files to recoverable Trash on the same drive. Permanent
deletion has a separate confirmation. Restore refuses to overwrite an existing
file. Content changes, unavailable destinations or active work can prevent an
operation. A successful scan is not authorization to transfer or delete files.

## Image Tools

Choose source folders explicitly. There is no implicit fallback to the last
browsed folder. Targets must be outside the source folders.

- **Exact dimensions** prepares the requested canvas; PNG uses a disk-backed
  path for large outputs.
- **Fit** preserves aspect ratio within its supported target limit.
- Sheet tools arrange multiple images with pagination/preview and fill controls.
- GIF and alternate codecs have format-specific byte/dimension limits.

Folder batches have no generic 1,000-image cap; previews are paged. Very large
outputs still require adequate disk space and codec support. JPEG/WebP limits
differ from PNG, and removing a generic PNG pixel cap does not remove physical
resource limits.

Functions can scan, find duplicates, prepare plans and produce reports. They do
not apply file transfers automatically. Backend jobs can continue while changing
tabs; after a restart, inspect the retained review receipt and submit deliberately
rather than assuming unfinished transfers resume.

## Backup and ownership

Use catalog export/backup before moving to a fresh installation. Back up the
external folders separately if their bytes must be recoverable. App-data
reset/import preserves the independent catalog but does not protect files from an
explicit Image Manager move/delete action.

[Gallery and visual review](GALLERY_AND_BULK_ACTIONS.md) ·
[Storage and backup](../workspace/STORAGE_AND_BACKUP.md) ·
[Functions](../workspace/FUNCTIONS.md)
