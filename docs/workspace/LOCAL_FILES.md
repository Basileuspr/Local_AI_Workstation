# Local Files implementation and validation

The **Local Files** workspace opens DOCX, SQLite and video files through a shared registry. STL/3MF reuse the existing 3D Viewer. Restart the desktop app after building so both Electron's new native bridge and the Python routes are loaded. Files reopen manually.

## 1. Existing architecture inspected

The desktop already owns trusted native dialogs (`electron/filePicker.js`), its preload bridge and per-launch authenticated loopback API. Chat uploads buffer bounded files; Knowledge imports/indexing and generated chat DOCX artifacts serve different purposes from editing originals. Existing conversion, packaging, audio extraction, transcription and visual classification services run in Python. The request queue coordinates CPU lanes, cancellation and GPU admission. The 3D Viewer already uses a bounded worker and explicit graphics cleanup.

This implementation extends the native file-dialog module for path grants without buffering entire databases or videos in JavaScript. It reuses the authenticated API, thread pool, request queue, PyAV audio extraction, Whisper transcription, vision discovery/classification and 3D component. Opening files does not index them, attach them to chat, or call models.

## 2. Files created or modified

- Backend services: `backend/services/file_handlers.py`, `local_files.py`, `local_documents.py`, `local_database.py`, `local_video.py`, `video_analysis.py`.
- API: `backend/routes/local_files.py`; route registration in `backend/main.py`.
- Native bridge: `electron/localFiles.js`; extensions to `filePicker.js`, `main.js`, `preload.js`, `appShutdown.js` and `tabCapture.js`.
- UI: `src/localFiles.js`, `src/components/LocalFiles.jsx`, `LocalFiles.css`, `LocalDocument.jsx`, `LocalDatabase.jsx`, `LocalVideo.jsx`; optional incoming-file support in `ModelViewer.jsx`.
- Registration: `src/App.jsx`, `navigation.js`, `navigationOrder.js`, `workspaceHelp.js`, `queueNavigation.js` and display labels in `src/components/PromptQueue.jsx`.
- Tests: `tests/backend/test_local_files.py`, `tests/frontend/localFiles.test.js`, `tests/fixtures/localFiles.html`, `localFiles.jsx`, `localFiles_backend.py`; `scripts/build-local-files-qa.mjs`, `scripts/qa-local-files.cjs`.
- This document. The ordinary production build also refreshes the existing application-review build inventory.

## 3. DOCX editing

Import produces paragraph/run/table model data with stable run IDs, text, direct bold/italic flags and paragraph style names. The UI edits existing text runs and simple table cells, including blank cells. Heading styles are recognized by their stored style names. Export validates edits against the imported run map; arbitrary XML cannot be submitted by the renderer.

The Python exporter changes `word/document.xml` only. Other package members retain identical uncompressed contents. Saving writes a sibling temporary package, validates its ZIP members and document XML, flushes it, checks the destination fingerprint again, then uses `os.replace`. Save asks for confirmation; Save As uses the native save dialog. A changed destination is refused rather than overwriting external edits. Read-only/locked destinations leave the original intact and report a usable error. Unsaved edits survive tab switches; closing the file, opening another, or exiting/restarting the desktop requires discarding or saving them. Reload is vetoed by the document's unload guard.

## 4. DOCX preservation limits

This is a text/run editor, not a Word layout renderer. It does not add/reorder document blocks, create tables, or edit style definitions. The UI does not fully resolve inherited formatting. Existing page/section layout and unsupported structures are retained; there is a mandatory preservation acknowledgement before saving.

Tracked changes, fields, hyperlinks, drawings, controls and unsupported run children are protected. Merged/nested tables are read-only. Headers/footers, comments, macros and embedded parts are preserved but not rendered or executed. Protected content may be shown as a placeholder or omitted from editing controls. Editing text near a field/comment can make its existing meaning stale; Word-specific fidelity is not guaranteed. Use Save As and inspect important documents in Word/LibreOffice. Digital signatures are not regenerated and may become invalid after any document edit.

## 5. Database reader

SQLite is recognized by its file header, not just `.db`. Other formats produce “format not recognized,” not an automatic corruption claim. Table/view inventory includes declared types, primary-key positions and schema SQL. Preview supports literal substring search, 100-row pages, optional bounded count and SELECT/WITH queries. Exports contain the current page or selected rows as CSV/JSON; CSV formula prefixes are escaped. BLOBs are represented by size rather than materialized as binary content.

Results expose `database`, `table`, `columns`, nullable `row_count`, `rows`, pagination and coverage notes. Counting is explicit; the result stays unknown when not counted. No results enter model context automatically.

## 6. Read-only enforcement

The source and any WAL are copied in chunks into an owned temporary session folder. The source database is never opened through SQLite. Source sizes/modification times must remain stable during copying; active recovery journals are refused. This is a best-effort stable-file snapshot, not a transactional backup of an actively changing database. Close the writer before inspecting data that needs a consistent view.

Only the private snapshot is opened with SQLite URI `mode=ro`, `query_only=ON`, `trusted_schema=OFF` and extension loading disabled. SQL must start with SELECT or WITH, is executed as a single bounded subquery, and passes a SQLite authorizer that rejects mutation, attachment, PRAGMA actions and unsafe functions. Limits bound SQL size, value size, columns, response size and query work. A progress handler interrupts costly reads/counts. Every connection closes after its operation. SQLite can require writable WAL shared-memory sidecars even for some read-only opens; copying isolates those effects from the original ([SQLite WAL documentation](https://www.sqlite.org/wal.html#read_only_databases), [Python SQLite authorization/progress APIs](https://docs.python.org/3/library/sqlite3.html)).

## 7. Video pipeline

Opening probes duration, resolution, FPS, video codec, container and audio streams, then attempts one thumbnail. Explicit operations are Metadata, Frames, Extract audio, Transcript, Vision and Full. The local player supports codecs available in Electron; PyAV can inspect some containers the player cannot play. Frame and transcript timestamps seek the player. Full analysis retains successful frame results and reports unavailable/failed transcription or vision stages as warnings.

Only accepted local file handles are passed to restricted demuxers. Playlists and external media URLs are not followed. There is no frame list buffered for the entire video. Decoders/file handles close through context managers; media decoding uses two threads.

## 8. Sampling

Quick Scan samples up to 12 frames and describes 3 moments, Balanced 36/6, Detailed 120/12 and Custom 120/12. Each analysis also makes one summary call. Analyze video is the default action and automatically samples across the clip unless the user explicitly selects existing frames. Opening a file alone never invokes AI. Custom intervals range from 0.1 to 3,600 seconds; the effective interval increases as necessary to honor the frame cap and is displayed. Samples are sought across the duration and use actual decoded timestamps. Keyframes only is available for frame extraction and selects nearby decoder keyframes, not semantic scene changes. A clip with a long GOP can contain only one such frame; the extraction result explains this. AI analysis always uses timed sampling when resampling, even if an older client submits the keyframe flag. Vision subsamples selected frames evenly across their range. Sampling can miss events; no precision or exhaustive-coverage claim is made.

## 9. Transcription and vision

Audio extraction uses the existing audio-extraction service and produces an M4A working file. Explicit Extract audio retains it for download until close; transcription removes it after use. Whisper reuses installed base/small/turbo models, chunking and the existing bounded CPU model cache. No model is downloaded automatically. Stop waits for an already-running Whisper call because the existing synchronous service has no per-call cancellation hook.

Vision uses existing installed-model discovery, the same Ollama model route, GPU request queue and runtime handoff. The video-specific adapter describes subjects, objects, positions, visible activity and readable text at each sampled timestamp, then compares these observations and writes an overall summary. An optional focus question guides the analysis. Analyze video + speech includes the available transcript excerpt in the summary. Output explicitly remains sampled evidence, not continuous motion understanding. Operation, workload, model and Analyze video controls appear above the player. Opening a new file starts at the top, and analysis completion preserves the scroll position. The report appears above the frame gallery. The opening thumbnail is explicitly labeled as a preview. Missing models, empty/truncated responses, cancellation and partial failures are reported. Requests are cancellable even before the first response token; model unload is requested before releasing GPU admission.

## 10. File-handler registry

`GET /local-files/handlers` declares each handler's extensions, MIME types, detection strategy, capabilities and runtime availability. Document, database, video and existing 3D handlers are registered independently. The frontend maps handler IDs to components. Future coordinators can discover capabilities without encoding extension rules themselves. Separate capability discovery reports installed speech and vision models.

## 11. Dependencies

No new packages or downloads were added. XML manipulation uses `lxml`, already installed through required `python-docx`; SQLite uses Python's standard library. Video uses PyAV from the existing optional audio runtime (`requirements-audio.txt` / faster-whisper). Missing media/runtime/model support is reported explicitly.

## 12. Resource and performance protections

- Up to four ephemeral sessions; explicit Close removes snapshots, thumbnails and extracted audio. Graceful process exit cleans idle sessions.
- DOCX: 64 MiB compressed, 128 MiB expanded, 16 MiB document XML, 4,096 members, 2,000 blocks/cells and 10,000 runs. Duplicate/unsafe archive names, encrypted containers, DTDs and malformed XML are rejected.
- SQLite snapshot: up to 8 GiB including WAL; chunked copying. Queries: up to 200 rows, 2 MiB result pages, 1 MiB individual values, 256 columns, five seconds or 20 million VM instructions. Schema inspection is time-bounded. UI defaults to 100 rows.
- Video: up to 8 GiB input, 24-hour sampling duration, 34-megapixel decoded frames, 120 retained samples at at most 1280×720 and a three-minute sampling limit. Audio/transcription retain the existing two-hour/250-MB output limits.
- Expensive calls run in the existing thread pool; video jobs appear in the existing queue with a serialized CPU lane and separate GPU admission for vision. File locks prevent closing a session while its worker owns it. Stop/disconnect requests propagate cancellation, and threads finish before resource ownership is released.
- Switching away pauses video playback. Leaving a 3D view disposes graphics; reopening is manual. Document state stays in memory across tab switches to preserve edits.
- An OS crash or forced process kill can leave a temporary session folder in the system temp directory. Normal close/exit cleans it; source documents/media/databases are not deleted.

## 13. Validation and unsupported features

Automated backend tests cover text/headings/direct formatting/tables, Save/Save As/reopen, preserved package parts and tracked content, read-only/locked/conflicting/failed saves, invalid ZIP/XML/DTD/path traversal; a 100,050-row SQLite fixture, views/schema/filter/pagination/count, invalid/mutating/expensive SQL, WAL contents and unchanged original sidecars, active journals and unrecognized/corrupt files; short MP4/MKV/MOV, audio/no-audio, multiple resolutions, 20-minute synthetic media, keyframes, Quick/Detailed/Custom, cancellation, partial-stage failures, adapters and ten repeated open/close cycles.

Native Electron QA uses production React components, native bridge logic with deterministic test-dialog selections, the real authenticated Python routes and synthetic files. It verifies DOCX edit/dirty/Save As, SQLite pagination and mutation errors, video thumbnail/sampling, decoded seek, screenshots, no renderer console errors and temporary-session cleanup. It is not a manual Windows file-dialog acceptance test.

A real installed Whisper-base CPU call processed a two-second synthetic silent MP4's extracted audio successfully (no transcript segments). This validates the local pipeline, not speech accuracy. On the follow-up fix, an idle-GPU acceptance run used the real installed `qwen3-vl:8b` model through the production video API on a synthetic three-second MP4. It produced three descriptive observations at 0, 1.5 and 2.8 seconds and a summary correctly distinguishing a red circle at left, center and right, including the visible labels. This demonstrates real content analysis, not accuracy on arbitrary videos. Run `venv\Scripts\python.exe scripts/qa-video-analysis.py` on an idle GPU to reproduce it. Additional tests cover first-token cancellation, empty/truncated streams, automatic whole-video sampling, stale frame selections after resampling, and inert rendering of model text. A long-GOP regression confirms keyframe extraction yields one frame while AI analysis still receives multiple timed samples. Native QA separately verifies report presentation with controlled model responses, visible controls in the production workspace containers at 1200 x 800 and 1000 x 650, and preserved scroll position on completion. Continuous VRAM/RAM soak testing and Word visual fidelity remain manual follow-ups.

Unsupported: legacy `.doc`, `.docm` selection, document layout/structural authoring, editable databases or non-SQLite formats, external media playlists/URLs, continuous video event detection, automatic context ingestion and codecs unavailable in the installed runtimes. Encrypted SQLite databases are unrecognized; encrypted DOCX packages are unsupported.

## 14. Short manual test

1. Restart the desktop app and select **Local Files → Open local file**. Open a disposable DOCX with a heading and table. Change text and bold/italic, acknowledge limits, Save As, then reopen the copy in Word/LibreOffice. Verify the original and protected content. Make another edit and try to close/exit; cancel discarding.
2. Open a disposable SQLite `.db`. Preview a table, change pages, filter, inspect a view, run SELECT, request a count and export selected rows. Try `DROP TABLE` and verify rejection. Reopen the source in its owning application and confirm it is unchanged.
3. Open MP4/MKV/MOV. Check metadata/thumbnail, run Quick and Detailed frames, then Custom/keyframes. Click timestamps and verify seeking. Try no-audio and corrupt files; recover by opening a valid file.
4. Explicitly extract audio, save it if wanted, then run Transcript with an installed model. Choose an installed vision model, optionally enter an analysis focus, click Analyze video and inspect the overall summary and timestamped descriptions. No separate extraction step is required. Choose Analyze video + speech to include a transcript. Stop a longer operation, wait for the worker, then close.
5. Repeat open/close, verify temporary results disappear, and monitor RAM/VRAM across sustained use.

Reproducible automated commands: `venv\Scripts\python.exe -m pytest tests/backend/test_local_files.py -q`, `npm test`, `node scripts/build-local-files-qa.mjs`, `node_modules\.bin\electron.cmd scripts/qa-local-files.cjs` (unset `ELECTRON_RUN_AS_NODE`), and `npm run build`.
