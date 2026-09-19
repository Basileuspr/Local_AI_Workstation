# Dashboard inventory and app reset

Fully quit the desktop app from its tray and reopen it after updating; these controls require the new Electron main process, preload, and backend.

Dashboard → **Save metadata ZIP & review reset** opens a save dialog. Choose a new ZIP filename outside the app data directory. The ZIP contains aggregate file counts and byte totals by storage category, an export timestamp, and numeric backend configuration. It never includes chat text, prompts, images, file names/paths, user-created buttons, model weights, or training artifacts. It is an inventory and cannot restore deleted content.

After the ZIP is saved, flushed, and verified, a modal offers **Keep app data** or permanent reset. Reset requires typing `RESET`. It rechecks the saved ZIP, blocks new requests, waits for in-flight requests, refuses queued/running jobs, and closes the backend owned by this desktop before touching stored files. A separately launched or reused backend must be closed and the desktop reopened first.

Reset clears the configured app data directory, including chats, blobs, generated images, workflows, all image collections (Hidden, Locked, Liked, Disliked and Review), LoRA projects/adapters/training packages, memories, Index entries/drafts, knowledge-base data, logs in that directory, web data, trash, and recovery backups. Image tag buttons are restored without image records. Prompt phrase buttons and custom profile buttons remain in desktop local storage; other saved preferences/drafts and session storage are cleared. The old React tree is unmounted, the Electron HTTP cache is cleared, and the backend and UI restart.

Installed base models, external source images, user exports (including LoRA packages outside app storage), external backups, external log directories, and operating-system history are outside this reset. This is application cleanup, not forensic disk erasure. Close other browser windows connected to the backend before resetting so stale clients cannot write their state back afterward.

The offline worker validates the data root and every target, refuses symbolic links/junctions, and will not operate on a drive, home, project, or installed-model directory. If deletion is interrupted, `.reset-in-progress.json` preserves image tag buttons and prevents the backend from reopening partial data. Use the Dashboard to export a new inventory and retry the reset. The app does not silently claim success after a partial failure.

## Upload chooser

All image-capable file inputs use the desktop chooser: Chat's two upload entry points, Image Review, Image Workflows, and LoRA training. Each invocation explicitly starts at the home directory and uses Windows `dontAddToRecent`; the previous selection is never stored as the next starting folder. Multi-selection and the existing upload validation remain. A chooser batch is limited to 100 files / 512 MiB and 100 MiB per file; individual features retain their stricter limits. Browser-only sessions use the browser's normal chooser because websites cannot control its starting directory.

## Verification

- `tests/backend/test_maintenance.py`: inventory contents, ZIP integrity, protected targets, confirmation, button preservation, interrupted-reset recovery, and request admission.
- `tests/frontend/desktopMaintenance.test.js`: native picker options and desktop reset lifecycle, including refusal/cancellation/failure.
- Temporary Electron QA uses its own data directory, profile, port, and synthetic media. Never run reset tests against live user data.
