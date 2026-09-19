// Run with Electron and LAW_PROGRESS_QA_DIR pointing to a fresh output folder.
// The renderer uses only synthetic reports; no backend or model is started.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("esbuild");

if (!process.env.LAW_PROGRESS_QA_DIR) throw new Error("LAW_PROGRESS_QA_DIR is required");
const output = path.resolve(process.env.LAW_PROGRESS_QA_DIR);
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
setTimeout(() => finish({ ok: false, error: "Task progress QA timed out" }), 30000);
app.whenReady().then(async () => {
  try {
    buildSync({
      entryPoints: [path.resolve(__dirname, "../tests/fixtures/taskProgress.jsx")],
      outfile: path.join(output, "renderer.js"), bundle: true, platform: "browser", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    fs.writeFileSync(path.join(output, "index.html"), '<!doctype html><title>Task progress regression</title><div id="root"></div><script src="renderer.js"></script>');
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, callback) => callback({ cancel: true }));
    await win.loadFile(path.join(output, "index.html"));
    finish(await win.webContents.executeJavaScript("window.runTaskProgressQA()"));
  } catch (error) {
    finish({ ok: false, error: error.message });
  }
});
