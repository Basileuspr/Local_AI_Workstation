# Bundled Media Manager

This directory contains the complete Media Organizer engine and interface used
by the workstation's Media Manager tab. Python uses only the standard library;
FFmpeg/FFprobe enable video inspection, thumbnails, playback helpers, capture,
frame extraction, image conversion, stitching, and GIF creation. ExifTool is
optional. Existing tool discovery checks PATH and standard installation folders.

The interface includes scans and saved-scan history, a combined date library,
duplicate comparison, metadata filters, tags, per-item viewing rotation,
custom folders, verified moves and undo logs, rename, recoverable Trash/restore,
snapshots, clips, frame stepping and extraction, and image tools.

Scanning needs only a source folder. Leave **Destination folder** blank to
browse and review MP4 files in place, including dates, categories and duplicates.
Reports save in the workspace's own storage; source files remain unchanged.
Choose **Place in folder** for selected clips later, or add a destination and
scan again to preview a Year / Category archive move. The command line also
supports `media-organizer scan SOURCE` without `--dest` for a scan-only report.

## Delete unwanted media

**Delete** is visible on library cards and enlarged duplicate previews. Select
multiple clips and use **Delete selected** to review the exact copies, including
selections hidden by filters. Confirming moves only those copies into recoverable
Trash on the same drive; other copies remain in place. Opening/scanning never
deletes anything. File hashes are checked before the first batch move and again
when each file moves.

**View Trash** opens deleted clips. Restore a clip or use **Restore selected**;
occupied original filenames are never overwritten. Trash retains the bytes.
To reclaim space, use **Delete permanently** inside Trash, then confirm the
separate review. Permanent deletion checks hashes again and cannot be undone.
Batch actions accept up to 1,000 files and keep per-file operation logs.

## Private storage

Duplicate previews keep a visible video area when playback controls expand,
and Previous/Next copy keeps the viewer in playback mode. Failed loads expose
Retry video playback and an error message. Unsupported codecs can be opened
with a desktop player using Show in folder; browsing never transcodes media.

The workspace refreshes saved scans and file availability while idle, when
returning to the tab, and with Refresh library. Checks continue while a viewer
is open, preserving playback unless that copy moved or became unavailable.
Missing copies disappear from the duplicate grid; an open viewer reports the
missing file and can navigate to remaining copies. Restoring the file at its
recorded path and refreshing makes it available again.

Desktop launch passes an explicit reports directory. Existing users retain
their original Desktop/Media Organizer/runs data in place; fresh installations
use the workstation's user-data directory under media-manager/runs. Existing
media locations, operation logs, and capture paths are preserved without copying
or rewriting them. The old Desktop code is not loaded. Do not delete a legacy
data folder while it is still in use.

LAW_MEDIA_MANAGER_REPORTS can select another data directory. LAW_MEDIA_MANAGER_DIR
is an optional developer override for the engine and frontend; without a reports
override, an external engine retains its own runs directory. These settings are
local environment variables, never committed configuration.

Scans, generated reports, captures, source media, caches, and test output are
excluded from Git. Opening the tab never scans, moves, or imports media. Media
Manager's data remains independent of workstation chat, galleries, and reset.

## Standalone and tests

From this directory, use your Python executable with:

```text
python -m media_organizer.ui_server --reports <private-reports-directory>
python -m media_organizer --help
python -m unittest discover -s tests -t .
node --test tests/library.test.mjs tests/playback.test.mjs
```

The Python tests use temporary directories and generated fixtures. Optional
`tests/ui_*_test.mjs` browser checks use an installed Playwright package via
PLAYWRIGHT_MODULE and optional CHROMIUM_EXECUTABLE, with output in ignored
test-work. From the workstation root, scripts/qa-media-manager.cjs exercises
the built tab with the bundled module and disposable reports/profile.
