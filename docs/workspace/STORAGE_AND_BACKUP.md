# Storage libraries, backup and reset

Managed app data, external originals, models and independent manager catalogs have
different owners. Review the scope below before maintenance.

## Storage libraries

Dashboard → Storage libraries creates dedicated app folders on local drives.
Create/reattach a marked library, then choose **Use for new files**. Earlier media
stays in its original location and remains readable across registered libraries.
An unavailable selected destination produces an error instead of silently saving
elsewhere.

New managed images, imports, documents, character attachments, datasets and
workflow assets use the selected library. **Use library** in output controls
chooses an export-copy folder there. Models, chats, settings, indexes, encrypted
vaults and audit catalogs keep their own locations.

Backup includes managed files across registered libraries; reconnect their drives
before export. Restore flattens these managed files into app data and resets the
default there. Reset/import preserves external library folders; reset removes
their registrations. Export copies and other external files remain outside the
backup. Metadata-only inventory describes the original app-data folder.

## Dashboard actions

| Action | Scope |
|---|---|
| SAVE METADATA | Aggregate counts/bytes and basic numeric configuration; no content, filenames or paths; cannot restore data |
| EXPORT BACK-UP | Private app-data content plus desktop localStorage and managed-library files |
| IMPORT BACK-UP | Validates a supported backup, then replaces current data/preferences after typed IMPORT confirmation |
| RESET APP DATA & SANITIZE APPLICATION | Clears app data and desktop/browser storage after typed RESET confirmation |

Backup includes managed media, locked images, databases/sidecars, LoRA artifacts
and personal settings/buttons. It excludes installed application/dependencies,
base models, external originals/exports/logs, browser cache and unsaved RAM edits.
Independent Media Manager reports and Image Manager catalog storage need their
own backup; backing up a catalog does not copy its external image originals.

Export requires a new ZIP outside app data, never overwrites, streams files and
reads them back to verify manifest lengths/SHA-256. Detected source changes fail
the backup. A failed attempt removes only its own incomplete archive. A successful
archive and a successful backend restart are separate outcomes.

## Import and recovery

Import accepts the app’s `local-workstation-backup-v1` archive, not a metadata
inventory. It validates manifest, paths, exact file membership, sizes, hashes and
preferences before showing the review. Unsafe/link/special entries and duplicate
or case-colliding paths are rejected. Imports replace; they do not merge records.

After review, the archive digest is rechecked. Data is staged in a sibling
directory, hashed and space-checked before replacement. Previous data/preferences
remain in a private `.law-import-<data-folder>-before-*` recovery directory.
That recovery copy is outside reset scope and remains until explicitly removed.

A durable journal blocks backend startup during replacement. Failure rolls back
data and preferences; **Recover previous data** can resume interrupted rollback.
Do not remove the journal or recovery directory to bypass an unresolved import.

## Reset and maintenance

Save edits, finish/cancel active work and close other clients first. Maintenance
blocks new requests, waits for in-flight activity, refuses active jobs and stops
the owned backend. A separately launched/reused backend must be stopped and the
desktop reopened before these actions.

Reset removes chats, media/collections/vault copies, workflows, datasets, LoRA
projects/adapters, memory, Index, Knowledge, app-data logs/web data/Trash and
desktop preferences/browser cache. Code and base models remain. No automatic
export is created. An interrupted reset leaves a marker and blocks normal startup;
retry the supported reset to finish.

Reset rejects unsafe roots and links/junctions. External originals, exports,
backups, external logs, source/Git history, independent manager storage and retained
import recovery folders are outside scope. This is application cleanup, not
forensic disk erasure.

## Drive folder sizes

Dashboard → Drive space → Folder sizes performs an on-demand read-only metadata
scan of a selected local drive. Cancel/close stops it and preserves partial results.
It does not open contents, elevate, delete or run during normal telemetry polling.

Totals are unique logical bytes, with hardlinks counted once. Links, junctions,
reparse/cloud placeholders and unreadable items are skipped/reported.
Incomplete scans, compression, sparse files and filesystem overhead mean totals
need not match Windows used space. Percentages describe scanned bytes only.

[Image Manager](../images/IMAGE_MANAGER.md) · [Media Manager](../media/MEDIA_MANAGER.md)
