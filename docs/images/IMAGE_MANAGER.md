# Image Manager and folder tools

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
previews and handoffs have their own byte/pixel limits; a file appearing in a scan
does not guarantee every editor can open it.

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
