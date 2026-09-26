# Workspace tools

These tools run locally. Documents, canvas state, selected models, Knowledge
choices, and registered program paths are private runtime data, not repository
contents. Existing files and internal metadata are preserved.

## Viewers

- Markdown has its own Viewers tab with source and formatted views.
- HTML and CSS accept pasted source or local files up to 2 MB. Preview runs in
  an opaque sandbox with scripts, forms, and external resources disabled.
- Spreadsheets opens UTF-8 CSV/TSV, with comma, semicolon, or tab separators,
  quoted/multiline cells, search, numeric/text sorting, and row/column selection.
  Limits are 10 MB, 100,000 data rows, and 200 columns. Formulas remain text.
  Use file, filtered rows, or selected rows in chat sends at most 14,000 data
  characters, with explicit scope and truncation notes. XLSX is not supported.

Viewer drafts survive tab navigation but not reload. Sending source context
opens the chat; enter the question there.

## Canvas and conversion

Canvas is a persistent 1200 by 800 board with text, shapes, lines, arrows, and
freehand drawing. Select and drag to move, Shift-click for multiple selection,
and use Undo/Redo within the current app session. Copy Canvas includes the
artwork without controls or selection outlines.

Mention canvas or whiteboard in chat to supply the selected objects, or the
whole board when nothing is selected. The board supports 300 objects; chat
context is limited to 100 objects and 10,000 characters. Chat creates or edits
typed shapes and text. Replies cannot overwrite a newer canvas revision or
edit objects outside the submitted scope. Freehand drawing is manual.

File Converter creates PNG, JPG, WebP, BMP, or TIFF copies from still images up
to 20 MB and 24 megapixels. Transparent pixels become white in JPG/BMP. Animated
and multipage files are rejected. Chat can convert an attached image when asked
explicitly; name the source if multiple images are attached. Downloads contain
only the output image. Lock checks apply to both the source and converted file.

## Knowledge and models

Each chat remembers Knowledge Off, All, or Selected documents. Selected with
no documents supplies no Knowledge. Retrieval searches the chosen scope and
supplies up to five relevant excerpts within the existing context budget;
it does not send the entire library. Replies list the supplied source filenames.
Document choices survive temporarily switching to Off or All.

Select / order models lists available chat models with full identifiers and
radio controls. Selecting a row updates the chat model; arrows reorder the
dropdown without changing that selection. Choices persist on this device.

## Desktop actions

Functions can register an executable or Windows shortcut through the native
file picker. The renderer stores an opaque ID; the desktop process retains
the path and opens only registered IDs. PowerShell and Snipping Tool are fixed
actions. Dashboard also offers Open PowerShell. WinGet discovery supports
WindowsApps execution aliases and missing PATH entries. Opening a workspace
never starts an upgrade or launches a program.

## Exports and validation

Image Library, Face Studio, and Image Workflow downloads omit JSON manifests.
Captions and the Face Studio CSV summary remain; required metadata stays in
internal stores. Existing JSON files, explicit backups, and training packages
are preserved. Media Manager's corresponding producers are bundled under
`media-manager/`; its private storage remains separate.

Automated suites cover scoped Knowledge queries, conversion formats and privacy,
CSV parsing/context, canvas edits, and launcher registration. Run `npm test`,
the backend pytest suite in isolated data directories, and `npm run build`.
`scripts/qa-workspace-launchers.cjs` exercises real Windows launch chains using
harmless hidden payloads and a temporary program; it never runs upgrades.
The native picker selection is substituted in that smoke test.
After building, run Electron with `scripts/qa-workspaces.cjs` to check the
production renderer with disposable synthetic data: sandboxed HTML/CSS,
Markdown, scoped CSV context, canvas undo/redo, and persisted model/Knowledge
choices. This smoke test does not call real models or use private app data.
