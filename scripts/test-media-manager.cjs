const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const venv = path.join(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.LAW_PYTHON || (fs.existsSync(venv) ? venv : "python");
const cwd = path.join(root, "media-manager");
for (const [command, args] of [
    [python, ["-B", "-m", "unittest", "discover", "-s", "tests", "-t", "."]],
    [process.execPath, ["--test", "tests/library.test.mjs", "tests/playback.test.mjs"]],
]) {
    const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) process.exit(result.status || 1);
}
