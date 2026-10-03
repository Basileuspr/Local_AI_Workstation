# Image Manager

Open **Images → Image Manager**, beside Gallery. This workspace catalogs existing
still-image folders independently from Gallery and Media Manager. It does not
import Media Manager code, use its server/storage, or run FFmpeg.

**Selection:** Ctrl-click toggles a file; Shift-click selects the inclusive range
from the last clicked selection; Ctrl+Shift-click adds that range. These work on
thumbnails, filenames and checkboxes, including Trash checkboxes. A range follows
the current displayed order and stays within the shown page. Changing filters,
sort, page or workspace resets its starting point. Ordinary selection clicks
keep their existing toggle behavior, and the separate Preview button opens images.
Command-click provides the same toggle on macOS.

**Review & classify** adds selection slideshows, Like/Dislike, captions, existing
tags, and image/notes ZIP exports. Local face grouping can place a group photo
under several people; name each group once and correct mistaken matches.
An installed vision model can classify settings such as park, beach or kitchen.
Use **Classify unprocessed catalog** to continue through cataloged images in
batches. These classifications share a content-hash catalog with Image Review
and Media Manager; original file catalogs remain separate. See
[Visual Review](VISUAL_REVIEW.md) for controls, routes and limits.

## Browse and review

The **Image tools** button opens conversion, sizing, strip/grid stitching and GIF
creation. Use selected catalog images or a catalog folder (up to 1,000 images),
review their order and choose a registered output folder outside the source trees.
Each run creates a new subfolder, retains every original and saves individual
copies alongside the optional stitch or GIF. New still images enter the catalog;
animated GIF exports stay outside the still-image library. Tasks can be stopped;
completed copies remain and History records their paths. This tool uses Image
Manager's own processing and storage. Media Manager exposes its Image tools only
inside **Snapshots**.

1. Add one or more source folders. Check the folders to process, choose whether
   to include subfolders, and click **Scan folders**.
2. Browse thumbnails; filter filenames/tags, folder, format, month or favorites.
   **Untagged only** temporarily displays only images with no catalog tags, before pagination.
   Newly tagged selections disappear while this filter is on. View tabs, filters
   and tagging/selection controls stay visible as you scroll through images.
   **View density** offers **Compact**, **Comfortable**, and **Extra comfortable**.
   Extra comfortable uses larger cards and 300-pixel-high thumbnails with higher
   resolution previews. Your density choice is saved between app sessions.
   Click an image or filename to select/deselect it; use **Preview** for the
   larger view. Favorites and tags change catalog metadata
   only, without writing to originals. Setting tags replaces the selected images'
   catalog tags; an empty field clears them.
   **Hide tagged images** saves a hidden status for every currently tagged image
   in the folder filter (or all catalog folders), across all pages and independent
   of selection, search, date and format filters. **Hide selected** hides just the
   selection. Hidden status survives filter resets, rescans and app restarts.
   **Show tagged images** toggles a view of tagged images, including hidden ones,
   within the current filters. Hidden images have a **Hidden** label.
   **Unhide images** brings back every hidden image in the folder filter (or all
   catalog folders), across pages and independent of the other filters.
   Open **Hidden** or turn on **Show tagged images**, select images and click
   **Unhide selected** to bring back just those images.
   These actions only change catalog metadata; originals remain
   in place. Newly tagged images can be hidden by clicking the saved action again.
3. Open a preview to show its original in Explorer, open it in Image Editor,
   explicitly save a copy to Gallery, or add a removable pending chat attachment.
   Adding to a draft preserves its text and does not send it.
4. In **Duplicates**, click **Find exact duplicates** for checked source folders.
   SHA-256 checks matching-size candidates. Groups represent identical bytes,
   not visual similarity. Hardlinked paths can share physical storage. Review
   groups without any automatic duplicate deletion.

### Delete unwanted copies

Each image has a visible **Delete** button. Select several images and use
**Delete selected** to review their exact names and locations, including selections
hidden by filters. Cancel preserves all files; **Delete reviewed files** moves
only the reviewed copies into Image Manager's recoverable Trash on the same drive.
Opening or scanning the manager never deletes files, and scans skip its Trash.

Open **Trash** to restore individual files or a selection. Restore preserves
catalog tags and favorites and refuses to overwrite occupied original filenames.
Trash retains the bytes. To reclaim space, use **Delete permanently** inside
Trash and confirm the separate file review; that step cannot be undone.
File hashes are checked before deletion, restoration and permanent deletion.
Folders containing recoverable Trash cannot be forgotten until it is restored
or permanently removed. Batch operations accept up to 1,000 files.

### Send duplicates to a folder

In Duplicates, click **Send duplicates to folder** and choose one source folder.
Choose **Extra copies** to leave one image per exact group in the source, or
**Every matching image** to include all group members. Choose Move or Copy.

**Prepare duplicate-folder plan** checks hashes again and creates/registers the
empty `<source>/Duplicates` output folder. The plan preserves relative folders
inside subfolders named by duplicate hash, with numbered names for collisions.
Review source/destination paths and the originals being kept in Organize, then
click **Apply reviewed plan**. Confirmations use buttons; no phrases need to be
typed for copies, moves, deletion, restoration or permanent Trash deletion. Changed sources, retained originals,
linked destinations and occupied planned targets refuse the operation. A source
scan skips registered output folders, so filed duplicates do not reappear as new
source candidates. They remain browsable under their output folder in the catalog.
Larger duplicate sets use plans of up to 1,000 images. After a successful batch,
click **Prepare next duplicate batch** to continue. Copy advances to the next
source members; Move recalculates the remaining members after completed moves.

## App tab priority

Click **Arrange tabs** at the top of the app navigation. Drag rows or use the
arrows to rearrange all navigation sections and tabs within any section,
including Workspace, Images, Characters & Training, Viewers, Dashboard/Queue and
Functions. **Save tab order** persists the layout across restarts; Cancel leaves
it unchanged and Reset to default restores the original order when saved.

Scans recognize JPEG, PNG, WebP, BMP, TIFF, AVIF and single-frame GIF when supported
by the installed Pillow build. Animated and multiple-frame images are excluded,
along with video, directory links/junctions and NVIDIA paths. EXIF orientation
informs dimensions/previews. Date layouts prefer EXIF capture time, then EXIF
image time, then explicitly labeled file modification time. Capture dates have
no inferred timezone.

## Organize files

Select images, choose **Organize**, and select an existing output folder outside
the source folder trees. Choose Copy or Move and a layout: year/month,
year/month/day, format, or existing relative folders.

**Prepare plan** records every source, exact destination, source file signature
and SHA-256. It creates no image copies. Existing or repeated filenames receive
numbered suffixes. Review the table and type its action/count phrase, such as
`COPY 12`, before **Apply reviewed plan** is enabled.

The backend preflights all sources and destinations before writing, creates files
exclusively without overwrites, then verifies the resulting bytes. Move unlinks
each selected source only after verification and a final source check. Stop or
failure preserves completed transfers and verified copies; it does not roll
back previous successful moves. Transfer receipts record each attempted file's
paths, hash, status and any error. Inspect History before retrying remaining
files. Plans are single use after transfer begins; refused preflight plans can
be prepared again. Recent plans remain available after restarting.

## Image functions

In **Functions**, create a named sequence with selected source folders and:

- Scan selected folders
- Find exact duplicates
- Prepare organization plan
- Prepare duplicate-folder plan (one source folder)
- Save catalog/results report

Add, remove and reorder steps; save or edit functions and run them explicitly.
The organization step uses all catalog images in the function's source scope,
up to 1,000 per reviewed plan. It prepares a plan, including a Move plan if chosen;
functions never apply file transfers. A later report includes the generated plan.
Reports are unique JSON files in the configured output folder. Reports without a
scan describe the existing catalog snapshot, including previously checked hashes.

Jobs belong to the backend and continue when navigating away. Reopening reads
status without restarting the task. Closing the app stops its backend; unfinished
transfers require receipt review rather than automatic resumption.

## Storage and bounds

Catalog, functions, plans and transfer receipts live in
`data/image_manager/catalog.sqlite3` (or `LAW_DATA_DIR/image_manager`). Cached JPEG
previews stay under its `thumbnails` directory. Forgetting a source folder removes
its catalog entries and metadata, preserving original files. Saved functions
referencing that folder must be edited to choose a current source.

Scans visit at most 100,000 entries; partial scans preserve unvisited catalog
entries. Previews are bounded to 40 megapixels / 256 MiB originals. Explicit
handoffs through existing app image destinations support images up to 40 MiB;
larger images can still be shown in Explorer. Transfers are limited to 1,000
selected images per plan. Exact groups and filenames are catalog snapshots;
rescan after external edits. Plans recheck actual source bytes before applying.

## Verification

- `venv\Scripts\python.exe -m pytest tests/backend/test_image_manager.py tests/backend/test_image_manager_tools.py`
- `npm test -- tests/frontend/imageManager.test.jsx`
- Build to `tmp/image-manager-build`, then run
  `node_modules\electron\dist\electron.exe scripts/qa-image-manager.cjs`.

The desktop QA runs a real hidden renderer and backend against disposable image
folders, covering thumbnails, duplicate hashing, reviewed copies, saved functions,
reports and pending chat attachments. It does not operate on user image folders.
