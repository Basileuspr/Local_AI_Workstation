# Browser, profiles and guarded workflows

Browser uses sandboxed native Chromium pages with isolated persistent account
profiles. Normal navigation, closing a tab and restarting can retain profile
cookies/site storage. Choose cache-only cleanup or all browser data deliberately;
these have different effects on sign-in.

## Tabs and playback

Up to 24 pages share the selected profile. Ctrl+T, Ctrl+W, Ctrl+Tab and
Ctrl+Shift+Tab operate from desktop controls or the focused page.

Inactive tabs suspend two minutes after another Browser tab is selected by
default. Tab settings accepts 1–60 minutes, or 0 to disable suspension.
The selected page stays loaded even when its workspace is hidden. Selecting an
inactive tab cancels its deadline; disabling suspension does not reload a tab
already suspended.

Suspension closes the page renderer and associated login windows, retaining its
address/title in memory. Selecting it loads that address again in the same
profile. Cookies remain, but forms, navigation history and playback position can
be lost. Tab addresses/titles are not saved for automatic startup restoration.

Chromium owns playback, adaptive streaming and available hardware decoding.
The host avoids unnecessary repaint/placement work while video plays and
temporarily adjusts the visible player’s Windows process priority when permitted.
This does not rewrite video quality/streams or guarantee a frame rate.
Minimized/hidden pages return to ordinary background throttling.

## Profiles and safety boundary

Remote pages have no host preload, Node access or arbitrary desktop commands.
Named IPC is limited to the trusted app main frame. URL/sender/profile checks
apply independently; public destinations and all resolved DNS addresses are
validated, including redirects. Private/mixed-address answers remain blocked.

Changing profiles or clearing browser data closes tabs before operating on that
session. Ordinary downloads require an explicit user action and their normal
save flow. Downloaded files are separate from cache/workflow cleanup.

Source inspection and fixed semantic page tools provide bounded readable content
and specific actions. They do not expose raw cookies, passwords, arbitrary
JavaScript, selectors, debugger access or unrestricted network requests to models.
Login/challenge steps remain manual.

## Workflows and recovery

Workflows bind to a selected profile, tab, URL and document revision. Manual
navigation/tab changes invalidate references and pause work. Only one controller
owns a page operation at a time; background suspension never substitutes another
page for a running operation.

Checkpoints retain safe IDs/status and verified-result metadata, not DOM text,
form values or signed stream credentials. Temporary captured media has separate
bounds and cleanup. Startup removes incomplete/orphaned captures; interrupted
checkpoints remain available for review. Saved analyses and account sessions are
not erased by clearing disposable workflow media.

Use [Reels Analyzer](REELS_ANALYZER.md) for its stricter complete-media acquisition
and evidence checks, or [Web Research](WEB_SYSTEM.md) for public retrieval and
explicit rendered-page capture. An authenticated Browser session is not shared
with the public importer/crawler.

The current behavior supersedes the original ephemeral-profile browser design.
Historical snapshot hashes record that earlier source; they are not current
profile/privacy instructions. See [verification](VERIFICATION.md) for acceptance limits.
