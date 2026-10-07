# Paint workspace

The Canvas tab now opens `CanvasPaintWorkspace`. Its raster document engine,
file IPC, and IndexedDB storage are separate from the previous object canvas.
When no Paint draft exists, previous Canvas artwork is imported into one layer;
the old localStorage record is preserved. Object-based chat edits are disabled
for Paint. **Use in chat** stages a removable PNG attachment before Send.

The workspace includes brushes, shapes, fill, text, rectangular/free-form
selections, selection resize and movement, crop, rotations, flips, resize/skew,
layers, rulers, grid, thumbnail, zoom, undo/redo, image imports, and printing.
PNG preserves transparency; JPEG and BMP flatten onto white. WebP is available
when supported by the browser. Editable `.lawpaint` projects preserve layers.
Native saves use a file dialog and detect changes made outside Paint. Cancelled
saves retain the document's dirty state. Opening or creating a replacement
requires confirmation when the current artwork has unsaved changes.

Drafts are saved in IndexedDB and survive workspace remounts and application
reloads. A failed recovery blocks automatic replacement of the unreadable draft.
Project validation bounds dimensions, layers, pixel memory, and embedded PNGs.
History is limited to 30 changes and 128 MiB of snapshots. Large documents may
retain fewer undo steps.

## Verification

`node scripts/build-review-paint-qa.mjs` builds disposable fixtures.
`electron scripts/qa-review-paint.cjs` uses its own profile, backend and generated
files. It checks real pointer input and pixels, undo/redo, layers, project/PNG
saves, cancellation, pending chat attachments, and IndexedDB reload recovery.
The fixture's save dialog is simulated; native save IPC and disk writes are real.
Additional desktop checks cover shape outlines, fill, selection/crop, text,
rotation, resizing, project reopen, and all supported raster export formats.
Printing and real printer output are manual acceptance checks.
