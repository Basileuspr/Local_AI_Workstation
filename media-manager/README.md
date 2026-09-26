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

## Private storage

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
