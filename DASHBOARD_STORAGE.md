# Drive folder sizes

Dashboard → Drive space → **Folder sizes**, next to **Open drive**, starts a read-only scan of that drive's immediate folders and their descendants. The dialog shows a segmented share bar and a largest-to-smallest list with byte sizes and percentages. Files directly in the drive root appear separately. Small sizes use B/KiB/MiB; larger sizes use GiB/TiB.

The worker reads directory entries and file metadata only. It does not open file contents, elevate permissions, delete, or modify scanned files. It runs independently of the backend and model workloads. Scanning is on demand, never part of the five-second Dashboard telemetry refresh. Only one scan runs at a time. The dialog updates while scanning; Cancel, closing the dialog, or quitting the desktop stops the worker. Results remain in memory for reopening and are refreshed with Rescan.

Totals are unique logical file bytes, not allocated disk space. Hardlinks are counted once under the first location scanned, with subsequent references flagged in their rows. Symbolic links, junctions, and other Windows reparse points (including cloud placeholders) are skipped. Unreadable/disappearing items are counted and affected rows marked incomplete. A canceled scan keeps its partial results. These boundaries, compressed/sparse files, filesystem overhead, and concurrent changes mean totals need not match Windows' used-space reading. Percentages refer to scanned bytes only.

The desktop exposes guarded `dashboard:scan-drive`, `dashboard:drive-scan-status`, and `dashboard:cancel-drive-scan` IPC handlers. The renderer can choose a drive root such as `C:\`, not an arbitrary path or shell command. The Python worker independently validates local fixed/removable/RAM drive roots; network paths and mapped network drives are not scanned. No HTTP disk-scanning endpoint is added.

Verification uses temporary filesystem fixtures for recursive totals, root files, hardlinks, skipped reparse points, access errors, cancellation, and unchanged file metadata. Desktop controller tests cover root validation, partial stdout, worker termination, and failures. UI previews use synthetic results rather than scanning personal drives.

Fully quit the desktop from its tray and reopen after updating, so the new main process and preload APIs are available.
