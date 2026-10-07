# Storage, backup and reset

Combined reference for related controls. Verification results below retain their original scope and dates.


<a id="drive-folder-sizes"></a>

## Drive folder sizes

Dashboard → Drive space → **Folder sizes**, next to **Open drive**, starts a read-only scan of that drive's immediate folders and their descendants. The dialog shows a segmented share bar and a largest-to-smallest list with byte sizes and percentages. Files directly in the drive root appear separately. Small sizes use B/KiB/MiB; larger sizes use GiB/TiB.

The worker reads directory entries and file metadata only. It does not open file contents, elevate permissions, delete, or modify scanned files. It runs independently of the backend and model workloads. Scanning is on demand, never part of the five-second Dashboard telemetry refresh. Only one scan runs at a time. The dialog updates while scanning; Cancel, closing the dialog, or quitting the desktop stops the worker. Results remain in memory for reopening and are refreshed with Rescan.

Totals are unique logical file bytes, not allocated disk space. Hardlinks are counted once under the first location scanned, with subsequent references flagged in their rows. Symbolic links, junctions, and other Windows reparse points (including cloud placeholders) are skipped. Unreadable/disappearing items are counted and affected rows marked incomplete. A canceled scan keeps its partial results. These boundaries, compressed/sparse files, filesystem overhead, and concurrent changes mean totals need not match Windows' used-space reading. Percentages refer to scanned bytes only.

The desktop exposes guarded `dashboard:scan-drive`, `dashboard:drive-scan-status`, and `dashboard:cancel-drive-scan` IPC handlers. The renderer can choose a drive root such as `C:\`, not an arbitrary path or shell command. The Python worker independently validates local fixed/removable/RAM drive roots; network paths and mapped network drives are not scanned. No HTTP disk-scanning endpoint is added.

Verification uses temporary filesystem fixtures for recursive totals, root files, hardlinks, skipped reparse points, access errors, cancellation, and unchanged file metadata. Desktop controller tests cover root validation, partial stdout, worker termination, and failures. UI previews use synthetic results rather than scanning personal drives.

Fully quit the desktop from its tray and reopen after updating, so the new main process and preload APIs are available.

<a id="app-data-controls"></a>

## Dashboard app data controls

Fully quit the desktop app from its tray and reopen it after updating; these controls require the new Electron main process, preload, and frontend.

Dashboard exposes four independent actions:

- **SAVE METADATA** saves aggregate counts and byte totals by storage category, a timestamp, and basic numeric backend configuration. It excludes private content, filenames, paths, buttons, media, and model artifacts. This lightweight inventory cannot restore deleted data. Saving it never opens or authorizes a reset.
- **RESET APP DATA & SANITIZE APPLICATION** opens a separate review and requires typing `RESET`. No export is required or automatically created. It clears the configured app data directory, including chats, blobs, generated images, all collections (including Hidden and Locked), workflows, face datasets/bank, character datasets, LoRA projects/adapters/training packages, memories, Index data, knowledge base, app-data logs, web data, trash, and recovery copies. It also clears desktop local/session storage, legacy-origin preferences, browser storage and HTTP cache. Custom profiles, prompt phrase buttons, and image tags are removed. Installed application code and base models remain.
- **EXPORT BACK-UP** creates a private content backup with all files under app data (except the ephemeral backend lock), plus current desktop localStorage. It includes media, locked images, databases and their sidecars, LoRA artifacts, and personal settings/buttons. `manifest.json` records per-file SHA-256 hashes and byte lengths; `RESTORE.txt` explains manual recovery into an empty data directory and restoring desktop preferences. Use **IMPORT BACK-UP** for automatic restoration. Required base models must be installed separately. Application code/dependencies, external originals/exports/logs, browser cache, and unsaved in-memory edits are excluded. The separate Media Manager application's external data is outside this scope.

- **IMPORT BACK-UP** opens a native ZIP picker and accepts `local-workstation-backup-v1` archives produced by EXPORT BACK-UP, including archives created before the import button existed. It validates the manifest, file lengths, SHA-256 hashes, path safety, and desktop preference structure before showing the archive date/count/size. Metadata inventories, unsupported formats, missing/unlisted entries, duplicate/case-colliding paths, links, special files, and unsafe Windows paths are rejected. Type `IMPORT` to replace current app data and preferences; imports do not merge records.

Import rechecks the selected archive against the reviewed digest after stopping the idle owned backend. It stages and hashes files in a new sibling directory and checks available disk space before replacing data. Previous app data and desktop preferences are retained in a private `.law-import-<data-folder>-before-*` recovery folder beside app data. This folder is intentionally outside reset scope and ignored by Git; the completion notice shows its location. Installed models, app code, and external files remain unchanged.

A durable sibling journal blocks backend startup during replacement and preference restoration. Directory-swap or preference failures trigger rollback of both data and preferences. If the app closes or recovery fails, Dashboard offers **Recover previous data**, which can resume rollback on the next launch. The backend stays stopped until the journal is resolved. If installation completes but the restored backend cannot start, the error identifies the retained recovery folder; the imported data and the previous recovery copy both remain available. The recovery folder is retained until you decide to remove it.

Both export dialogs require a new ZIP filename outside app data and never overwrite existing files. Backup streams files (including large artifacts), flushes the archive to disk, reads every archived data/preference file back to verify hashes, and rejects detected source changes. A failed backup removes only the incomplete archive created by that attempt. Existing app data is not deleted.

Before backup, import, or reset, save edits, finish or cancel queued/running work, and close other clients connected to the backend. The desktop blocks new requests, waits for in-flight requests, refuses active jobs, then stops its owned backend. A separately launched/reused backend must be closed and the desktop reopened first. During backup, desktop interaction is disabled, then restored after the backend restarts, including after export errors. A backend restart failure is reported separately from the archive result.

Reset validates its configured root and targets, refuses symbolic links/junctions, and will not operate on a drive, home, project, or installed-model directory. An interruption leaves `.reset-in-progress.json` in place and prevents normal backend startup. The marker remains until desktop storage/cache cleanup also succeeds. Retry the reset from Dashboard to finish; reset no longer preserves any custom buttons.

External original files, exports, backups, external log directories, application source/Git history, and operating-system history are outside reset. This sanitizes application storage, not forensic disk erasure. The app recreates empty operational data and logs when restarted.

### Upload chooser

All image-capable file inputs use the desktop chooser: Chat's two upload entry points, Image Review, Image Workflows, and LoRA training. Each invocation explicitly starts at the home directory and uses Windows `dontAddToRecent`; the previous selection is never stored as the next starting folder. Multi-selection and the existing upload validation remain. A chooser batch is limited to 100 files / 512 MiB and 100 MiB per file; individual features retain their stricter limits. Browser-only sessions use the browser's normal chooser because websites cannot control its starting directory.

### Verification

- `tests/backend/test_maintenance.py`: metadata privacy, backup content/hash round trips, failed archive cleanup, protected targets, confirmation, complete sanitation, interrupted-reset recovery, and request admission.
- `tests/frontend/desktopMaintenance.test.js`: native picker options and independent metadata/reset/backup lifecycles, including refusal, cancellation, failure, backend restart ordering, safe preference restoration, and import rollback.
- `tests/backend/test_backup_import.py`: export/import round trips, archive validation, disk-space refusal, directory-swap failure recovery, protected journal paths, and blocked startup during import.
- Temporary Electron QA uses its own data directory, profile, port, and synthetic media. Never run reset tests against live user data.
