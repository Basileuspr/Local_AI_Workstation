# Media actions and chat editing

Normal app images have **Rotate left/right**, **Place in folder**, and
**Start Folder with item** controls. Select a gallery, review, workflow, face, or
Character Parts item to show its actions; chat images show them beneath the
thumbnail. Enlarged images expose the same actions. Face and Character Parts
selections also offer **Enlarge image** independently of their crop tools.

App folders contain saved library copies, preserving source chats, crops and
workflow outputs. The new-folder shortcut opens directly to a folder name and
files the item into it. Existing-folder placement uses the library's folder picker.

Viewing rotation is saved in the app profile, keyed by the image URL without
credentials or revision parameters. It applies to thumbnails and enlargement;
it does not rewrite a source file or change crop geometry. Use the Image Editor's
rotation buttons and PNG export to save physically rotated image pixels.

## /Edit in chat

- Attach an image and send `/Edit` to open its editor inside the conversation.
- **Use with /Edit** beneath a chat image or in its enlargement selects an explicit
  target, including a rendered local Markdown image. Otherwise the latest attached
  or generated chat image is used.
- Supported instructions include `/Edit reduce red hue`, `/Edit increase contrast,
  decrease exposure`, and `/Edit rotate right`. Left and 180-degree rotation,
  increase/decrease saturation, contrast and exposure are supported. The controls
  allow precise values; unsupported phrases report an error instead of claiming an
  edit was made.
- Preview, compare, adjust, undo, then **Send edited image to chat**. The command
  and a new PNG result are appended to the originating conversation. Cancel adds
  nothing; switching chats closes the editor. Incoming messages are preserved.

This command invokes the same local pixel editor used by the dedicated tab; it
does not require a language/image model or regenerate image contents. Originals
remain intact. It shares the editor's 24 MP / 40 MiB input limits, PNG output,
color conversion and metadata limitations. Source privacy is checked before
opening and again before publishing. Media Manager cannot be targeted by /Edit.

## Media Manager

The separate module retains its own controls, folder catalog, server and state.
Rotation is a viewing preference in its own `runs/view-rotations.json`, keyed by
saved scan and item ID. Each duplicate copy rotates independently while its
angle follows moves and renames in the same saved scan. Legacy shared angles
remain starting values; new changes affect only the interacted-with item.
MP4 bytes remain unchanged.
Its folder shortcuts still use the existing reviewed, confirmed filesystem move
flow. A per-item shortcut acts only on that item, independently of bulk selection.

## Verification

- `tests/frontend/chatEdit.test.js`: command routing, combined adjustments,
  unsupported instructions, credential-free rotation identity.
- `scripts/qa-chat-edit.cjs`: hidden isolated Electron, synthetic media and real
  fixture API. Checks normal/enlarged rotation, source-preserving folder copy,
  /Edit preview and actual rotated PNG in chat, concurrent append preservation,
  latest-image selection, cancellation, Markdown target selection and reload.
- `scripts/qa-image-editor.cjs`: full-resolution rotation checked against every
  pixel of a gradient fixture, including alpha, plus prior editor/export checks.
- Media Manager `tests/ui_media_actions_test.mjs` and its HTTP tests verify
  rotation persistence without source/manifest changes, all viewer types, and
  exactly one file moved despite an unrelated bulk selection.

All verification uses temporary data and hidden/headless windows. The user's
running desktop instance is not restarted or controlled by these scripts.
