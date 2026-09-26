# Functions and navigation controls

Functions opens from its standalone sidebar button.

## Functions

- **Markdown Viewer** has its own tab in Viewers. It accepts large pasted
  Markdown and switches between Plain Text and a rendered preview. The draft
  survives navigation but not app reload.
- **Add Button** creates a named shortcut to an app workspace, a chosen Windows
  program or shortcut, a system action, or a tab capture. Use Program or shortcut
  and Browse for program to select an `.exe` or `.lnk` in the native file picker.
  Registered program paths stay in the desktop process. Custom buttons persist locally and are
  alphabetized; Edit buttons provides rename, retarget, and remove controls.
- **Windows Snipping Tool** opens the Windows snipping overlay. **Open PowerShell**
  opens an interactive terminal and is also available on Dashboard.
- **Update Installed Programs** opens a terminal running `winget upgrade --all`.
  The terminal owns installer prompts and progress. Merely opening Functions
  does not start updates.
- **Refresh GPU Driver** sends the Windows graphics reset shortcut
  `Win+Ctrl+Shift+B`. It may briefly flicker or beep. It does not install drivers
  or unload Ollama models. Its PowerShell execution policy override applies
  only to the fixed helper process; it does not change system policy.
- **Capture [name] Tab** exists for all registered workspaces. It copies an
  image to the OS clipboard at maximized dimensions on the app's display.
  It leaves the user's visible window, active tab, input focus, and work intact.

## Capture behavior

Capture takes an inert snapshot of each mounted tab's current DOM and styles,
including form values, canvas pixels, selected controls, and recorded scroll
positions. A hidden, non-focusable Electron renderer lays out that snapshot at
the larger viewport. It has no app scripts, preload, saved profile, network,
or inference providers. It cannot submit duplicate jobs or execute copied HTML.
Image assets are resolved in the source renderer before capture. Unavailable
images produce a warning. The clipboard is written only after a painted frame
has been captured successfully; an empty initial compositor frame is retried.

This reflects the tab's **currently rendered state**. Tabs whose data loads only
when opened should be opened once first; capture does not refresh their data or
reconstruct a session from saved defaults. It captures one window-sized view,
not a stitched image of the entire scrollable page. The current subtab is used.

Media Manager has a separate renderer. Its current document is captured through
its existing isolated bridge and embedded into the screenshot without changing
its on-screen placement or taking focus. If it has not started, capture starts
its local UI service without scanning or moving media.

No screenshot files are saved by ordinary capture, and nothing is automatically
sent to a model. Paste the clipboard image into the desired conversation.

## Generate

- **Edit Image Request Before Send** opens an optional request editor with model,
  LoRA, prompts, dimensions, steps, guidance, seed, and long-prompt controls.
  Cancel/Escape leaves the original request untouched. Send Request validates
  and submits exactly one edited request through the existing queue. Ordinary
  Generate and batch submission remain available.
- **Copy Image** appears beside the current result and copies the full-resolution
  image, not its path, prompt, or a screenshot of the result area.
- **Jump to Chat** remains visible while scrolling. It opens the current chat
  and preserves Generate's settings, result, and scroll position.

## Prompt Queue

Click a request's title or card body to open its source. Chat, generated-image,
and memory-compaction jobs retain the submitting session. LoRA jobs retain the
project, workflows retain the workflow, and character jobs retain the dataset.
Waiting frontend chat follow-ups acquire their session ID as soon as creation
finishes. Older jobs lacking a source ID fall back to their workspace.

Navigation does not run or reorder requests. Stop/Cancel buttons do not navigate.
Missing or deleted destinations report an error.

## Implementation and verification

Desktop IPC checks the existing trusted main-frame boundary. System actions use
fixed commands; arbitrary renderer-supplied shell commands are rejected. Image
clipboard writes use Electron's asynchronous ClipboardItem API (with support
for older writeImage runtimes). Capture operates in an ephemeral renderer.

`scripts/qa-functions.cjs` exercises the built app in hidden windows with
temporary backend data and a temporary desktop profile. It verifies real
clipboard PNGs, all 15 capture destinations, preserved inputs/focus/navigation,
request editing, queue navigation, custom shortcuts, and the floating button.
The original clipboard is restored if the user has not replaced the test image.
System updates and graphics reset are mocked. Set `LAW_QA_DIST` to a test build;
optionally set `LAW_QA_MEDIA_DIRECTORY` to test the installed Media Manager with
temporary reports instead of the synthetic embedded fixture.

After rebuilding, fully quit the running app from its system tray and relaunch
to load both renderer changes and the new desktop bridge.
