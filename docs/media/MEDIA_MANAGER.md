# Media Manager

Media Manager is bundled under `media-manager/`. Open its workspace to launch
the separate local module lazily; it is reused while switching tabs. An external
Desktop installation is no longer required.

Use **Enter Media Manager** to focus its source/search controls; F6 returns focus
to Workstation navigation. The compact navigation drawer temporarily hides the
native embedded view. Ctrl-click and Shift-click provide selection/range actions
in the displayed timeline; a normal thumbnail click opens playback.

## Storage and lifecycle

Media Manager owns its reports, scans, managed media and move logs. Fresh
installations use the desktop user-data `media-manager/runs` area. Existing
legacy Desktop/Media Organizer/runs data can be reused as private data; startup
does not copy or reorganize it.

Workstation reset/import preserves those independent reports. Shared visual-review
labels/notes in Workstation app data are a different catalog and follow normal
app backup/reset behavior. Preserve external media separately.

Closing the desktop window quits the app and signals the child to stop. The child
stops accepting requests and allows an active scan/move to finish rather than
force-killing a file operation. Minimizing keeps the desktop running.

## Optional overrides

| Variable | Purpose |
|---|---|
| `LAW_MEDIA_MANAGER_DIR` | Alternate module; default is the bundled source |
| `LAW_MEDIA_MANAGER_PYTHON` | Alternate Python; default is Workstation’s environment |
| `LAW_MEDIA_MANAGER_REPORTS` | Explicit private reports/data directory |

Set overrides before launch. The module uses standard-library Python plus its
documented FFmpeg/FFprobe discovery. See the [standalone guide](../../media-manager/README.md)
for scan, duplicate, playback and file-operation commands.

## Isolation

The embedded sandbox has no preload or Node access and can contact only its own
randomly assigned loopback origin. Trusted host IPC controls launch, position,
focus and status; it does not expose arbitrary media/filesystem operations.

A restricted review credential allows only the intended visual-review bridge.
The module receives neither the general Workstation session credential nor the
host’s private data/model environment. Its own UI credential stays separate.

Run `npm run test:media` for its tests. Synthetic integration checks do not prove
all installed codecs, external paths or real media operations work on another PC.
