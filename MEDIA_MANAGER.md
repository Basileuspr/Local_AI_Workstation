# Media Manager: bundled local workspace

The sidebar's **Media Manager** tab opens the complete engine and interface
bundled in `media-manager/`. A fresh checkout includes all Media Organizer
functionality; no separate Desktop application installation is needed.

The host supplies a place to display the module and owns its process lifetime.
It does not import media, pass generated images, share galleries, add backend
routes, or connect any generation/review/collection controls. The module's
existing folder pickers, thumbnail viewer, duplicates, filters and custom-folder
actions run unchanged. Opening the tab does not scan or move anything.

## Isolation and lifecycle

- Electron creates a sandboxed `WebContentsView` without a preload or Node access,
  using its own ephemeral browser session. Its network is limited to its own
  randomly assigned loopback server origin. Both apps retain their existing CSP.
- Only the trusted Workstation main frame can request launch, placement, focus,
  and status. This bridge exposes no media or filesystem operations.
- The separate Python child gets OS runtime paths, not Workstation credentials,
  data/model configuration, or Python injection variables. Its own session token
  stays inside its UI server and renderer.
- Launch is lazy and reused across tab switches. The compact navigation drawer
  temporarily hides the native view. **Enter Media Manager** gives it keyboard
  focus, scrolls to the module's source input or active search, and acknowledges
  success in the host header; **F6** returns focus to app navigation.
- Closing to the tray keeps both workspaces running. Full app Quit closes the
  child control pipe: the server stops accepting requests and finishes an active
  scan/move before exiting. It does not force-kill a file operation.
- Existing Desktop/Media Organizer/runs data stays in place and is reused as
  private data only. Fresh installations store reports and managed media under
  the workstation user-data directory's `media-manager/runs`. Workstation reset,
  galleries, image events and saved preferences do not alter those reports.

## Location and launch

Default module path: `media-manager/` inside the workstation checkout.
The old Desktop code is never loaded by default. Keep any legacy `runs/` folder
that is still in use: saved scans, custom folders, captures, and move logs can
refer to files there. Nothing is copied, moved, or rewritten on startup.
Optional environment overrides, set before launching:

| Variable | Purpose |
| --- | --- |
| `LAW_MEDIA_MANAGER_DIR` | Optional external engine override; uses its own runs directory unless reports are overridden |
| `LAW_MEDIA_MANAGER_PYTHON` | Python executable; defaults to the Workstation Python |
| `LAW_MEDIA_MANAGER_REPORTS` | Explicit private report/data directory; takes precedence over legacy discovery |

The Python module uses the standard library. Existing FFmpeg/FFprobe discovery
and the standalone Python CLI continue to work. Rebuild with `npm run build` after
frontend edits, then fully Quit from the tray and relaunch to load Electron edits.

## Verification

`npm test` includes environment and startup-origin boundary tests.
`scripts/qa-media-manager.cjs` runs a disposable Electron window with the production
React build, the real module, synthetic MP4 media, disposable reports/profile,
and a stub host backend. The window is shown without taking focus so Chromium
can exercise viewport-based lazy thumbnails. It verifies lazy launch, renderer/storage/network
isolation, the actual Enter button and embedded input focus, scanning/thumbnails,
tab persistence, compact navigation, F6, and
graceful child exit. It does not start the normal backend or access its data.
Run with Electron (PowerShell `Start-Process -Wait -WindowStyle Hidden`), optionally
setting `LAW_MEDIA_MANAGER_QA_RESULT` to an absolute result JSON path. Results and
fixtures otherwise go to a new `law-media-manager-qa-*` temporary folder.

`npm run test:media` runs the bundled Python and JavaScript unit suites, including
the desktop readiness pipe, EOF shutdown, and waiting for active operations.
Set `LAW_PYTHON` to override the test Python executable. Tests use temporary data.

The repository excludes private reports, media, local test output and tool
binaries. Only source, synthetic tests, and documentation are published.

The standalone module also provides clear hash-verified primary-copy badges,
rename and recoverable Trash/restore, custom tags, inspected-metadata filters,
and video-frame extraction using its existing FFmpeg tools. These capabilities
and their reports remain entirely inside Media Manager. Frame parsing supports
source-frame intervals, ranges, image format/size/rotation, and a selected output
destination; it adds no models, dependencies, or Workstation media integrations.

The header's **Image tools** opens independent folder conversion, common image
size/aspect-ratio controls, and vertical/horizontal/grid stitching. It uses the
same existing FFmpeg tools and creates new copies in a chosen output folder.
It does not add images to the MP4 library or connect them to the host editor.
Rotation in the MP4 library now belongs to each saved-scan item, so identical
copies can have different viewing angles.


Video players now offer previous/next 1–10 frames and time steps of 1–10 seconds,
then 15–60 seconds in increments of five. Both normal and enlarged duplicate
players pause before stepping. Exact decoded presentation timestamps are read
on first frame use; variable-rate clips retain their actual spacing. This work
can be cancelled. The read is capped at one million frames, with time stepping
remaining available for larger or malformed timelines. Timestamp data is cached
separately from compact status polling and is not persisted into source videos.

Image tools also creates animated GIFs in filename or reverse order, with frame
delay (20–10,000 milliseconds, in tens) and looping options. Common sizing uses
existing pad/crop/stretch options. Output and individual images go to a new folder;
source files remain unchanged. GIF encoding uses the existing FFmpeg and a shared
palette, with bounded total frame pixels. No in-between frames are synthesized.
These features remain inside Media Manager's independent media system.


Media Manager now creates named custom folders in its own report storage, or at a
PC parent chosen through its in-app folder browser. The browser supports nested
folder creation, existing-folder selection and drive shortcuts without a Tk popup
or host bridge. Each registered folder provides an Explorer shortcut.

The module also has day/month/year section headers, an ungrouped view and large
previews. Separate video controls preserve the seek/duration bar during rotation.
Parse frames is directly visible in both the enlarged media preview and duplicate
viewer, opening the existing frame-count, sampling and output options for that copy.
Snapshot saves the current frame into the top-level Snapshots gallery; CLIP saves
a chosen time range as a separate MP4 with optional viewing rotation, retained
source audio, progress/cancel and an optional chosen output folder. Saved clips
have their own gallery. Source files are retained; captures and managed folders
stay in Media Manager storage, with no link to host image capabilities. Capture
and frame-export metadata stays in internal reports, without neighboring JSON
sidecars in exported media folders.


The media library has a sticky Items at a time selector: 5, 10, 20, 40, 50,
80, 100, 200, or ALL (default 50). Filters and saved-scan changes retain that
choice; Show next uses the chosen batch size. ALL renders every matching item,
with thumbnails still loaded lazily. The embedded workspace remembers the size
and its Library/Duplicates tab through page reloads.

Every Workstation tab has a Refresh control in the top toolbar. It reloads the
renderer in the selected workspace and restores the selected chat when available
(falling back to the newest chat if it was deleted). Navigation is stored locally.
Media Manager's Refresh also reloads its library data while preserving filters
and the embedded tab. Native app/backend code changes still require a full restart.
The isolated `scripts/qa-media-manager.cjs` check covers all 14 baseline routes, older-chat
restoration, all nine sizes, ALL beyond 200, scrolling, and embedded refresh using
synthetic media and disposable storage only.
