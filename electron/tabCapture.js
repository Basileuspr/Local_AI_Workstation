const { randomUUID } = require("node:crypto");
const { snapshotDocument } = require("./captureSnapshot");
const { copyNativeImage } = require("./desktopFunctions");
const TAB_LABELS = { chats: "Chat", images: "Image Gallery", generate: "Generate", library: "Prompt Index", knowledge: "Knowledge", tools: "Functions", dashboard: "Dashboard", queue: "Prompt Queue", review: "Image Review", "image-editor": "Image Editor", "media-manager": "Media Manager", workflows: "Image Workflows", lora: "LoRA", faces: "Faces", "character-parts": "Character Parts" };

function hasVisibleContent(image) {
  if (image.isEmpty()) return false;
  const bytes = image.toBitmap();
  const first = bytes.readUInt32LE(0);
  for (let offset = 0; offset + 4 <= bytes.length; offset += 64) if (bytes.readUInt32LE(offset) !== first) return true;
  return false;
}

// No app preload, app scripts, network, saved profile, or model providers in this
// renderer. It only lays out an inert copy of the already mounted source DOM.
async function renderSnapshot(snapshot, media) {
  const style = document.createElement("style"); style.textContent = snapshot.css; document.head.append(style);
  document.body.innerHTML = snapshot.html;
  function shadows(root) {
    for (const template of root.querySelectorAll("template[shadowrootmode]")) {
      const host = template.parentElement;
      if (!host || host.shadowRoot) continue;
      const shadow = host.attachShadow({ mode: "open" }); shadow.append(template.content); template.remove(); shadows(shadow);
    }
  }
  if (media) {
    const surface = document.querySelector(".media-manager-surface");
    if (surface) {
      surface.replaceChildren(); const container = document.createElement("div");
      container.style.cssText = "width:100%;height:100%;min-height:0;overflow:hidden"; surface.append(container);
      const shadow = container.attachShadow({ mode: "open" });
      const mediaStyle = document.createElement("style"); mediaStyle.textContent = media.css.replace(/\bbody\b/g, ".media-capture-body").replace(/\bhtml\b/g, ":host").replace(/:root\b/g, ":host");
      const body = document.createElement("div"); body.className = "media-capture-body"; body.style.cssText = "width:100%;height:100%;overflow:auto";
      const parsed = new DOMParser().parseFromString(media.html, "text/html"); body.append(...parsed.body.childNodes);
      shadow.append(mediaStyle, body); shadows(shadow);
    }
  }
  shadows(document);
  const roots = [document];
  for (let index = 0; index < roots.length; index++) for (const node of roots[index].querySelectorAll("*")) if (node.shadowRoot) roots.push(node.shadowRoot);
  await document.fonts.ready;
  await Promise.all(roots.flatMap(root => [...root.querySelectorAll("img")].map(image => image.decode().catch(() => {}))));
  for (const root of roots) for (const node of root.querySelectorAll("[data-capture-scroll-top]")) {
    node.scrollTop = Number(node.dataset.captureScrollTop); node.scrollLeft = Number(node.dataset.captureScrollLeft);
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function createTabCapture({ BrowserWindow, screen, clipboard, ClipboardItem, getWindow, mediaManager }) {
  let busy = false, captureWindow = null;
  return {
    dispose() { captureWindow?.destroy(); captureWindow = null; },
    async capture(tab) {
      if (!Object.hasOwn(TAB_LABELS, tab)) throw new Error("Unknown capture tab.");
      if (busy) throw new Error("Another screenshot is being prepared. Try again shortly.");
      const source = getWindow();
      if (!source || source.isDestroyed()) throw new Error("The app window is unavailable.");
      busy = true;
      let timer, ended = false;
      const check = () => { if (ended || source.isDestroyed()) throw new Error("Screenshot cancelled."); };
      try {
        return await Promise.race([(async () => {
          const snapshot = await source.webContents.executeJavaScript(`(${snapshotDocument.toString()})(${JSON.stringify({ tab, label: TAB_LABELS[tab] })})`);
          check();
          let media = null;
          if (tab === "media-manager") media = await mediaManager.snapshot();
          check();
          if (snapshot.html.length + snapshot.css.length + (media?.html.length || 0) > 80 * 1024 * 1024) throw new Error("This tab is too large to capture.");
          const area = screen.getDisplayMatching(source.getBounds()).workAreaSize;
          const outer = source.getSize(), content = source.getContentSize();
          const width = Math.max(640, area.width - (outer[0] - content[0])), height = Math.max(480, area.height - (outer[1] - content[1]));
          captureWindow = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true, frame: false, width, height, useContentSize: true, backgroundColor: "#080c14",
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false, partition: `capture-${randomUUID()}` } });
          const contents = captureWindow.webContents;
          contents.setWindowOpenHandler(() => ({ action: "deny" }));
          contents.session.setPermissionRequestHandler((_contents, _permission, done) => done(false));
          contents.session.setPermissionCheckHandler(() => false);
          contents.session.webRequest.onBeforeRequest((request, done) => done({ cancel: !request.url.startsWith("data:") && request.url !== "about:blank" }));
          contents.on("will-navigate", event => event.preventDefault());
          await captureWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; script-src \'none\'; base-uri \'none\'; form-action \'none\'"><body></body>'));
          check();
          await contents.executeJavaScript(`(${renderSnapshot.toString()})(${JSON.stringify(snapshot)},${JSON.stringify(media)})`);
          check();
          let image;
          // DOM readiness precedes the offscreen compositor on some GPUs. Wait
          // for real painted content instead of copying its initial solid frame.
          for (let attempt = 0; attempt < 6; attempt++) {
            contents.invalidate();
            await new Promise(resolve => setTimeout(resolve, 100)); check();
            image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: false }); check();
            if (hasVisibleContent(image)) break;
          }
          if (!hasVisibleContent(image)) throw new Error("The tab has not painted yet. Try capturing again.");
          await copyNativeImage(image, { clipboard, ClipboardItem });
          return { ok: true, tab, ...image.getSize(), warnings: [...snapshot.warnings, ...(media?.warnings || [])] };
        })(), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("The screenshot timed out. Try again when the tab has finished loading.")), 30000); })]);
      } finally { ended = true; clearTimeout(timer); captureWindow?.destroy(); captureWindow = null; busy = false; }
    },
  };
}
module.exports = { createTabCapture, TAB_LABELS, renderSnapshot, hasVisibleContent };
