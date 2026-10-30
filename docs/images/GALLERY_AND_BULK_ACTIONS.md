# Gallery, collections and visual review

Gallery displays managed app images; [Image Manager](IMAGE_MANAGER.md) catalogs
external folders. Their metadata, storage and deletion controls are distinct.

## Browse, select and save

Gallery groups include General/chat images, Workflow Images, Hidden, Saved,
Liked/Disliked and custom folders. Review-only imports are excluded from General.
Use search and filters to narrow the view. The viewer can move across pages;
Escape closes it without discarding a draft edit.

The enlarged viewer has **+ / −**, **Fit**, **100%**, mouse-wheel zoom and drag
pan. At higher zoom it loads the original, including stitched grids; it does not
enlarge the small preview. Keyboard **+ / −**, **0** (Fit) and **1** (100%) also
work. Arrow keys pan when the zoomed image surface has focus; the browse buttons
continue to select adjacent images.

Saved images have **Save image as…** and **Show original in folder**. The desktop
save dialog streams the original bytes directly to your chosen file, verifies
the size and hash, and reports the completed destination. **Open saved copy** and
**Show saved copy in folder** work after saving. Canceled/failed saves preserve
an existing destination. These controls also appear immediately after stitching.

Multi-selection can span pages. Select-all follows the current filtered result;
review the count and any selected items outside the visible page before a bulk
action. Failed items remain selected so they can be retried.

Saving into a collection creates an independently owned copy. Removing folder
membership does not delete the saved image, and deleting its source chat does not
remove that copy. Rotation in the viewer is a viewing preference; export through
[Image Editor](IMAGE_EDITOR.md) to change pixel orientation.

Adding an existing saved image to a folder changes membership without uploading,
decoding or duplicating its bytes. Gallery uploads and catalog/workflow copies
stream through local disk without a generic megabyte or megapixel cutoff. Actual
format support, available disk and decoder memory still determine what can open.

## Stitch still images

Select at least two frames, arrange their order and choose horizontal, vertical
or grid layout. Original-size/automatic controls preserve the documented layout
choices; fitting does not crop or unnecessarily enlarge smaller frames.
**Preview** does not save. **Save** creates a new PNG in Saved/General and leaves
sources unchanged.

The gallery stitcher has no fixed application cap on frame count or final canvas
pixels. It uses a disk-backed canvas and incremental PNG output; physical disk,
memory and decoder limits still apply. Missing or locked sources fail explicitly
rather than being silently omitted. This differs from the smaller, bounded
stitch export inside [Image Workflows](IMAGE_WORKFLOWS.md).

## Visual review

Review separates **To review**, **Reviewed (no rating)**, **Liked** and
**Disliked**. Favorites are independent. **Done & next** marks review complete
without inventing a rating. Captions autosave; navigation waits for pending saves.
Manual tags and metadata remain distinct from automated suggestions.

Stored source identity and content hashes help retain metadata across exact
copies. Shared byte-identical content can share classification state; that does
not make unrelated or transformed copies the same image.

Vision analysis is explicit and uses an installed model through the shared queue.
Accept suggested labels after inspection. Person/group/scene labels are not
identity verification. CPU face detection is a separate operation. Restarted
analysis batches are reported interrupted.

Exports preserve original image bytes with caption sidecars. They support up to
500 items per selection, use ZIP64 and streamed transfers, and recheck hashes and
vault access. There is no aggregate 512 MiB cutoff. Desktop exports report the
saved file; browser exports use the browser download manager.

## Reviewed file plans

Advanced review can prepare Copy, Move or Leave plans using presets such as
Character References, Training Candidates, Approved Generations, Backgrounds,
Archive and Rejects. Preparing a plan does not create destination folders or
transfer files.

Review the exact plan, then confirm execution. It rechecks source hashes and
destination state, uses exclusive writes and verifies copies before removing a
move source. Sidecars follow the plan. Undo Move is allowed only when the output
is unchanged and the original destination is available.

Locate File reconnects a hash-matching file to its existing identity. Removing a
stale entry preserves file bytes and retained metadata. Accepting optional vision
tags preserves independently managed favorite/project status.

Video review suggestions use a selected preview frame, not continuous motion
analysis. Native video ownership and the separate Media Manager bridge remain
restricted; a still-frame label is not a review of an entire clip.

## Private Image Vault

Vault access checks cover protected sources and byte-identical copies across
gallery, chat, editing, analysis and export. Existing known workflow derivatives
are concealed with their protected source; unrelated transformed copies cannot
be recognized automatically.

Unlock inside the vault. Its temporary access expires after 15 minutes and when
leaving/hiding the vault. Restore makes an item public again. Active jobs can
block protection changes.

The vault stores encrypted private copies; it does not encrypt every original
external file. There is no forgotten-PIN bypass. Preserve the required backup and
credentials before removing other copies. See [storage](../workspace/STORAGE_AND_BACKUP.md).
