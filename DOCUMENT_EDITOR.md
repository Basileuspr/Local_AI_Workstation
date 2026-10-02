# Document Editor — phase 1

Open **Workspace → Document Editor**. This is a dedicated rich document workspace with a Word-style ribbon modeled on the supplied screenshots. React/Tiptap handles editing and Python `python-docx` handles DOCX import and export. It does not use Microsoft Word, COM automation, Office services, an AI model or a paid document-conversion API.

## Implemented

| Ribbon | Working controls |
| --- | --- |
| File | New document, open DOCX as an editable copy, document name, Export DOCX followed by Download DOCX |
| Home | Font family and size; bold, italic, underline, strikethrough, subscript and superscript; text color and yellow highlight; clear text formatting; normal and heading styles 1–3; bullet/numbered lists; indent/outdent; left/center/right/justified alignment; line spacing; paragraph marks; select all; find/replace |
| Insert | Basic rectangular tables, add/remove rows and columns, delete table, PNG/JPG/WebP pictures, external hyperlinks, symbols and manual page breaks |
| Layout | Letter/A4/Legal, portrait/landscape, margin presets and individual margins, paragraph spacing before/after |
| Review | Word/character/paragraph/picture counts, browser spell checking, read only view |
| View | Approximate paper view, flowing web view, zoom, width fit, ruler, heading navigation, paragraph marks |
| Picture Format | Contextual picture width, proportional sizing, fit to page, alt text and removal |
| Help | Implemented scope, conversion limits and deferred ribbon groups |

Editing supports undo/redo and standard keyboard copy/cut/paste, plus Ctrl+S for export and Ctrl+F/Ctrl+H for find/replace. Undo history resets when opening or starting a document. Documents remain mounted while changing app tabs.

Recovery saves one current draft in this app/browser profile's local IndexedDB, including embedded pictures. Reopening offers Restore or Discard; recovery is not a saved DOCX and does not replace explicit export. Draft storage failures are shown. The working-draft indicator deliberately does not claim that a download was saved to disk. Export creates a stable download link to that version; later edits require another export.

## Exact stopping point

**Phase 1 stops at common rich-text editing and normalized DOCX conversion. It is not a complete Word replacement.**

The paper surface shows document width, margins and manual break markers, but it does **not** calculate Word's automatic pagination, page count or exact print layout. Print/PDF output is not implemented. Font availability depends on local fonts. Word count uses whitespace boundaries, and spelling depends on the browser's dictionaries.

Deferred work from the screenshots:

- Precise pagination, headers/footers, page numbering, section breaks, columns, line numbering and hyphenation.
- Complete inherited/custom style handling, themes, document design, page borders and watermarks.
- Merged-cell editing, exact table widths, advanced table styles and layout.
- Comments, tracked changes, comparison, grammar, accessibility auditing, document protection and collaboration.
- Footnotes, endnotes, citations, bibliography, automatic table of contents, captions, cross-references, indexes and authorities.
- Shapes, diagrams, SmartArt, charts, text boxes, drawing/ink, equations, 3D objects and drawing arrangement.
- Picture cropping, corrections, background removal, effects, wrapping, rotation and floating positioning.
- Mail merge, envelopes/labels, content controls, template editing, dictation and read aloud.
- VBA, COM and Word add-ins are outside this Python editor's implementation.

The deferred tabs are visible as labeled scope panels. They do not pretend to execute these features.

## Import/export contract

Opening a file reads its uploaded bytes in memory and produces an **editable copy**. The original is never overwritten. Before replacing a working draft, the editor displays a conversion notice and any detected limitations. Export creates a new DOCX from supported editor content.

Supported text runs, basic paragraphs/headings, lists, rectangular tables, embedded PNG/JPEG/WebP pictures, external links and manual breaks are converted. The first section supplies page settings. Other sections, headers/footers, notes, comments, field behavior, tracked revisions, content controls and embedded objects are not retained as editable features; some may be omitted. Merged cells are expanded without duplicating text; nested tables are flattened. Floating images become pictures between paragraphs. Custom styles, table shading/widths and inherited formatting are approximations. Original ZIP parts are not copied into exports.

For precise preservation of an existing complex package with only text-run changes, the earlier **Local Files** editor remains available under its existing limits. The new editor prioritizes authoring and editing a supported copy. Never treat the normalized export as a lossless round trip for arbitrary Word documents.

Limits: 24 MiB input DOCX; 64 MiB expanded ZIP; 2,048 package entries; 20,000 model nodes; 1 million text characters; at most 20 pictures (8 MiB and 24 megapixels each); tables up to 100 rows and 12 columns. External image URLs are not fetched, macro packages are rejected, XML DTDs are rejected, hyperlinks are limited to HTTP(S)/mailto, and conversion routes use the app session guard. Document content is not sent to a model or included in conversion logs. Paste supports the editor's schema; use Insert → Pictures for image files.

## Implementation and validation

- `src/components/DocumentEditor.jsx` / `.css`: ribbon, editor, view, dialogs, recovery and export.
- `src/documentEditor.js`: editor schema, paragraph/page-break extensions, paste restrictions, search, counts and draft storage.
- `backend/services/document_editor.py`: validation and in-memory Python conversion.
- `backend/routes/document_editor.py`: bounded import/export endpoints, registered in the existing authenticated app.
- `tests/backend/test_document_editor.py`, `tests/frontend/documentEditor.test.js`: conversion, model, safety, search and count checks.
- `scripts/qa-document-editor.mjs`: isolated full application build; `--serve` builds and serves the editor fixture on loopback 5176.
- `scripts/qa_document_editor.py`: document-only test API on loopback 8016, isolated settings and a disposable test credential.

Browser acceptance covered authoring, heading navigation, tables, layout, keeping content across tab changes, recovery in a fresh session, find/replace and undo, exporting an actual DOCX and reopening it through the import notice. The downloaded file was inspected with Python for heading style, table contents, A4 dimensions and margins. Browser download event reporting timed out even though files were saved successfully; file inspection supplied the confirmation.

The app build is verified in a temporary output directory. The running desktop app and its live `dist` output are not replaced as part of this phase. Build/relaunch the app through its normal workflow to load the new workspace and backend route together.

Regression run: 79 related backend checks passed; 106 of 107 frontend checks passed. The remaining failure is an unrelated existing workspace-help assertion that expects the newly renamed “3D Viewer & Editor” label without HTML-escaping `&`. The Document Editor guide, navigation and new editor checks passed. Concurrent 3D-workspace edits were preserved.

Next recommended phase: pagination and the preservation contract, followed by headers/footers/page numbers and more complete style/table support. These provide a dependable base for references and review tools.

References: [Tiptap TextStyle](https://tiptap.dev/docs/editor/extensions/marks/text-style), [Tiptap TableKit](https://tiptap.dev/docs/editor/extensions/functionality/table-kit), [python-docx text API](https://python-docx.readthedocs.io/en/stable/api/text.html).
