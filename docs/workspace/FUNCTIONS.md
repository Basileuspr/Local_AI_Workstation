# Functions and navigation controls

Functions opens from its standalone sidebar button.

## Windows utilities

The Windows utilities group at the top of Functions opens Computer Management,
Disk Cleanup (drive selection), DB Browser for SQLite, Registry Editor, Power
Automate, System Information (System Summary), and System Properties (Computer
Name), plus the Desktop **GodMode** folder in File Explorer. GodMode recognizes
the plain folder name and its Windows settings identifier suffix. It opens the
existing folder without choosing any item inside. Opening Functions never
launches them. Each button only opens its window;
no cleanup presets, registry edits/imports, database commands, flows, or sign-in
actions are submitted.

For a portable/nonstandard SQLite or Power Automate installation, **Choose
program…** saves an application `.exe` or application shortcut `.lnk` without
opening it. Choose the application itself rather than a shortcut configured to
run a flow or other task. The saved location persists across desktop restarts.
Normal install locations are detected; Power Automate Store installations use
the fixed `ms-powerautomate:/console` URI, without a flow/run or login parameter.
These utilities are also available in **Add Button**.

Registry Editor opens at its own current location. **Copy registry location**
copies `Computer\HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`
from the screenshot to paste into its address bar. The launcher does not modify
registry values or Registry Editor's remembered location.

Utility launch verification uses mocked OS launches; it does not operate these
programs. Fully quit the desktop app and relaunch after rebuilding to load the
new desktop bridge.

## Function sequences

**Create Function** builds a saved, ordered sequence with **THEN** steps. Templates
cover Codex inspection, folder environment audit, Task Manager screenshot, Phone
Link and Sound settings. Saving never executes a function. Run explicitly starts
it; the desktop process owns progress while you switch tabs. Edit, duplicate,
reorder and remove steps. Existing single-action buttons keep their storage and
behavior. User-created functions are alphabetized.

Available steps:

- Open Codex, Task Manager, Phone Link, Settings, System/Display or Sound; or
  choose an `.exe` / `.lnk` using the existing program picker. Codex uses its
  registered Start-menu application; use a chosen shortcut if it is not found.
- Wait for one matching application window, for up to 15 seconds.
- Screenshot the selected window's current visible view. It brings that window
  forward, restores it if minimized, and requires foreground ownership. Keep
  overlays clear; obscured/offscreen portions may not be captured correctly.
- Fill an empty accessible text field, or press an explicitly selected button.
  **Find open windows** and **Pick accessible control** provide the target picker.
  Matching uses process name, optional exact window title, accessible control
  name, automation ID and type. Ambiguous/missing controls fail and prevent later
  steps. Existing field drafts are preserved by refusing to overwrite them.
- Point at a text field or button: click the picker, then move the cursor over
  the target within five seconds and keep it there. The saved position is relative
  to that window, so moving the window is supported. Resizing it causes the step
  to fail. Keep the target application's page/layout identical and point again
  after changes. Pointed paste clicks then inserts clipboard text without
  clearing an existing draft; use an empty field for a fresh request. Pointed
  click can press Send. These steps verify window identity, size, foreground and
  that no other window covers the point; they cannot verify the app accepted the
  text/click. The clipboard is restored after paste if it is still unchanged.
- Inspect/audit a chosen folder, with configurable subfolder depth 0–8. This
  produces a metadata inventory: visited file/folder counts, sizes, extension
  counts, environment marker filenames, largest files and skipped paths. It
  reads no file contents, skips links and NVIDIA paths, and is bounded to 20,000
  entries / 30 seconds. Totals represent visited entries; this is not a code,
  security or dependency analysis. A request to an AI can discuss the report.
- Prepare request text, inserting previous text/audit output with `{{report}}`.
- Copy the latest screenshot to the clipboard, or text if no screenshot exists.
- Save outputs to a chosen folder as Markdown, audit JSON and/or PNG. Unique
  filenames avoid overwrites. Audit/output folder paths are registered in the
  desktop process; saved steps contain opaque folder IDs.

Results appear with per-step status, image/text preview and saved paths. **Add
result to chat** stages removable attachments in the Workstation composer.
Review and press Send to upload/discuss them. **Copy screenshot** / **Copy text**
can be pasted into another application's chat.

For Codex, open the intended empty chat once and point at its text field and Send
button in the template. Selecting a Send button means Run will click it after
paste. Prefer accessible field/button steps when available; those can verify the
field value and refuse existing drafts. Accessibility support varies by app,
version and elevation; pointer steps provide a fallback with the layout limits
described above. Clipboard handoff is also available. This is a fixed click/paste
sequence builder, not an unrestricted command or keyboard macro facility.
Settings destinations use Microsoft's documented fixed URIs, including
[`ms-settings:sound`](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings).
Control targeting uses [Windows UI Automation](https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/add-content-to-a-text-box-using-ui-automation).

**Stop function** cancels the active helper/scan and prevents subsequent steps.
An in-flight pointed paste is allowed to finish restoring the clipboard, within
the helper's 20-second timeout, before stopping.
It does not undo completed launches, presses or saved files. Failure stops the
sequence without retrying a Send action. One sequence can run at a time; current
run results survive tab changes but not a desktop restart. This feature requires
Windows for window/control steps and a fully restarted desktop bridge.

The helper receives encoded JSON data via a fixed script; user text never becomes
PowerShell source. Main-frame trusted IPC and shared step validation restrict
actions. Opening the Functions page never launches, captures, audits or sends.

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

`tests/frontend/functionWorkflows.test.js` covers ordered execution, input
validation, failure/cancellation, persistence, bounded folder inventories and
unique saved reports. `scripts/qa-function-window.cjs` opens only a disposable WPF
fixture to check actual Windows field filling, draft preservation, buttons,
pointer recording/paste and PNG capture. `scripts/qa-function-sequences.cjs`
checks the built UI in hidden Electron with isolated data, real folder reports
and synthetic external window actions; it verifies pending attachments in the
real composer without submission. It does not validate a real Codex request,
Task Manager, Phone Link or Settings launch.
