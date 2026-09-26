// Run with node_modules/.bin/electron scripts/qa-workspace-launchers.cjs.
// Isolated native smoke checks: never upgrades programs or opens the user's app.
const { app, shell } = require("electron");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const assert = require("node:assert/strict");
const { runDesktopAction } = require("../electron/desktopFunctions");
const { createProgramLaunchers } = require("../electron/programLaunchers");
const { desktopCapabilities } = require("../electron/compatibility");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "law-native-launchers-"));
app.setPath("userData", path.join(work, "profile"));
const run = promisify(execFile);
const quote = value => "'" + value.replace(/'/g, "''") + "'";
async function waitForFile(file) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim();
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Native launcher did not produce " + file);
}
app.whenReady().then(async () => {
  assert.equal(process.platform, "win32");
  const capabilities = desktopCapabilities({ mediaDirectory: work, python: "python.exe" });
  assert.equal(capabilities.features.program_updates.available, true);
  const versionFile = path.join(work, "winget-version.txt");
  await runDesktopAction("update-programs", { execute: (file, args, options, done) => {
    const original = args.at(-1), match = original.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/);
    assert(match);
    const inner = Buffer.from(match[1], "base64").toString("utf16le");
    assert(inner.includes(" upgrade --all;"));
    // Substitute ONLY the payload and window visibility for a harmless launch check.
    const harmless = inner.replace(" upgrade --all;", ` --version | Set-Content -LiteralPath ${quote(versionFile)} -Encoding UTF8;`) + "; exit";
    assert(!harmless.includes("upgrade"));
    const command = original.replace(match[1], Buffer.from(harmless, "utf16le").toString("base64")).replace("-WindowStyle Normal", "-WindowStyle Hidden");
    execFile(file, [...args.slice(0, -1), command], options, done);
  } });
  const version = await waitForFile(versionFile);
  assert.match(version, /^v?\d+\./);
  const powershellFile = path.join(work, "powershell.txt");
  await runDesktopAction("open-powershell", { execute: (file, args, options, done) => {
    const payload = `Set-Content -LiteralPath ${quote(powershellFile)} -Value 'opened' -Encoding UTF8; exit`;
    const command = args.at(-1).replace("'-NoProfile -NoExit'", `'-NoProfile -NoExit -EncodedCommand ${Buffer.from(payload, "utf16le").toString("base64")}'`).replace("-WindowStyle Normal", "-WindowStyle Hidden");
    execFile(file, [...args.slice(0, -1), command], { ...options, env: { ...process.env, Path: "", PATH: "" } }, done);
  } });
  assert.equal(await waitForFile(powershellFile), "opened");
  const source = path.join(work, "Fixture.cs"), program = path.join(work, "Fixture.exe"), marker = path.join(work, "program.txt");
  fs.writeFileSync(source, `class Fixture { static void Main() { System.IO.File.WriteAllText(@"${marker.replace(/"/g, '""')}", "opened"); } }`);
  const compiler = path.join(process.env.SystemRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  await run(compiler, ["/nologo", "/target:winexe", "/out:" + program, source], { windowsHide: true });
  const launchers = createProgramLaunchers({ file: path.join(work, "programs.json"), shell, getWindow: () => null,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [program] }) } });
  const selection = await launchers.choose();
  await launchers.open(selection.id);
  assert.equal(await waitForFile(marker), "opened");
  const result = { ok: true, wingetVersion: version, powershellWithoutPath: true, realShellOpenPath: true, evidence: work,
    limits: "Hidden harmless payloads; native picker selection substituted; Snipping Tool overlay not opened." };
  fs.writeFileSync(path.join(work, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
