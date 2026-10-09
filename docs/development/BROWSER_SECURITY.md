# Browser audit and remediation

Audit started 2026-10-02, before changes. Scope: Internet Browser, its popup windows,
session, source inspection, privileged IPC boundary, and privacy controls.

## Baseline findings

- `electron/viewerBrowser.js` creates a `WebContentsView` with a random
  `viewer-browser-<uuid>` in-memory session. `session.storagePath` is null.
  Closing the page clears storage and cache. Normal navigation preserves state;
  closing/reopening the page, application, or Windows cannot preserve this profile.
- Remote content has no preload, Node integration, webview tag, or host bridge.
  Sandbox, context isolation, and web security are enabled; insecure content is disabled.
- `trustedDesktop` in `electron/main.js` checks the exact host webContents, main
  frame identity, and trusted app origin before every privileged handler. The
  host-only preload exposes named operations, not arbitrary IPC. Remote pages do
  not receive backend credentials, database access, shell, or file APIs.
- Permissions and downloads are denied. Popups are blocked and offered as a link
  in the parent tab, which cannot preserve all OAuth opener/window relationships.
- HTTP(S) navigation and HTTP(S)/WebSocket requests pass a public-address policy;
  private addresses and private DNS results are rejected. This is defense in depth,
  not an OS firewall or a proof against all DNS rebinding/network-stack paths.
- Medium: the source viewer automatically enables DevTools Network response
  buffering. With authenticated browsing this can retain sensitive page responses
  unnecessarily. Source inspection and screenshots must require explicit consent.
- Informational: no Chrome profile, cookie import, password extraction, or shared
  Chrome user-data configuration was found in this browser implementation.
- Informational: installed Electron is 44.4.5. Official releases list 44.5.0
  (2026-09-29) in the same stable major. No major upgrade is required for this work.

## Implemented architecture

The browser now uses `persist:workstation-browser`, separate from the host UI's
default session and from Media Manager. The embedded view and native login windows
share this session. Closing a page destroys its windows and revokes page permission
grants, but retains cookies and site storage. Shutdown flushes cookies and storage.
No Chrome/Edge/Firefox profile is imported, read, or shared by this code.

**Browser privacy** displays the real `session.storagePath` returned by the running
app. With the default Windows app directory the expected location is
`%APPDATA%\local_ai_workstation\Partitions\workstation-browser`. A configured
`LAW_USER_DATA_DIR` changes the parent directory; the displayed runtime path is
authoritative. The pre-change in-memory profile had no storage path and nothing
durable to migrate. The persistence test used the actual runtime path
`%TEMP%\law-browser-persistence-<test-id>\profile\Partitions\workstation-browser`.
That is an isolated test profile, not the user's production profile.

Cookies, LocalStorage, IndexedDB, service workers, cache, and normal Chromium state
belong to this profile. They are not saved into chat, prompts, embeddings, or
application databases. Chat deletion and host-UI storage reset do not clear this
partition. Browser clearing touches only this partition.

Remote preferences: `nodeIntegration=false`, `nodeIntegrationInWorker=false`,
`nodeIntegrationInSubFrames=false`, `contextIsolation=true`, `sandbox=true`,
`webSecurity=true`, `allowRunningInsecureContent=false`, `webviewTag=false`,
`navigateOnDragDrop=false`, and no preload. Current Electron uses native popup
handling; the obsolete `nativeWindowOpen` toggle is not needed. Popups inherit the
isolated profile and explicit secure preferences, preserve their opener for OAuth,
display the site's origin in the native title, and are capped at four windows.
All frames and popups have the same navigation policy. Custom protocols, local
files, and private-network URLs are not handed to the OS shell.

### IPC and preload boundary

Every browser control IPC handler requires `trustedDesktop`: exact host webContents,
exact host main-frame identity, then trusted URL. Remote pages and their popups have
no `contextBridge` API and no `ipcRenderer`. The host `workstationDesktop` bridge
continues to expose only named capabilities. Its backend connection, maintenance,
program launch, file selection, storage, and system-action handlers use the same
sender gate and are not available to remote pages.

| Browser channel | Argument validation and effect |
| --- | --- |
| `start`, `state` | No arguments; start the isolated view or return bounded UI state/profile path. No credentials returned. |
| `place` | Finite geometry clamped to the host window; visibility only. |
| `navigate` | Public HTTP(S) URL validation; DNS/request policy also checks subresources. |
| `command` | Fixed back/forward/reload/stop/focus/close actions; unknown actions do nothing. |
| `inspect` | Native confirmation, current-page revision check, bounded read-only DOM and cached-resource catalog. |
| `source` | Opaque current-page ID only; stale or unknown IDs rejected. No arbitrary JS, URLs, or paths accepted. |
| `clearData` | Enumerated cookies/cache/site/all scope, native confirmation, close views before clearing. |
| `browser-bookmarks:list/save/remove/createFolder/import` | Trusted host only; bounded named bookmark operations. Import paths come only from the native HTML picker. Imported HTML is parsed as inert data, without scripts, icons or network access. |
| `viewer-browser:createTab/selectTab/closeTab/shortcut/setTabSettings` | Trusted browser host only; existing tab IDs, bounded tab count, public URLs and fixed shortcut/settings arguments. Inactive-page suspension destroys only that tab and its owned windows. Profile changes close that window's tabs. Profile data clearing also closes extra windows using that profile. |
| `browser-window:new` | Trusted main renderer or registered Browser-only main frame; no renderer URL/path argument. Opens a blank Browser using the caller's selected profile, bounded to 8 extra windows. |

Extra Browser windows use `browserWindowPreload.js`, an ephemeral host-renderer
partition and the Browser-only renderer. The sender registry in
`browserWindows.js` requires that window's exact webContents/mainFrame and
trusted renderer path with the Browser-window marker. It routes the bounded
browsing/tab/profile operations to that window's controller; backend connection,
workflows, file APIs, shell and profile clearing retain the main desktop gate.
Bookmarks use the same registered-host check and import dialogs use the caller's
window. Remote views receive no preload or host capabilities. A shared profile
catalog gives each window its own selected profile without duplicating logins.
The browser-session permission/download handlers are installed once per Chromium
Session and route to the owning window; detaching one controller revokes only
its grants/downloads. Privacy clearing closes extra windows using the selected
profile before clearing shared Chromium storage. Shutdown disposes all extra
controllers before closing the main renderer and stopping the backend.

Bookmarks live in `browser-bookmarks.json` beside the app's browser profiles and
are shared across account profiles. They retain names, addresses, nesting and
exported creation dates. Repeat imports merge folders by parent/name and skip
addresses already saved in the same folder. The registry is separate from
Chromium cookies, cache and site storage, so browser privacy clearing preserves it.
Local-file, private-network and Chrome entries may be retained for reference;
their Open controls are disabled and navigation still enforces the public-address
policy. Imports accept HTML up to 10 MB, with at most 10,000 bookmarks and 2,000
folders. Writes replace the registry atomically; invalid existing libraries are
preserved and reported instead of silently reset. Bookmark management hides the
native page view so it cannot cover the controls.

Source inspection no longer enables `Network` recording. It reads already loaded
resources through the `Page` domain only after confirmation and detaches the
debugger after each operation. Source labels omit query strings and fragments.
Explicitly inspected HTML/scripts may still contain private data; the confirmation
explains this. Export to the code viewers, copy, and save remain explicit actions.
Browser screenshot capture also requires confirmation and rejects a page change
while the confirmation is pending. Neither operation automatically attaches to AI.
There is no remote console forwarding or automatic remote DevTools opening.
Application logging now redacts recognized authentication headers, cookies,
password fields, bearer tokens, and OAuth callback query values.

### Permissions, downloads, uploads

- Camera/microphone, location, notifications, and clipboard permission requests
  use native approval dialogs that identify the requesting origin. Decisions are
  held in memory for that document; reload/navigation/close revokes them. Media
  requests are prompted individually so microphone approval cannot grant camera.
- Permission checks reject foreign contents, third-party frames, and unsupported
  capabilities. Screen capture, MIDI, Bluetooth, USB, serial, HID, filesystem API
  access, and local-network permissions are denied in this first version. Standard
  HTML uploads still use Chromium's explicit file picker. No arbitrary file-read
  bridge is exposed. Restricted filesystem paths remain denied.
- WebRTC disables non-proxied UDP as additional network protection.
- Downloads pause for a native Save dialog. Only the selected path is used;
  automatic program execution/opening is not added. Closing Browser cancels pending
  downloads. Ordinary downloads cannot silently write into app/model/system folders.
- Clear controls distinguish cache, cookies/login data, site storage, and all data.
  Cookie/all clearing also clears HTTP authentication cache. Downloaded files are
  not deleted by browser-data clearing.

## Security findings after remediation

- **Medium, addressed:** automatic response-body buffering replaced by explicit
  source inspection; screenshot/source export now have privacy confirmation.
- **Low, addressed:** diagnostic redaction previously covered primarily local app
  credentials; recognized website authentication fields/headers now also redact.
- **Informational:** persistence, popup support, download selection, and privacy
  controls were missing functionality, not proof of a privilege escalation.
- No Critical or High privilege exposure was demonstrated in this bounded audit.
  This is not a formal proof that Electron or arbitrary websites are vulnerability-free.

## Authentication behavior and limitations

After manually signing in, persistent cookies and site storage remain in the app's
browser profile when the app closes and are available on the next launch. A site's
session expiry, session-only cookie policy, logout, MFA/device checks, or provider
restrictions can still require another sign-in. Session-only cookies are not
converted into persistent cookies. No passwords/tokens are intercepted or exported
to implement persistence. Some providers reject embedded-browser login; this code
does not spoof Chrome or weaken security to bypass that decision.

Local-network filtering includes DNS checks but is not an OS firewall and cannot
prove every DNS rebinding or Chromium network path safe. The workstation backend's
independent credential/origin checks remain required. This work does not reconfigure
other local services such as Ollama or the user's firewall.

Installed/tested Electron remains **44.4.5**, within stable major 44. Official
**44.5.0** is available in the same major with the same reported Chromium version;
it includes a WebAuthn security-key PIN crash fix and WebContentsView focus fixes.
A routine tested minor update is recommended before relying on security-key flows.
No major upgrade or unverified runtime replacement was performed here. Temporary
browsing mode and persistent website-permission grants were intentionally omitted.

## Validation and manual verification

Independent-window verification (2026-10-08): `node scripts/qa-browser-windows.cjs`
uses disposable profiles and owned local pages to check three concurrently
playing native videos, separate tabs/history/drafts, shared cookies/storage and
bookmarks, correctly parented permissions, both Ctrl+N paths, information-dialog
visibility, narrow geometry, profile isolation, clearing and shutdown. Its host
fixture reuses the production Browser window/controller/preload. It does not
restart the user's live app or run GPU generation. `node scripts/qa-browser-tabs.cjs`
also verifies suspension deadlines, reload/recovery, profile changes, shortcuts
and timeout persistence across two separate Electron launches. Focused frontend
tests cover window sender gates, profile selection and shared-session policy.
Fully quit/reopen the workstation after active generation finishes to load the
changed Electron and preload code; a renderer-only refresh is insufficient.

Earlier browser-foundation automated/native checks passed:

- Full frontend suite: 115 test files, 973 tests (includes the 3D viewer additions).
- Production Vite build; Three.js remains in lazy viewer/worker chunks.
- Two independent Electron launches: persistent cookie, LocalStorage and IndexedDB
  survive; isolated popup shares only browser session and returns via `postMessage`.
- Remote page/popup has no Node or workstation preload. Public `example.com`
  loads under the production request policy. Loopback and stale-source checks pass.
- Chosen-location download completes; close destroys login windows; cache-only
  clearing retains login and all-data clearing removes login/site state.
- UI source inspection still opens HTML/CSS/JavaScript in matching viewers.
- Unit tests cover origin/frame permission rejection, revocation, stale dialogs,
  microphone/camera separation, URL/DNS rules, and diagnostic redaction.

Test commands: `node scripts/build-viewer-qa.mjs`,
`node scripts/qa-browser-persistence.cjs`, and
`electron scripts/qa-viewer-browser.cjs` (optional `LAW_BROWSER_PUBLIC_QA=1`).
The fixtures use disposable app profiles and owned fixture credentials. The
browser UI fixture has no production CSP; the remote page protections are real.

Still manual; **not claimed verified**: Google/GitHub real-account authentication,
MFA/passkeys, provider-specific OAuth, physical camera/microphone grants, Windows
restart, and actual user file selection in native dialogs.

1. Fully quit and reopen the workstation to load the new Electron code.
2. Open Browser, sign into a chosen website yourself, close/reopen its page, then
   fully quit/relaunch the app and return to that site. Repeat after Windows restart
   when convenient. Do not send credentials or tokens into chat.
3. Open Browser privacy and confirm its profile path differs from Chrome's.
4. Clear cache only: login should remain where the site relies on cookies/storage.
   Clear all browser data: the embedded browser should sign out, while Chrome and
   workstation chats remain independent.
5. Exercise a site's popup login. Verify unexpected camera/location requests show
   approval and denial works. Download a harmless file and cancel/choose its path.
6. Automated tests above check Node/preload absence and blocked loopback access.
   Opening `http://127.0.0.1:11434` in the Browser address bar should be rejected.

## Files changed for browser work

`electron/browserSession.js`, `electron/viewerBrowser.js`, `electron/main.js`,
`electron/preload.js`, `electron/redactSecrets.js`, `electron/logger.js`,
`src/components/ViewerBrowser.jsx`, `src/workspaceHelp.js`, the browser policy tests,
and the browser QA scripts. Existing unrelated dirty work was retained.

References: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[session API](https://www.electronjs.org/docs/latest/api/session),
[Electron 44.5.0](https://releases.electronjs.org/release/v44.5.0).
