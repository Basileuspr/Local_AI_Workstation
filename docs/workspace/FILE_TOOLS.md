# Local Files and Folder Review

Long file-tool pages keep their primary actions and result filters in scrolling
control groups. Packager exposes Create ZIP and Save ZIP above its file list;
local documents keep Save/Save As available, and database results retain filtering,
pagination and exports. In short or split panes, scroll within the group or use Tab
to reach its remaining controls. Existing file-selection and save rules still apply.

Use Local Files to open supported files deliberately. Opening a file does not
automatically send it to a model. Folder Review prepares inventories and reviewed
actions; it is not an automatic organizer.

## Upload and import sizes

Owner-selected files have no application-imposed upload byte, pixel, total-byte
or file-count ceiling. The native chooser and multipart parser follow the same
policy as the browser controls. Disk spooling, transfer chunks, preview sizes,
cache eviction and sequential processing manage working memory without rejecting
the rest of a selection.

| Intake | Behavior |
|---|---|
| Chat images and documents / Knowledge | Images stream to content-addressed storage; chat JSON holds references. Document parsing keeps the extracted input; model context is budgeted separately. |
| Image Review, Generate references, workflows and scenes | No generic image-byte, pixel or saved-asset-count ceiling. Originals remain intact. |
| Faces, character parts and profile resources | All selected inputs are accepted for validation; large selections continue in automatic batches. |
| Audio transcription, voice references and audio extraction | No application upload-byte or source-duration ceiling. Transcription continues in overlapping chunks; extraction remains cancellable. |
| CSV, code viewers, designs, Word files, Canvas and 3D projects | No generic file-byte ceiling. CSV row/column, document picture/element, table row/column and project geometry quotas are removed. Supported structures still require validation. |
| File Packager | Streams every selected entry to a ZIP64-capable archive without a total-byte, entry-count or folder-depth quota. |
| Native bookmark and application-backup imports | No manifest, library-byte or item-count quota. Existing path, checksum, duplicate-entry and restore validation remains required. |
| Media Manager image-folder intake | No source image-count or pixel ceiling. Its output operations retain their own format/settings requirements. |

Supported formats, archive integrity, source ownership and locked-media access
still apply. Actual disk space, available memory, codec capabilities, browser
representation and model context can determine whether processing succeeds; an
accepted original is not proof that a decoder or model can process it. Output
settings and unrelated generation/analysis budgets are separate from upload
acceptance.

## Existing Word files

The Local Files DOCX editor makes bounded text/run changes while preserving
supported existing package parts. Save a validated copy, preferably **Save As**,
then inspect it in Word. Editing can invalidate digital signatures; preserving
parts is not a promise of exact rendering or universal Word feature support.

Use [Document Editor](DOCUMENT_EDITOR.md) for creating and visually editing the
supported document model. Its import/export rebuilds a document and has different
preservation limits.

## SQLite inspection

SQLite viewing works from a private copy of the database and available WAL.
Copying files is not a transactional snapshot; close
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
Decoded previews are bounded; source file bytes have no application ceiling.

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

Coverage and source hashes remain in the full report. Discovery, file bytes and
readable characters default to **0 = all**, with no forced upper ceiling. PDF
extraction visits every page. Model requests use 4,000-character working batches
by default. Optional user-selected coverage limits, changed files, read errors and failed
model/compaction responses leave explicit incomplete results.

Model inference uses the shared queue and actual context budget. Completed source
batches are saved before later compaction. Stop retains completed findings, and
progress remains available across tab changes/refresh. Inspect incomplete files
before rerunning. Model summaries are interpretations, not verification of code
behavior. No source instruction is executed as a command.

[Storage and backup](STORAGE_AND_BACKUP.md) · [Functions](FUNCTIONS.md)
