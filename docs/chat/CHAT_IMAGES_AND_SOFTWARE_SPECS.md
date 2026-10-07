# Chat images, Faces run names and software reports

Click a chat attachment, generated image, or supported local Markdown image to
open a large in-app image overlay. Keyboard activation and Escape work through
native buttons/dialogs. The floating **Start Workflow** and **Edit Image** actions
use the image currently shown:

- Start Workflow creates a saved Image Workflow and attaches the selected source.
  It opens Processing stages for configuration; it does not run a model. Stored
  sources retain provenance; temporary/inline images are uploaded as assets.
- Edit Image imports the selected image into the existing Image Editor. Color
  adjustments and exports still operate on a copy.

These actions also appear in the existing shared gallery viewer. They respect
locked-image checks and accept app-owned local references, image data URLs and
same-origin blobs. Markdown does not execute HTML or fetch arbitrary external
image URLs. The independent Media Manager remains separate.

## Named Faces runs

Set **Run name** before importing images or scanning library images. Empty names
get a timestamp. Large folder imports append a batch number to the supplied name.
Saved run history shows name, status, counts and date and supports **Rename**.
Names persist in `data/face_datasets/<dataset>/runs/<run>.json` under the configured
data root; dataset names, crops and source files are unchanged. Renaming survives
later progress saves. Previously interrupted jobs are labeled interrupted when
there is no matching current run. Historical runs from before this feature had
no persistent run records and cannot be reconstructed from their old UI state.

## Dashboard software specs

**App software specs** is separate from the existing hardware report. Check the
sections to include, then **Copy app specs** or **Export specs**. Each export takes
a fresh snapshot. **Refresh software specs** provides an inspectable preview.

- Frontend & desktop: app version, source files grouped by folder, build presence,
  and actual Electron/Chromium/Node/V8 runtime versions in the desktop app.
- Backend: current Python version/implementation and Python source folder groups.
- Dependencies only: declared JavaScript requirements and installed versions,
  Python requirements and the installed Python distribution inventory.
- Available API calls: registered route paths, methods and modules. This is an
  inventory of application operations, not an assertion of LLM tool access.
- Model list: current Ollama catalog plus discovered image models and LoRAs.
  Missing runtimes/catalogs are reported as unavailable. No inference or downloads.

**Export app logs (ZIP)** copies current and rotated `backend.log` and
`electron.log` files from the configured log directory, with a manifest. It keeps
at most the final 2 MB per file, reports truncation and redacts session/authorization
credentials. It does not recurse through user data or include source media.
Recorded local paths and diagnostic context remain in the export. When Electron
and the backend use different custom log roots, only files in the backend's
configured log root appear; the normal launcher uses a shared root.

## Verification

Focused tests cover inline URL boundaries, stable image identity, filtered copy
payloads, face-run naming/rename persistence, dependency/source inventories and
bounded credential-redacted log archives. Existing frontend, Faces, Face Bank
and Dashboard tests also passed.

`scripts/qa-chat-specs.cjs` starts a hidden isolated Electron profile, temporary
backend data and synthetic images. Its real UI checks enlarge chat/Markdown
images, route the image to Image Editor and Image Workflows, extract using a
synthetic face provider, rename a run, reload, inspect the exact clipboard payload
and validate a downloaded log ZIP. Clipboard interception keeps the user's
system clipboard untouched; this validates payload generation rather than OS
clipboard delivery. No real models run or production media/data are changed.
Set `LAW_CHAT_SPECS_QA_RESULT` for its result JSON and launch with Electron using
PowerShell `Start-Process -Wait -WindowStyle Hidden`.
