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
| RESET APP DATA & SANITIZE APPLICATION | Choose all app data, retain phone setup, or select individual sections; review and type RESET |

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

The reset dialog offers three modes:

- **Clear app data, keep phone setup** (default): clear all app-data sections and
  desktop storage, including phone credentials, invitations and job history.
  Retain only the validated HTTPS origin, listener address/port and certificate
  file paths. Certificate contents are not copied; access stays off.
- **Clear all app data, including phone setup**: also forget the connection setup.
- **Choose specific sections**: select chats, memory, Knowledge/Index, app media
  and documents, workflows, characters/faces/LoRAs, web research, audit records,
  logs/Trash/recovery copies, phone access/jobs, PC bridge, library registrations,
  desktop settings/storage, or remaining app data. Nothing is selected initially.
  Phone setup retention is optional when phone access is selected.

Counts describe app-data files at review time; desktop storage is additional.
Unselected app-data files and unrelated desktop preferences remain. Selecting
Desktop settings and browser storage clears all renderer storage, including saved
canvas and drafts, even when backend media is retained. Temporary desktop
session state is cleared and the renderer reloads, so save edits first. Related
copies can exist in other sections: clearing Chats alone does not clear memory,
backups or phone jobs. Deleting media can leave missing attachments in retained
chats. Library registrations and external file bytes have separate ownership.

An interrupted reset keeps its original scope and phone setup choice in a private
recovery marker, blocking normal startup until retry completes. A retry cannot
broaden the deletion scope. No automatic export is created.

After clearing phone access, start **Mobile companion** and create a fresh phone
invitation. The phone may keep its saved address. If desktop setup was forgotten,
**Find Tailscale address** reads an already configured private HTTPS Serve proxy
for the selected listen port. It does not change VPN, firewall, certificates or
proxy configuration. Enter direct LAN HTTPS settings manually.

Reset rejects unsafe roots and links/junctions. External originals, exports,
backups, external logs, source/Git history, independent manager storage and retained
import recovery folders and separate browser profiles are outside scope. This is application cleanup, not
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
