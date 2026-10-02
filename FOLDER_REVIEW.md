# Folder Review

Open **Workspace → Folder Review**, browse to a local folder or paste its path,
choose a local text model, then **Start Folder Review**. It is also an available
destination for a custom Functions button. Use **Info** for the workspace guide.

The folder is inventoried and reviewed one file at a time. Large readable files
are split into contiguous text batches, each is summarized, and their findings
are combined into a per-file analysis. Those analyses are then combined into a
folder overview. The full report retains each file's findings, types/extensions,
metadata, source hash and coverage; a concise overview cannot preserve every
detail. File content is data, never a command to run or a tool instruction.

- Python: static source review, including available imports, classes, functions
  and their line numbers. No Python code is executed or imported from the folder.
- Text, Markdown, JSON and supported source/configuration formats: content
  summaries from decoded UTF-8 or BOM-marked UTF-16 text. Line endings are
  normalized for review; the hash identifies the original bytes.
- PDF: extractable native text only, with page markers. Scanned/image-only pages,
  page extraction errors and text/page limits are listed. No OCR, page rendering
  or image interpretation is attempted. Existing OCR text layers are readable.
- Images: filesystem/header metadata only, including size, modification time,
  SHA-256, dimensions, format and available header EXIF fields. Late PNG metadata
  is not collected by decoding pixels. SVG contributes dimensions from its root
  header; embedded SVG text is not analyzed. Images are never sent to a model.
- DOCX: extracted paragraphs and table text; embedded images are not analyzed.
  Other binary formats contribute filesystem metadata only.

**Include subfolders** is optional. Dependency/tooling folders, credential files,
links/junctions, offline cloud placeholders and this tool's report storage are
excluded and recorded. Source files are never edited, moved or deleted. Changed
files and read failures are reported rather than silently treated as reviewed.

The initial limits are 2,000 discovered entries, 16 MiB per readable file,
200,000 readable characters per file, and 4,000 characters per source batch.
PDF inspection stops at 500 pages. Change limits before starting. Reaching a
limit leaves an explicitly incomplete inventory or partial analysis. A local
model's context and output limits can also stop analysis; completed findings
remain available, and a smaller text batch can help.

Choose **Inventory and text extraction only** for a report without inference.
This records structure/metadata and short text excerpts, not model conclusions.
The configured Ollama service receives only the readable text used for model
analysis. Model summaries are interpretations, not verification of code behavior.

Progress and paginated per-file findings stay available when switching tabs or
refreshing the UI. **Stop review** retains completed per-file findings; an
unfinished file may need to be reviewed again. A desktop/backend restart marks
unfinished work interrupted; it does not silently restart inference. New reviews
read current files rather than assuming previous hashes still describe them.

Use **Saved review**, **Show full report**, **Copy report**, or **Download Markdown
report** to inspect/export results. Reports live privately under app data in
`folder_review/reviews.sqlite3`; they can contain information from the selected
folder. App backup/reset includes this data. Maintenance waits for reviews to
finish or be stopped. GitHub publication excludes these runtime reports.
