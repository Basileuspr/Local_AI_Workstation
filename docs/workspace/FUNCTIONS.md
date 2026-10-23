# Functions and Windows utilities

Functions provides saved navigation buttons, supported Windows utility launchers
and ordered function sequences. Opening the pane or saving a function does not
execute it.

## Utility launchers

Buttons open Computer Management, Disk Cleanup, DB Browser for SQLite, Registry
Editor, Power Automate, System Information, System Properties or an existing
GodMode folder. They do not choose cleanup options, edit the registry, execute
SQL, run a flow or submit sign-in.

**Choose program** stores an application EXE or shortcut for a portable/nonstandard
installation. Choose the application itself rather than a shortcut already
configured to perform an action. **Copy registry location** copies a reference
path; it does not change Registry Editor or registry values.

## Create and run a function

Create Function builds ordered THEN steps. Templates provide starting points for
app inspection, folder inventory and Windows settings. Edit, duplicate, reorder
and save, then **Run** explicitly. One desktop-owned sequence runs at a time.

Supported steps include opening a chosen app, waiting for a matching window,
capturing its visible view, filling an empty accessible field, pressing a selected
control, preparing text, copying a result and saving uniquely named outputs.
`{{report}}` inserts previous text/audit output.

Accessible targeting rejects ambiguous/missing controls and refuses to overwrite
existing field drafts. Pointed targeting uses saved window-relative coordinates:
moving the window is supported, resizing or layout changes require repicking.
It checks foreground/occlusion and window identity, but cannot prove the target
accepted the text or click. A selected Send button is clicked when that step runs.

Screenshots bring the selected window forward and capture its current visible
view. Keep overlays clear. Pointed paste restores the clipboard if it remains
unchanged. These are fixed operations, not arbitrary shell commands or keyboard
macros.

## Folder inventory

The function audit step reads metadata only: counts, sizes, extensions,
environment marker names, largest files and skipped paths. It skips links and
NVIDIA paths and is bounded to 20,000 entries / 30 seconds with depth 0–8.
Totals describe visited entries, not the complete drive or a security/code audit.

For content analysis with a local model, use
[Folder Review](FILE_TOOLS.md#folder-review), which has separate extraction and
coverage rules.

## Results and stopping

Results show per-step status and previews. Save writes new Markdown/JSON/PNG
outputs into a chosen folder without overwriting an existing file.
**Add result to chat** stages removable attachments; review and Send separately.
Copy Screenshot/Text provides a manual handoff to another app.

Stop cancels active helpers/scans and prevents subsequent steps. It does not undo
completed clicks, launches or saved files. An in-flight paste can finish bounded
clipboard restoration before stopping. Failure stops the sequence without
automatically retrying Send. Run results survive tab changes, not desktop restart.

Window/control operations require Windows and the current desktop preload/main
process. Rebuild/restart when updating that bridge. User text is encoded data
passed to fixed helpers, never interpolated as PowerShell source.
