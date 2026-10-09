# Browser playback performance

The Browser continues to use Chromium's native video player, adaptive streaming,
hardware decoder when available, and isolated persistent session. No video,
quality setting, cookie, or signed stream URL is rewritten by these changes.

Playback changes:

- Routine host content/clock repaint requests and the native text recovery timer
  defer full-window invalidation while a visible native page plays media. Input,
  explicit redraw, resize, DPI changes and paused-page text recovery still work.
- Native placement skips unchanged bounds and visibility. The renderer merges
  scroll/resize signals into one animation frame; changing effect dependencies
  no longer briefly hides a playing page. Visible native video stays unthrottled;
  hidden/minimized views return to normal background throttling.
- Concurrent requests to the same stream/CDN hostname share an in-flight DNS
  check. Completed positive decisions are not cached. Later requests revalidate
  non-stale Chromium DNS, and private/mixed-address answers remain blocked.
- Idle toolbar polling slows to 1.5 seconds and unchanged status does not rerender
  React. Navigation/running-workflow polling stays at 0.5 seconds. Toolbar state
  reads only the active workflow instead of cloning all checkpoint history.
- On Windows, only the visible playing Browser renderer temporarily receives
  ABOVE_NORMAL CPU priority. Its previous class returns on pause, hide,
  navigation and shutdown. Existing higher priorities and other processes are
  preserved; permission failures leave playback running at its original class.

## Verification and limits

Run `npm test -- --reporter=dot tests/frontend/browserPlayback.test.js
tests/frontend/windowRendering.test.js tests/frontend/browserBookmarks.test.js
tests/frontend/viewerBrowser.test.jsx tests/frontend/browserSession.test.js
tests/frontend/browserFoundation.test.js tests/frontend/soundMixer.test.js`.

`node scripts/qa-browser-playback.cjs` creates a muted, generated 1080p60 MP4 in
a disposable profile and measures presentation callbacks, dropped frames,
buffering and seeking with host/browser focus changes. It also reports the
actual decoder. `LAW_PLAYBACK_YOUTUBE=1` adds a public YouTube smoke using a fresh
profile; it does not read the user's login. Diagnostic graphics switches apply
only to the probe, not production settings.

The initial 7.5-second compatibility probe recorded 29 forced window repaints;
the changed implementation recorded 1–2. Hardware decoding remained active
(`D3D11VideoDecoder`) and seeking recovered. Public YouTube played at 480p with
readyState 4 and no media error. The 1080p60 stress probe still dropped frames,
and a hardware-mode run encountered a GPU error. Concurrent local LLM work was
observed consuming about ten CPU cores and later about 7.5 GiB of 8 GiB VRAM.
These runs verify reduced repaint work and functioning playback; they do not
establish smooth high-resolution YouTube playback under an idle or controlled
GPU workload. No AI job was stopped and no Windows/driver settings were changed.

Restart the desktop app to load the changed main process, preload and renderer.
