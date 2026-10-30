# Workspace guide

Use navigation to open a tool, the side pane to keep a second workspace visible,
and each tool’s **Info** control for its local instructions. Detailed workflows
have one owner in the [documentation index](../README.md).

## Application lifecycle

Close (X), Alt+F4 and File → Exit quit the desktop and stop its owned backend.
Minimizing keeps work running. Finish or cancel active work before quitting;
backend-owned generation jobs do not survive a backend restart.

Rebuild/restart after changing Electron, preload or backend code. Redraw Window
refreshes painting without reloading the renderer; a full refresh can lose
unsaved pane state. Startup can open blank or resume the last chat when configured.

## Chat, appearance and side panes

Workspace options control layout, side panes and the second chat. Resize panels
within their supported bounds; narrow layouts adapt controls and transcript width.
Appearance controls change the displayed interface, not model capabilities.

Use [Chat](../chat/CHAT_GUIDE.md) for exact response limits, thinking, attachments
and generated documents; [Characters](../images/CHARACTERS.md) for roleplay;
and [Knowledge](KNOWLEDGE_VAULT.md) for indexed context. Index notes and checklists
remain separate from chat history and Knowledge ingestion.

## Web

Expand **Web** for **Browser**, **Research & Sources**, and **Reels Analyzer**.
Research & Sources groups model-free search/preview, local-model research,
recurring public sources, and the public page importer. Chat's Internet button
remains a shortcut to that importer. Each Web tool's Info bubble explains its
controls, storage and account boundaries; Info Center has the same Web category.
Existing tool routes and side-pane selections remain available. Arrange remembers
Web's position and its tool order; Find a tab searches all three destinations.

## Design & Programming

**Design & Programming** is a main tab beside Dashboard, Functions, and Info
Center. It contains **UI Playground**, **Styling Library**, **HTML Viewer**,
**CSS / Styling**, **JavaScript Viewer**, and **Markdown Viewer**. Find a tab,
Browser source inspection, Functions, and existing pins still reach the individual
viewers. Arrange tabs also controls their order inside this workspace.

Start with one of six templates, then independently choose any existing palette,
interface font, code font, and contrast setting. Mix accents, corner treatments,
information density, card surfaces, button styles, and reduced motion. Compare
generation-studio, dashboard, or chat samples at fluid, tablet, and phone widths;
fixed preview widths shrink to fit the pane. Sample controls make no model calls.

The comparison board accepts all 20 Styling Library examples. Add or remove
components, reorder them, and compare them with the current palette and type.
Each preview is isolated. **Add to playground** in the library transfers an
example to this board. **Open preview CSS / HTML** and **Edit component CSS**
send the corresponding generated source to the existing viewers.

Changes stay in the preview until **Apply to app**. Applying saves the palette,
fonts, contrast, and supported shared-control treatments for this desktop.
Corners affect shared buttons and fields; density adjusts shared tool/navigation
spacing; surface/button choices affect common cards and tool actions. Embedded
apps and native surfaces retain their own styling. Sample layouts and components
remain in the playground. **Undo application** restores the preceding appearance
unless another appearance change has happened since; **Use app appearance**
copies current settings into the draft. **Original** keeps each control's existing
treatment. Appearance settings still provide a full appearance reset.

The draft and up to 30 named presets save locally. Saving an existing name replaces
that preset. Export/import a versioned design JSON to move it between computers;
imports and preset loads only change the draft. **Save preview HTML** exports the
selected sample, while design JSON includes the comparison-board selection.
These local designs are removed when their browser storage is cleared.

## Viewers, canvas and Paint

Markdown in Design & Programming offers source and formatted views. HTML/CSS preview runs in an opaque
sandbox with scripts, forms and external resources disabled.

Spreadsheets opens UTF-8 CSV/TSV with search, sorting and row/column selection.
Its bounds are 10 MB, 100,000 data rows and 200 columns. Formulas remain text;
XLSX is not supported. Sending data to chat uses a bounded excerpt with scope and
truncation notes. Viewer drafts survive tab navigation, not a reload.

Canvas provides text, shapes, lines, arrows and freehand drawing on a persistent
board, with current-session Undo/Redo. Paint is a separate local drawing workspace.
Save/export intended output explicitly; these are not image-generation models.
Use [3D Viewer & Editor](../media/THREE_D_VIEWER.md) for STL/3MF/project editing.

## Shortcut Registry

Open Viewers → Shortcut Registry or pin it beside chat. Application folders start
collapsed. Search by action/keys and filter by application/category/type; matching
folders expand. Save/Copy Reference includes all matching entries, even in
collapsed folders.

Create personal entries or an application folder. Built-in entries are read-only.
Personal entries and names live in browser storage and are removed if it is cleared.
Custom icons are local image files up to 128 KB; icons are not exported in text.
The bundled Word/Excel references describe those applications, not a claim that
Document Editor implements every listed shortcut.

## Utilities and storage

[Functions](FUNCTIONS.md) owns explicit program launch, capture and fixed sequences.
[Local Files and Folder Review](FILE_TOOLS.md) owns bounded local file inspection.
Hash Auditor compares content hashes and reports differences; an equal hash
establishes byte identity, not that a file is safe or semantically correct.

[Storage libraries and backup](STORAGE_AND_BACKUP.md) explains managed media,
external folders, restore and reset. Image Manager and Media Manager have separate
catalogs/data owners. Review the owning tool before deleting a file or record.

[Audio](../media/AUDIO.md) includes Sound Mixer and playback recording.
[Web Research & Sources](../development/WEB_SYSTEM.md),
[Browser](../development/BROWSER.md),
[PC bridge](../setup/PC_BRIDGE.md) and
[Mobile companion](../../mobile-companion/docs/SETUP.md) each have separate connection
and persistence boundaries.

## Review and publication

Use [development](../development/DEVELOPMENT.md) for source synchronization,
validation and the Dashboard GitHub update workflow. A build identifier records
source metadata; it does not certify every feature or installed runtime.
See [verification](../development/VERIFICATION.md) for dated results and known gaps.
