# Document Editor

Document Editor creates, imports and exports a supported Word document model.
It uses the local visual editor and Python DOCX conversion; Word automation and
a chat model are not required.

## Start and save

Create a document or open a DOCX, edit it, then export/download a DOCX copy.
Export again after later changes. Browser recovery stores the current draft in
IndexedDB, including supported images; it is recovery state, not a saved Word file.

Import rebuilds supported content. It does not preserve an arbitrary original
DOCX ZIP package. Read conversion notices and inspect important exports in Word.
For bounded text edits that preserve more existing package parts, use
[Local Files](FILE_TOOLS.md#existing-word-files).

## Supported editing

The ribbon includes text/font formatting, paragraphs, named styles, page layout,
lists, tables with supported merges/widths, inline pictures, hyperlinks, headings,
bookmarks, a contents list, notes, captions, cross-references, citations and a
bibliography. Style reset preserves hyperlinks; imported/resolved formatting is
not a complete live Word style-inheritance system.

DOCX input, package expansion, ZIP-entry counts and embedded pictures have no
application byte or pixel ceiling. Table rows/columns, paragraph-style counts,
source/citation counts and document element/text quotas are removed. Structure,
duplicate ZIP entries, embedded image formats and unsupported active content
still undergo validation. See [upload and import sizes](FILE_TOOLS.md#upload-and-import-sizes).

## References and numbering

- **Contents:** a linked heading snapshot regenerated in this editor, without
  page numbers or a live Word TOC field.
- **Captions:** independent blocks with supported sequence numbering. Moving an
  image/table does not automatically move its caption.
- **Cross-references:** supported native fields with cached visible text. Missing
  targets show placeholders. Other editors may not automatically refresh fields.
- **Notes:** supported rich text exported to native Word footnote/endnote parts.
  Nested notes, tables/images inside notes and advanced section numbering are
  outside the supported model.
- **Citations:** local source records, basic APA/numbered formatting and a
  bibliography snapshot. The editor does not fetch metadata or implement every
  citation-style rule.

Inspect numbering and references after structural edits. The editor’s continuous
canvas places notes below the body rather than at a physical page bottom.

## Layout and import limits

Word performs final pagination. PAGE/NUMPAGES placeholders do not establish cached
page counts in this editor. There is no built-in print/PDF layout engine.

Complex sections, comments, tracked changes, content controls, floating objects,
macros, advanced styles and rich headers/footers are not fully editable or can be
omitted during import. Floating pictures can become inline/between-paragraph
content. Shapes, mail merge and tables of figures are outside the supported
workflow. Original unsupported package parts are not silently copied into a new
export as if they were editable content.

Keep the original when importing a complex document, review conversion notices,
and compare the exported copy in the application where it will be used.

[Chat-created DOCX](../chat/CHAT_GUIDE.md#create-a-word-document) ·
[Workspace](WORKSPACE_GUIDE.md) · [Storage](STORAGE_AND_BACKUP.md)
