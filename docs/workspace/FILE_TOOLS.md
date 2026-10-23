# Local Files and Folder Review

Long file-tool pages keep their primary actions and result filters in scrolling
control groups. Packager exposes Create ZIP and Save ZIP above its file list;
local documents keep Save/Save As available, and database results retain filtering,
pagination and exports. In short or split panes, scroll within the group or use Tab
to reach its remaining controls. Existing file-selection and save rules still apply.

Use Local Files to open supported files deliberately. Opening a file does not
automatically send it to a model. Folder Review prepares inventories and reviewed
actions; it is not an automatic organizer.

## Existing Word files

The Local Files DOCX editor makes bounded text/run changes while preserving
supported existing package parts. Save a validated copy, preferably **Save As**,
then inspect it in Word. Editing can invalidate digital signatures; preserving
parts is not a promise of exact rendering or universal Word feature support.

Use [Document Editor](DOCUMENT_EDITOR.md) for creating and visually editing the
supported document model. Its import/export rebuilds a document and has different
preservation limits.

## SQLite inspection

SQLite viewing works from a private copy of the database and available WAL,
within an 8-GiB input bound. Copying files is not a transactional snapshot; close
the writer or use a proper database backup when consistency matters.

Queries are read-only SELECT/WITH operations under an authorizer. Mutations,
extensions and arbitrary filesystem access are denied. Results are bounded by
time, VM work, rows, columns and bytes; a truncated result is not the entire table.
The source database is not opened for editing.

## Video inspection

Choose a local video to create a temporary inspection session. Open does not
start AI analysis. Select an installed vision model and request sampled-frame
analysis explicitly; optional transcription uses the installed speech runtime.

Quick, Balanced and Detailed settings sample progressively more frames and
vision moments, with actual timestamps. Even Detailed is bounded to 120 sampled
frames and 12 vision moments; it is not continuous motion understanding.
Decoded previews are bounded, and selected files can be up to 8 GiB.

Temporary sessions expire and are cleaned up by the supported lifecycle. A crash
can leave temporary files for later cleanup. Original media remains unchanged.
Use [Media Manager](../media/MEDIA_MANAGER.md) for its separate catalog/workflows.

## Folder Review

Choose a folder and a local text model, then Start Folder Review. Optional
subfolder traversal excludes dependency/tooling folders, credentials, links,
cloud placeholders and the tool's report storage. Source files are never edited,
moved or deleted. Inventory and text extraction only runs without inference.

Readable source/text is reviewed in contiguous batches, then combined into file
analyses and a folder overview. Python is inspected statically, never executed.
PDF support extracts native text, not OCR or rendered images. DOCX contributes
paragraph/table text; images and other binaries contribute metadata only.
Images are never sent to the model by this workflow.

Coverage and source hashes remain in the full report. Default bounds include
2,000 discovered entries, 16 MiB per readable file, 200,000 readable characters
per file and 4,000 characters per batch; PDF extraction stops at 500 pages.
Configure limits before starting. Limits, changed files, read errors and failed
model/compaction responses leave explicit incomplete results.

Model inference uses the shared queue and actual context budget. Completed source
batches are saved before later compaction. Stop retains completed findings, and
progress remains available across tab changes/refresh. Inspect incomplete files
before rerunning. Model summaries are interpretations, not verification of code
behavior. No source instruction is executed as a command.

[Storage and backup](STORAGE_AND_BACKUP.md) · [Functions](FUNCTIONS.md)
