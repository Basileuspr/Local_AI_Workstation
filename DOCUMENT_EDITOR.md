# Document Editor — phase 6

Open **Workspace → Document Editor**. This is a dedicated rich document workspace with a Word-style ribbon modeled on the supplied screenshots. React/Tiptap handles editing and Python `python-docx` handles DOCX import and export. It does not use Microsoft Word, COM automation, Office services, an AI model or a paid document-conversion API.

## Implemented

| Ribbon | Working controls |
| --- | --- |
| File | New document, open DOCX as an editable copy, document name, Export DOCX followed by Download DOCX |
| Home | Font family and size; bold, italic, underline, strikethrough, subscript and superscript; text color and yellow highlight; clear text formatting; normal and heading styles 1–3; bullet/numbered lists; indent/outdent; left/center/right/justified alignment; line spacing; paragraph marks; select all; find/replace |
| Styles | Normal, Heading 1–3, Title, Subtitle, Quote and No Spacing; named custom paragraph styles; apply, modify, reset to style and delete; shared updates, Undo/Redo and DOCX style definitions |
| Insert | Tables, PNG/JPG/WebP pictures, web/email/internal hyperlinks, bookmarks, symbols, manual page breaks, Header & Footer and Page numbers dialogs |
| Table Layout | Contextual range/row/column/table selection; insert and delete rows/columns; merge selected cells and split merged cells; drag column edges; column widths in inches; equal columns, fit to page and delete table |
| Table Design | Header row, repeating first row, cell shading presets/custom color, all/outside/no borders, table alignment and cell vertical alignment |
| Header & Footer | Separate regular/odd, first-page and even-page text; individual alignment; header/footer distances from page edges; different-first-page and different-odd/even switches |
| Page numbers | Top/bottom placement; left/center/right alignment; number only, Page X or Page X of Y; decimal, Roman or letter formats; starting number; optional hidden number on the first page |
| Layout | Letter/A4/Legal, portrait/landscape, margin presets and individual margins, paragraph spacing before/after; page break before, keep with next, keep lines together and widow/orphan control |
| References | Live heading-based contents with a title and level filter; point bookmarks, rename/delete/go to; links to headings and bookmarks; missing-destination checks |
| Review | Word/character/paragraph/picture counts, browser spell checking, read only view |
| View | Approximate paper view, flowing web view, zoom, width fit, ruler, heading and bookmark navigation, paragraph marks |
| Picture Format | Contextual picture width, proportional sizing, fit to page, alt text and removal |

Editing supports undo/redo and standard keyboard copy/cut/paste, plus Ctrl+S for export and Ctrl+F/Ctrl+H for find/replace. Ctrl+Alt+1–3 applies a Heading style; Ctrl+Alt+0 applies Normal. Undo history resets when opening or starting a document. Documents remain mounted while changing app tabs.

Recovery saves one current draft in this app/browser profile's local IndexedDB, including embedded pictures. Reopening offers Restore or Discard; recovery is not a saved DOCX and does not replace explicit export. Draft storage failures are shown. The working-draft indicator deliberately does not claim that a download was saved to disk. Export creates a stable download link to that version; later edits require another export.

## Exact stopping point

**This increment adds a working References ribbon: point bookmarks, links within a document, and a live table of contents generated from headings. It stops before footnotes/endnotes, citations/bibliography, captions, indexes, automatic cross-reference fields, page-number references and reliable pagination/printing. It is not a complete Word replacement.**

Use **References → Table of contents…** to insert one contents block, set its title and include heading levels 1, 1–2 or 1–3. Entries update with the document, including custom heading styles in lists and tables. Click an entry to navigate. The generated block is edited through its settings; it is not body text and is excluded from word counts and Find. Removal and settings changes support Undo. The block is inserted before the current top-level block when the cursor is at the start of a paragraph, otherwise after that block; it never nests inside a list or table.

**DOCX contents are a linked snapshot generated locally by Python.** No page numbers or Word TOC field are invented. A tagged content-control container preserves the title and level settings; reopening this editor's export restores live contents. Ordinary readers can display the cached entries and follow their links. Changes made in another editor do not automatically update that snapshot; reopen/export here to regenerate it.

Use **Insert → Bookmark** or **References → Bookmarks…** to mark the cursor position (the start of selected text, without replacing it). Names use 1–40 letters, digits or underscores, beginning with a letter; up to 100 named bookmarks are supported. Rename updates this document's internal links atomically with Undo. Delete keeps the text and leaves any links available for repair. Imported bookmark ranges become point bookmarks at their start, with a warning; range editing is deferred. Bookmarks outside supported text paragraphs are not retained.

Use **Insert → Link → Place in this document**, or **References → Link within document…**, to choose a heading or bookmark. Existing selected text is kept; a new link can have custom display text. Heading destinations remain stable while typing or changing styles, even if a heading becomes a normal paragraph. Link display text stays as entered. Ctrl+click (Command+click on macOS) follows an internal link while editing; a plain click follows it in read-only view. **Go to link**, the contents entries and the Navigation pane also jump to destinations. **Check internal links** flags deleted/missing targets and can select a link for repair; it makes no network requests.

Reference changes are saved in recovery drafts and participate in Undo/Redo. Clipboard copies of headings get new destination IDs, and duplicate pasted bookmark names are renamed; existing links keep their original destinations. Copying across documents does not automatically retarget links or copy a live contents block. Full Word range bookmarks, field codes and cross-reference updates remain outside this phase.

Use **Home → Styles…** to open the pane. Apply a style to the current paragraph or a selection, create a new style, or modify the current style. Supported properties are font family, size, color, bold/italic, paragraph alignment, left indent, before/after spacing, multiple-line spacing and heading level 1–3. Modifying a definition updates all paragraphs using it, including paragraphs in lists and tables. Custom heading styles appear in heading navigation. Each document supports eight built-in styles and up to 32 custom styles with unique names of up to 60 characters.

Applying a style resets paragraph overrides and keeps direct text formatting. **Reset to style** clears direct text/paragraph formatting across selected paragraphs while preserving hyperlink targets. Explicit bold/italic Off settings can override an emphasized style, including with Ctrl+B/Ctrl+I. Deleting a custom style switches its paragraphs to Normal or the matching Heading style; Undo restores both its definition and references. Built-in styles can be modified but not renamed/deleted. A style's heading level is fixed after creation. At the end of a title, subtitle or heading outside lists, Enter starts a Normal paragraph. Body styles continue normally.

Definitions are stored with the document and recovery draft, and style changes participate in Undo/Redo. New styles copy the current style's settings; there is no live “based on” relationship between editor styles. Existing drafts retain any explicit paragraph overrides they already contain. Clipboard content is normalized to the supported schema; styles from another document are not added to the catalog by pasting.

The paper surface remains a continuous editing view. It shows width, margins, break markers and selectable header/footer samples. It does **not** calculate automatic pagination, actual page counts, header/footer placement or exact print layout. Page numbers appear as `{PAGE}` and `{NUMPAGES}` placeholders. Export writes real fields and requests field updates; a capable DOCX reader calculates them. The editor does not supply cached page counts. A hidden first-page number still counts toward numbering, and total pages means the document page count rather than the last displayed number.

Use **Insert → Header & Footer** to enable variants and choose which area to edit. Disabled variants retain their text. Use **Insert → Page numbers** to configure numbering across enabled variants. **Layout → Line and page breaks** applies rules to the current paragraph or selection; “Use paragraph style” restores inheritance. Paragraph rules participate in Undo/Redo. Page settings remain outside the text undo history; Cancel discards uncommitted dialog changes.

Click inside a table to reveal **Table Layout** and **Table Design**. Use **Select cells…** for a rectangular range, then Merge cells. Split cell restores its grid while keeping all merged text in the first resulting cell. Column widths apply across the table, including merged cells. Dragging, shading and table changes participate in Undo/Redo. Widths are bounded to 0.25–16.67 inches per column; export scales an oversized table proportionally to the writing area. Fit to page uses that writing width.

Repeat first row writes a DOCX repeating-header property; it does not repeat anything on the continuous editing surface. A first-row cell cannot merge downward while repetition is enabled. All/outside/no borders are whole-table presets; dashed lines remain as editing guides where exported borders are absent. Cell text uses Home's paragraph alignment controls. Header cells have a default light-blue fill; use White to override it or Clear fill to restore the default.

Print/PDF output is not implemented. Font availability depends on local fonts. Word count uses whitespace boundaries, and spelling depends on the browser's dictionaries.

Deferred work from the screenshots:

- Precise pagination and print/PDF output; multiple sections, section breaks, columns, line numbering and hyphenation; rich headers/footers and per-section numbering.
- Live style inheritance, character/list/table style authoring, full theme resolution, style sets/templates, document design, page borders and watermarks.
- Advanced/inherited table styles, individual cell-border settings, row-height and cell-margin controls, nested-table editing, and exact table pagination.
- Comments, tracked changes, comparison, grammar, accessibility auditing, document protection and collaboration.
- Footnotes, endnotes, citations, bibliography, page-number contents/Word TOC fields, captions, automatic cross-reference fields, indexes and authorities.
- Shapes, diagrams, SmartArt, charts, text boxes, drawing/ink, equations, 3D objects and drawing arrangement.
- Picture cropping, corrections, background removal, effects, wrapping, rotation and floating positioning.
- Mail merge, envelopes/labels, content controls, template editing, dictation and read aloud.
- VBA, COM and Word add-ins are outside this Python editor's implementation.

The deferred tabs are visible as labeled scope panels. They do not pretend to execute these features.

## Import/export contract

Opening a file reads its uploaded bytes in memory and produces an **editable copy**. The original is never overwritten. Before replacing a working draft, the editor displays a conversion notice and any detected limitations. Export creates a new DOCX from supported editor content.

Supported text runs, basic paragraphs/headings, lists, rectangular tables, embedded PNG/JPEG/WebP pictures, external/internal links, point bookmarks and manual breaks are converted. The first section supplies page settings, header/footer text and supported numbering. Simple and complex PAGE/NUMPAGES fields are recognized for the three supported number-line patterns. Their cached results are kept out of editable footer/header text. Other field patterns become cached text with a warning. Conflicting number lines are normalized to one position, alignment and format, also with a warning. Header/footer text is limited to 2,000 characters per area; truncation is reported. Rich formatting, tables and images in these areas are not retained.

Reference export writes native bookmark start/end pairs and internal hyperlink anchors. The editor's contents container is recognized on import and its cached entries are replaced by live entries. Other block content controls, including external contents blocks, are flattened to supported visible content with a warning; their field behavior is not imported. Invalid/duplicate bookmark names are omitted with a warning. Broken internal links remain editable and are reported rather than silently converted to plain text. The implementation follows the [python-docx internal-link representation](https://python-docx.readthedocs.io/en/stable/api/text.html#hyperlink-objects) and [OOXML bookmark start/end pairing](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.bookmarkstart?view=openxml-3.0.1).

Named paragraph styles retain supported font/paragraph properties, names, heading levels and references. Source inheritance is resolved into independent editor definitions; arbitrary style graphs and unsupported style properties are not retained. Used custom source styles are imported, along with unused custom styles authored by this editor. Unsupported fonts, theme-based formatting and fixed/minimum line spacing may be approximated with a notice. Direct paragraph overrides and explicit bold/italic Off settings survive conversion. The export writes real named DOCX paragraph styles instead of duplicating their font settings into every run.

Paragraph pagination overrides, including explicit Off settings, are retained. Inherited pagination rules are resolved through the source style chain. Other sections, character-style behavior, notes, comments, general fields, tracked revisions, content controls and embedded objects are not retained as editable features; some may be omitted. Floating images become pictures between paragraphs. Original ZIP parts are not copied into exports.

Standard rectangular horizontal/vertical table merges are retained without duplicating text, along with source grid widths, direct solid cell shading, supported border presets, alignment and repeating first rows. Automatic content-based sizing becomes fixed widths. Missing row-edge cells become empty cells; nested tables are flattened with a notice. Legacy horizontal merge markup and invalid/nonrectangular grids are rejected. Custom table styles, patterned/theme fills, individual cell borders and other inherited formatting remain approximations and may be normalized with a warning. Arbitrary Word table layout is not reproduced exactly.

For precise preservation of an existing complex package with only text-run changes, the earlier **Local Files** editor remains available under its existing limits. The new editor prioritizes authoring and editing a supported copy. Never treat the normalized export as a lossless round trip for arbitrary Word documents.

Limits: 24 MiB input DOCX; 64 MiB expanded ZIP; 2,048 package entries; 20,000 model nodes; 1 million text characters; at most 20 pictures (8 MiB and 24 megapixels each); tables up to 100 rows and 12 columns; 100 named point bookmarks; one contents block with a title of up to 100 characters. External image URLs are not fetched, macro packages are rejected, XML DTDs are rejected, hyperlinks are limited to HTTP(S)/mailto or validated internal bookmark names, and conversion routes use the app session guard. Document content is not sent to a model or included in conversion logs. Paste supports the editor's schema; use Insert → Pictures for image files.

## Implementation and validation

- `src/components/DocumentEditor.jsx` / `.css`: ribbon, editor, view, dialogs, recovery and export.
- `src/documentEditor.js`: editor schema, paragraph/page-break extensions, paste restrictions, search, counts and draft storage.
- `backend/services/document_editor.py`: validation and in-memory Python conversion.
- `backend/services/document_page_layout.py`: single-section header/footer variants, page field parsing/writing and pagination contract.
- `src/documentPageLayout.js`, `src/components/DocumentPageSettings.jsx`: page-settings model, dialogs and labeled samples.
- `src/documentTables.js`, `src/components/DocumentTableControls.jsx`: contextual table controls, selection, sizing and bounded editor transactions.
- `backend/services/document_tables.py`: table-grid validation, merged-cell conversion, widths, shading, borders and header properties.
- `src/documentStyles.js`, `src/components/DocumentStyleControls.jsx`: style catalog, effective formatting, preview rendering, commands, ribbon and pane.
- `backend/services/document_styles.py`: bounded named styles, supported inheritance resolution and native DOCX style definitions.
- `src/documentReferences.js`, `src/components/DocumentReferenceControls.jsx`: stable heading destinations, bookmark/link commands, live contents, reference dialogs and navigation.
- `backend/services/document_references.py`: reference validation, native anchors, linked contents snapshots and import normalization.
- `backend/routes/document_editor.py`: bounded import/export endpoints, registered in the existing authenticated app.
- `tests/backend/test_document_editor.py`, `tests/backend/test_document_page_layout.py`, `tests/frontend/documentEditor.test.js`, `tests/frontend/documentPageLayout.test.js`: conversion, page fields, model, safety, search and count checks.
- `tests/backend/test_document_tables.py`, `tests/frontend/documentTables.test.js`: merge/split behavior, repeated DOCX round trips, formatting, grid limits and invalid input handling.
- `tests/backend/test_document_styles.py`, `tests/frontend/documentStyles.test.js`: shared definitions, direct overrides, inherited source styles, heading semantics, repeated round trips, reset/delete/undo and input limits.
- `tests/backend/test_document_references.py`, `tests/frontend/documentReferences.test.js`: repeated reference round trips, contents regeneration, bookmark limits, unsafe-link rejection, missing destinations, duplicate paste, rename/delete/Undo, text offsets, contents placement and read-only navigation.
- `scripts/qa-document-editor.mjs`: isolated full application build; `--serve` builds and serves the editor fixture on loopback 5176.
- `scripts/qa_document_editor.py`: document-only test API on loopback 8016, isolated settings and a disposable test credential.

Browser acceptance covered authoring, heading navigation, tables, layout, keeping content across tab changes, recovery in a fresh session, find/replace and undo, exporting an actual DOCX and reopening it through the import notice. The downloaded file was inspected with Python for heading style, table contents, A4 dimensions and margins. Browser download event reporting timed out even though files were saved successfully; file inspection supplied the confirmation.

The app build is verified in a temporary output directory. The running desktop app and its live `dist` output are not replaced as part of this phase. Build/relaunch the app through its normal workflow to load the new workspace and backend route together.

Phase 4 verification: 148 related backend checks and 67 related frontend checks passed, along with an isolated full-app build. These cover document/page/table conversion, local files, the session guard, editor models and navigation. Browser checks covered range selection, merging and splitting with Undo, numeric column widths, dragging an edge, shading, border/alignment settings, repeated-header merge restrictions, deleting all selected columns with Undo, and blocked editing/resizing in read-only mode. An actual downloaded DOCX was independently inspected with Python, then reopened through the UI; its 2×2 merge, column widths, shading, border preset, alignment and repeating header survived, and import cleared undo history. The native custom-color dialog was not exercised by browser automation; the shading presets were verified. The build reports bundle-size warnings and a browser-compatibility warning from the separate model-viewer dependency.

Phase 5 verification: 161 related backend tests and 72 related frontend tests passed, along with an isolated full-app build. Browser acceptance covered creating/applying/modifying a custom style, shared updates across two paragraphs, direct bold/size overrides, Reset to style, style deletion with Undo, duplicate-name validation, recovery, read-only controls, custom line-spacing display and a Normal paragraph after Title. A real downloaded DOCX was inspected with Python and reopened in the editor: native Title/Subtitle/Callout/Normal definitions and paragraph references, Georgia 16 pt, bold, color, 0.15-inch indent, 18-point spacing and 1.4-line spacing survived. Import cleared prior undo history. No live desktop restart, Microsoft Word rendering or exact pagination was tested. The build retains bundle-size warnings and the separate model-viewer dependency's browser-compatibility warning.

Phase 6 verification: 189 related backend tests and 96 related frontend tests passed, along with an isolated full-app build. Browser acceptance covered live contents updates and level filtering, point bookmark creation, duplicate-name validation, automatic link updates on rename, deletion diagnostics, link selection for repair, Undo, contents removal/restoration, read-only controls/navigation and recovery. An actual downloaded DOCX was independently inspected with Python, then reopened through the UI: its bookmark, internal link, generated contents entries, title and level settings survived, and import cleared Undo history. Read-only navigation was also checked at 200% zoom with the destination outside the visible area. The running desktop and its live build were not replaced. Microsoft Word rendering, exact pagination and print output were not tested; the existing bundle-size and separate model-viewer dependency warnings remain.

Next bounded increment: footnotes/endnotes, or a separately chosen rendering engine for reliable paginated preview and printing. Citations, review tools, drawing and themes remain separate future phases.

References: [Tiptap TextStyle](https://tiptap.dev/docs/editor/extensions/marks/text-style), [Tiptap tables](https://tiptap.dev/docs/editor/extensions/nodes/table), [python-docx styles](https://python-docx.readthedocs.io/en/stable/user/styles-using.html), [python-docx cell merging](https://python-docx.readthedocs.io/en/latest/dev/analysis/features/table/cell-merge.html), [python-docx text API](https://python-docx.readthedocs.io/en/stable/api/text.html), [python-docx headers and footers](https://python-docx.readthedocs.io/en/latest/user/hdrftr.html), [python-docx pagination properties](https://python-docx.readthedocs.io/en/latest/user/text.html#pagination-properties).
