"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function prepareBuild(root = path.resolve(__dirname, "..")) {
  const python = process.env.LAW_PYTHON || [path.join(root, "venv", "Scripts", "python.exe"),
    path.join(root, "venv", "bin", "python")].find(file => fs.existsSync(file));
  if (!python) throw new Error("Build capture requires the project Python environment. Complete setup or set LAW_PYTHON.");
  const result = spawnSync(python, ["-B", path.join(root, "scripts", "capture-app-review.py"), "--build",
    "--note", "Production build source capture"], { cwd: root, stdio: "inherit", windowsHide: true, shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Source capture failed; the production build was stopped.");
}

module.exports = { prepareBuild };
if (require.main === module) prepareBuild();
