// Run with Electron and LAW_CHARACTER_QA_DIR pointing to a fresh output folder.
// Only synthetic API responses are used; the normal app and its data are untouched.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("esbuild");

if (!process.env.LAW_CHARACTER_QA_DIR) throw new Error("LAW_CHARACTER_QA_DIR is required");
const output = path.resolve(process.env.LAW_CHARACTER_QA_DIR);
fs.mkdirSync(output, { recursive: true });
app.setPath("userData", path.join(output, "profile"));
app.disableHardwareAcceleration();
let finished = false;
function finish(result) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  app.quit();
}
setTimeout(() => finish({ ok: false, error: "Character save QA timed out" }), 30000);
app.whenReady().then(async () => {
  try {
    buildSync({
      entryPoints: [path.resolve(__dirname, "../tests/fixtures/characterSave.jsx")],
      outfile: path.join(output, "renderer.js"), bundle: true, platform: "browser", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    fs.writeFileSync(path.join(output, "index.html"), '<!doctype html><title>Character save regression</title><link rel="stylesheet" href="renderer.css"><div id="root"></div><script src="renderer.js"></script>');
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
    await win.loadFile(path.join(output, "index.html"));
    finish(await win.webContents.executeJavaScript("window.runCharacterSaveQA()"));
  } catch (error) {
    finish({ ok: false, error: error.message });
  }
});
