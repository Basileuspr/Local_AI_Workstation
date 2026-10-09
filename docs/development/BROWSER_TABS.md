# Browser tabs and inactive-page suspension

The existing Browser toolbar now includes a tab strip, New tab, per-tab close,
and Tab settings. Up to 24 native pages share the selected isolated account
profile. Each loaded tab retains its own navigation history, forms and playback
until it is closed or suspended. Ctrl+T, Ctrl+W, Ctrl+Tab and Ctrl+Shift+Tab work
from the desktop controls and the focused remote page. Named shortcuts are
serialized in the host so rapid inputs use the current selected tab.

The default timeout is **2 minutes after selecting another Browser tab**.
The host main process owns deadlines; toolbar polling, hidden workspaces,
background page requests and background navigation do not extend them. Selecting
a tab cancels its deadline. The selected tab remains loaded even while the
Browser workspace or a settings panel is hidden. The setting accepts integer
1–60 minutes, or 0 to disable suspension. Shortening the timeout applies to time
already elapsed. Disabling suspension does not reload already suspended tabs.

Inactive views are hidden and background throttling is enabled. At the deadline
their native WebContents are closed with `waitForBeforeUnload:false` and removed
from the host window, releasing the page renderer, media decoding and page-owned
connections. Login windows owned by that tab also close. Suspended labels retain
the address and title in memory; selecting one creates a fresh sandboxed view and
loads that address in the same persistent profile. Cookies and site storage
remain, but unsaved forms, navigation history and playback position can be lost.
Downloads already explicitly saved and session-level service workers are governed
by the existing session policy; this change does not erase them or stop other
tabs' requests.

Electron's background throttle applies to animations/timers and can be affected
by another unthrottled view in the same host window. Actual unload is therefore
used to stop inactive page playback and streams after the deadline. API reference:
[Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents).

Only `{inactiveMinutes}` is written to `browser-tab-settings.json` beside the
profile registry. Tab URLs/titles are not written to disk by this feature, and
tabs are not automatically restored across app launches. Account profile changes
and browser-data clearing continue to close all tabs before operating on the
selected session. Bookmark data is unaffected.

Tab creation, selection, close, shortcuts and setting updates use named IPC
guarded by the existing exact desktop sender/main-frame/origin checks. IDs,
settings and URL schemes are validated. Remote pages still have no host preload,
Node, local-network access, arbitrary host execution or access to another account
profile. Only selected-page navigation affects workflow and source revisions.
Manual tab changes pause workflows and invalidate page/source references. Tab
changes wait for profile initialization/clearing and reject while a browser
operation is busy; background suspension never selects a different page for an
operation.

Validation:

- `tests/frontend/browserTabs.test.js`: exact default deadline, reselect/reset,
  active-page exemption, background metadata, settings changes/disable,
  persistence, corruption fallback, validation/cap, close and timer cleanup.
- `node scripts/qa-browser-tabs.cjs`: real native views, renderer/preload/IPC,
  video and an open streaming response, two-minute deadline with a deterministic
  host clock, destruction/stream closure, reload/login retention, separate
  histories, stale source rejection, workflow pause/ref rejection, shortcuts,
  profiles, clearing and shutdown.
  A separate Electron process verifies saved settings. All data uses a disposable
  profile and owned fixture; no user's account or original bookmark file is used.
- Existing bookmark and browser profile/popup/download QA remain applicable.

Restart the desktop app to load the changed host, preload and renderer. These
checks establish unloading and restoration, not smooth public YouTube playback
under simultaneous heavy AI GPU/CPU work; see `BROWSER_PLAYBACK.md`.
