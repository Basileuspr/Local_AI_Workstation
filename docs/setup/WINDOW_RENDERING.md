# Window rendering

Windows launches default to **Windows compatibility**. It disables Chromium's
DirectComposition presentation path and GPU rasterization for page/text tiles.
GPU composition, video and WebGL retain their normal availability. Existing
compatibility preferences automatically use this stronger behavior after Quit
and relaunch; no preference reset is needed. The earlier presentation-path
change did not resolve the user's text-only artifacts after a full restart.

Open **Workspace options → Appearance → Window rendering** to choose:

- **Windows compatibility**: the Windows default; CPU painting of text/page tiles
  with GPU composition and a simpler presentation path.
- **Hardware accelerated**: Chromium's normal presentation and graphics defaults.
- **Software rendering**: renders the interface without hardware acceleration,
  for persistent artifacts. Video and large previews may use more CPU; websites
  that need WebGL/WebGPU may not display their 3D content.

The choice is saved in the desktop profile and applies at the next launch.
Finish current work, **Quit** from the system tray and reopen. Closing the window
only hides it. AI inference and image-generation GPU settings are independent.
`LAW_DISABLE_GPU=1` / `--law-software-rendering` still override a launch.

Changes to visible text, streamed replies, controls, menus and scrolling request
Electron's actual native full-window repaint. Requests are coalesced and do not
modify DOM content, focus, selection, scroll position or window bounds. Updates
inside hidden workspace branches are ignored, and static primary tabs have no
repaint timer. Visible native Browser/Media Manager panes use a bounded 500 ms
repaint recovery timer because their isolated pages have no host DOM bridge.
Neither gains preload/Node/host access. All pending paint work stops in the tray,
when minimized, and when the window closes.

**Workspace options → Redraw window** requests the same native repaint immediately
without reloading the app or losing a draft. It is separate from Refresh.

Visible windows keep frame updates active while menus or other windows take
focus. The initial hidden window is allowed to draw its first frame before
ready-to-show; later hidden/minimized windows can sleep. Restore, zoom, monitor/scale changes,
native context-menu closure and graphics-process recovery coalesce a layout
notification; embedded Browser and Media Manager views re-measure in the next
frame. The app never reloads, jiggles its size or discards drafts to refresh.
Graphics status and failures are recorded in the desktop log.

Validation includes preference/override/failure cases, notification coalescing,
visibility transitions and listener cleanup. `scripts/qa-window-rendering.cjs`
uses a visible production window with isolated `LAW_USER_DATA_DIR`, `LAW_DATA_DIR`,
and `LAW_QA_RESULT` paths. It checks menus, a native select, restore, resize,
zoom, geometry signals, native repaint requests from text-node-only updates,
bounded coalescing, updated compositor pixels and preserved drafts in
compatibility, hardware and software modes. `LAW_QA_HOLD_MS` and an isolated `LAW_QA_READY`
file optionally hold a text-only live counter for Windows.Graphics.Capture
inspection independently of `webContents.capturePage`. Windows capture confirmed
a live text counter and long-to-short line replacement cleared old letters
without moving or resizing the window. Its display event is simulated;
physical monitor/DPI changes and the intermittent user-visible artifact still
need confirmation on the affected setup.

Technical references: [Chromium's DirectComposition switch](https://github.com/chromium/chromium/blob/main/ui/gl/gl_switches.cc),
[Chromium's CPU rasterization switch](https://github.com/chromium/chromium/blob/main/gpu/config/gpu_switches.cc),
[Electron's native repaint API](https://www.electronjs.org/docs/latest/api/web-contents#contentsinvalidate),
[Electron frame throttling](https://www.electronjs.org/docs/latest/api/web-contents#contentssetbackgroundthrottlingallowed),
[Electron's investigation of stale Windows frames](https://www.electronjs.org/blog/tech-talk-window-resize-behavior).
