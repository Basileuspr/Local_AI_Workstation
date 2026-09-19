# Image collections and review

The Images tab retains its compact and larger thumbnail modes. Opening a thumbnail enlarges it with previous/next navigation; while **Select images** is active, the same click only changes the selection.

## Finding and organizing images

- **General Images** contains chat/generation images. **Workflow Images** keeps workflow outputs and stitched runs together. Image Review uploads (including older uploads) stay out of General Images and the ordinary Saved Images list.
- **See hidden Images** lists images removed from the normal gallery. Click it again to fold away hidden images and return to General Images. Restore an individual image or select several and restore them together. Hiding does not remove chat history.
- Selecting a custom, Saved, Liked, Disliked, Workflow, or Locked folder starts with its contents collapsed. Use **Show [folder name]** beside the folder contents to expand it, and **Hide [folder name]** to fold it away. Switching folders resets this disclosure. Collapsing Locked Images clears its private view and locks it again.
- **New folder** creates a named image collection. Select images and choose **Add selected to folder**, or use the action inside a workflow image viewer. Folder names can be renamed later.
- Filing an image saves an owned copy with its source information. Deleting its source chat does not delete that copy. Deleting a folder removes its memberships; its images remain in Saved Images or Image Review, according to their origin. Deleting a saved copy does not delete its source chat or workflow.
- **Liked** is a visible folder button in Images. Liked and disliked collections are also available in Image Review. Review uploads can be explicitly added to custom folders. Locked images are excluded from all these public lists, regardless of their rating or tags.

## Locked Images

Select images, choose **Lock selected images**, then set or enter a 4–12 digit PIN. Confirm the pending selection with the **Lock selected image(s)** button inside the unlocked folder. Existing longer PINs keep working. Use **Change PIN** inside the unlocked folder to choose a different PIN; the current PIN is required.

Locking hides the original image and byte-identical copies throughout the app, including direct image endpoints, chat thumbnails, workflow references/outputs, saved folders, review, and LoRA image reads. Existing stitched workflow derivatives are also concealed. A workflow run containing a locked output cannot be downloaded as a ZIP or stitched until the image is restored. Images already transformed into unrelated files cannot be recognized as identical by this policy.

Unlocking grants access only inside Locked Images. **Restore selected images** makes the originals available in their original collections again. Review uploads retain their review-only status, ratings, captions, and tags when restored. Leaving the folder, hiding the app, choosing **Lock now**, or reaching the 15-minute limit clears the private view. Failed PIN attempts are throttled. PINs and access tokens are not saved in browser storage.

Private image copies and their private metadata use authenticated encryption; a PIN-derived key protects their randomly generated encryption key. There is no forgotten-PIN bypass. Existing original files, source metadata, migration backups, and previously downloaded copies on disk are not encrypted or erased by this feature. This is app privacy plus encrypted private copies, not whole-disk protection. Locking is unavailable while queued work may already hold an image input; finish or stop that work first.

## Image Review

Open **Image Review**, upload multiple images, optionally select a group, and click **Start slideshow**. Saved folder copies without ratings also appear in the review list. Images fit most of the window and can be browsed with the arrows or keyboard arrow keys. Rating an image advances to the next image.

**Like** saves its rating in **Liked Images**; **Dislike** saves it in **Disliked Images**. A later rating replaces the earlier one. Both folders support viewing, selection, filing, and deleting saved copies. **Return selected to review** clears ratings without deleting images. Ratings and owned images persist across restarts.

The caption box beneath the enlarged image accepts captions or identity notes. Text autosaves after a short pause; **Save caption** is also available. Previous/next, rating, and Close slideshow wait for unsaved captions to save. A failed save retains the draft and prevents that navigation so you can retry. Notes are stored as text; no automatic identity recognition or training runs.

Use **+ Add** under **Tag this image** to create a named tag (including emoji) and automatically apply it to the current image. Clicking an existing tag toggles its assignment. **Edit tags** supports renaming and selecting multiple tags for deletion. Renaming keeps assignments; deleting a tag removes its assignments but keeps images and captions.

The **Filter by image tags** controls apply to To review, Liked Images, and Disliked Images. Every selected tag must match, and images can have additional tags. GOOD FACE alone includes both a face-only image and an image tagged GOOD FACE plus GOOD LIGHTING. Selecting both filters requires both tags. Removing a filter broadens the results; **Clear tag filters** shows all images in the current folder. Text search also searches captions. Images excluded by the current filters cannot remain selected for Start slideshow.

Uploads accept up to 100 PNG, JPEG, WebP, or single-frame GIF files at once, up to 20 MiB and 24 megapixels per image. Valid images are retained when another file fails, and failures are reported. Byte-identical uploads reuse their saved image and existing rating.

## Emoji input

Focus an editable text field and click **😀 Emoji**. Search or choose a category, then select an emoji to insert at the cursor or replace selected text. This works with prompt text, saved input, folder names, and chat/workflow/LoRA naming fields. Password and numeric fields are excluded. The picker stays offline; it uses the Unicode 17 emoji list, including searchable skin-tone variants. Display of newer emoji depends on installed fonts.

Data source: [Unicode emoji-test.txt](https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt). Redistribution terms are included in `THIRD_PARTY_EMOJI_LICENSE.txt`.

## Verification

Backend tests cover hidden-image restoration, independent folder copies, partial uploads, rating persistence, PIN authentication/throttling/expiry, original and derivative access restrictions, failed lock commits, legacy inline response protection, and storage confinement. Desktop interaction checks use a separate temporary data directory and profile; no real user images are used or deleted.

After updating backend code, fully quit the app through its system tray and reopen it so the new backend is loaded.
