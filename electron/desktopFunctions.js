const path = require("node:path");
const { execFile } = require("node:child_process");
const { findWindowsProgram } = require("./windowsPrograms");

// Fixed actions only: renderer button labels and custom targets never become commands.
function runDesktopAction(action, { execute = execFile, platform = process.platform, systemRoot = process.env.SystemRoot || "C:\\Windows", environment = process.env } = {}) {
  if (platform !== "win32") return Promise.reject(new Error("This action requires Windows."));
  const executable = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  let args;
  if (action === "update-programs") {
    const winget = findWindowsProgram("winget.exe", environment);
    // Literal argument in an encoded child command supports spaces and apostrophes.
    const command = winget ? `& '${winget.replace(/'/g, "''")}' upgrade --all; Write-Host 'WinGet exit code:' $LASTEXITCODE` : "winget upgrade --all; Write-Host 'WinGet exit code:' $LASTEXITCODE";
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    args = ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${executable.replace(/'/g, "''")}' -ArgumentList '-NoProfile -NoExit -EncodedCommand ${encoded}' -WindowStyle Normal`];
  }
  else if (action === "open-powershell") args = ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${executable.replace(/'/g, "''")}' -ArgumentList '-NoProfile -NoExit' -WindowStyle Normal`];
  else if (action === "snipping-tool") args = ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; Start-Process 'ms-screenclip:'"];
  else if (action === "refresh-graphics") args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "refreshGraphics.ps1")];
  else return Promise.reject(new Error("Unknown desktop action."));
  return new Promise((resolve, reject) => {
    execute(executable, args, { windowsHide: true, timeout: 20000, maxBuffer: 64 * 1024 }, error => {
      if (error) reject(new Error(action === "update-programs" ? "Could not open WinGet. Check that App Installer is installed." : "Windows could not start the requested desktop action."));
      else resolve({ ok: true });
    });
  });
}

async function copyNativeImage(image, { clipboard, ClipboardItem }) {
  if (clipboard.writeImage) await clipboard.writeImage(image);
  else await clipboard.write([new ClipboardItem({ "image/png": new Blob([image.toPNG()], { type: "image/png" }) })]);
}

async function writeClipboardImage(dataUrl, { clipboard, nativeImage, ClipboardItem }) {
  if (typeof dataUrl !== "string" || dataUrl.length > 68 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) throw new Error("Invalid clipboard image.");
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("The image could not be decoded.");
  const size = image.getSize();
  if (size.width * size.height > 64 * 1024 * 1024) throw new Error("The image is too large to copy.");
  await copyNativeImage(image, { clipboard, ClipboardItem });
  return { ok: true, ...size };
}

module.exports = { runDesktopAction, writeClipboardImage, copyNativeImage };
