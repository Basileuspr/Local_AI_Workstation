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
  Before parsing, compressed packages are limited to 2,000 members, 64 MiB of
  expanded data and 32 MiB per member. Duplicate, unsafe and encrypted package
  entries are rejected. Other binary formats contribute filesystem metadata only.

**Include subfolders** is optional. Dependency/tooling folders, credential files,
links/junctions, offline cloud placeholders and this tool's report storage are
excluded and recorded. Source files are never edited, moved or deleted. Changed
files and read failures are reported rather than silently treated as reviewed.
Each readable file must still match its inventoried identity, size and modification
time before opening, and its handle/path are checked again after reading.

The initial limits are 2,000 discovered entries, 16 MiB per readable file,
200,000 readable characters per file, and 4,000 characters per source batch.
PDF inspection stops at 500 pages. Change limits before starting. Reaching a
limit leaves an explicitly incomplete inventory or partial analysis. A local
model's context is checked before inference. Source batches and combined findings
are automatically split further when the serialized prompt, review instructions
and reserved output do not fit. This includes Unicode and escaped source text;
the configured batch size remains an upper limit. Each source slice is included
once, including the file's tail. Models with too little context for the review
instructions, or responses that reach the output limit, stop with an explicit
error and retain completed findings.

Batch findings are compacted at successive levels into per-file analyses and a
folder overview. The full report retains the per-file results and coverage. The
workspace and saved report show the model context, completed/total text batches,
compaction passes, memory preparation checks and any provider retries. Each
completed source batch is saved with its source hash and line references before
later compaction. Failed compaction does not discard those saved batch findings.

Transport failures and temporary provider HTTP errors receive one retry using
the same model and full request, within a ten-minute response deadline. Invalid,
empty, unfinished and oversized responses remain explicit failures; they are
never accepted as complete findings. Streams have byte, line and text bounds.

Inference and compaction use the shared Prompt Queue. After admission, the review
parks the image runtime on CPU (or unloads it if RAM is low) and unloads other
Ollama models before preparing the selected text model. That model stays loaded
between review batches to avoid reloading it for each slice. After the final
overview, the review explicitly unloads its model and verifies the release with
Ollama before giving up queue ownership. Failed or stopped inference also cleans
up while holding admission. If a stop happens between batches and another job
already owns the queue, cleanup is deferred to Ollama's configured idle timeout;
the workspace reports that state rather than interrupting the other job.

Choose **Inventory and text extraction only** for a report without inference.
This records structure/metadata and short text excerpts, not model conclusions.
The configured Ollama service receives only the readable text used for model
analysis. Model summaries are interpretations, not verification of code behavior.

Progress and paginated per-file findings stay available when switching tabs or
refreshing the UI. **Stop review** retains completed file and source-batch findings;
an unfinished file is labeled incomplete and may need to be reviewed again.
Cancellation closes a provider that is still preparing its model before releasing
queue ownership, and joins CPU readers before admitting a new review.
A desktop/backend restart marks unfinished work interrupted and reconstructs a
report from saved findings; it does not silently restart inference. Report-write
failures also leave findings available for recovery/export. Invalid saved metadata
or statistics are flagged without discarding other results. New reviews read
current files rather than assuming previous hashes still describe them.

Use **Saved review**, **Show full report**, **Copy report**, or **Download Markdown
report** to inspect/export results. Reports live privately under app data in
`folder_review/reviews.sqlite3`; they can contain information from the selected
folder. App backup/reset includes this data. Maintenance waits for reviews to
finish or be stopped. GitHub publication excludes these runtime reports.
