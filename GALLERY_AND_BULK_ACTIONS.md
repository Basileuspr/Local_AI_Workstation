# Image viewer and multiple selection

In **Images**, click a thumbnail to open an image viewer that fills most of the
window. The image fits without cropping or changing its proportions. Previous
and Next arrows, or the left/right keyboard keys, browse every image in the
current filtered folder, including images on other thumbnail pages. Navigation
wraps at the ends. Close or Escape returns to the same gallery without switching
chats, resetting its thumbnail size, or clearing the chat draft. **Go to source
chat** is a separate action for general images. Compact view and Larger
thumbnails still control the gallery.

The viewer also works in **Workflow Images**, across matching runs and their
stitched images. **Save / stitch this run** opens that run's export controls.
Exports remain described in `IMAGE_WORKFLOWS.md`.

## Selecting multiple items

Use the collection's **Select …** button to reveal checkboxes. Select individual
items, or **Select all (N)** for all current search matches across pages. A
selection stays selected when it is outside the current search; the selected
count is the total that the action will affect. **Clear selection** unchecks all
items, and **Done selecting** exits selection mode. In the image gallery,
checkboxes select and clicking the image still enlarges it.

| Collection | Batch action | Behavior |
| --- | --- | --- |
| Chats | Delete selected chats | Moves chats to Recently deleted for recovery. |
| Recently deleted | Delete selected forever | Permanently deletes the selected trashed chats. |
| General Images | Hide selected images | Hides gallery entries; images remain usable in their chats. |
| General Images | Delete selected images | Removes images from their chats and cleans up unshared files. |
| Knowledge | Remove selected documents | Removes indexed documents/chunks, leaving original input files alone. |
| Prompt Index | Delete selected entries | Deletes selected saved entries; unrelated editor drafts remain. |
| Phrase buttons → Edit buttons | Remove selected buttons | Removes selected locally saved phrase buttons. |
| Custom Profile | Delete selected profiles | Removes saved presets while keeping current chat/image settings. |
| LoRA dataset | Remove selected training images | Removes project copies, preserving original source files; locked during training/analysis. |
| Image Workflows stages | Remove selected stages | Edits the current draft; Save changes persists it. Remaining stages may need new sources. |

Each batch asks for one confirmation explaining its effect. Cancelling keeps
the selection and data intact. Requests run sequentially using existing deletion
APIs. Successful items disappear from the selection; failures stay selected,
with a count and error details, so they can be retried. A chat currently streaming
must be stopped before deleting it. Existing per-item buttons remain available.

## Data integrity and verification

Chat deletion now preserves the original if moving it to trash fails. Session
updates replace complete files atomically, so a failed write does not truncate
the saved chat. Older raw image arrays receive durable IDs so multiple removals
cannot shift another image's identity. Hiding an image only affects gallery
listing, not its chat image URL. Shared image files retain the existing retention
checks.

`galleryAndBulkActions.test.jsx` covers navigation, collections, selection,
partial failures, legacy deletion ordering, API errors and profile preservation.
`test_bulk_deletion_safety.py` uses temporary stores for failed moves/writes,
partial batch recovery, stable raw-image identities and retained chat images.
Desktop UI checks use disposable app profiles and a temporary `LAW_DATA_DIR`.
