"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function readBuildInfo(root = path.resolve(__dirname, ".."), { verifySources = true } = {}) {
  root = path.resolve(root);
  let version = "unavailable";
  try { version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || version; } catch {}
  const fallback = { app_version: version, package_version: version, build_id: null, source_status: "unrecorded",
    status_detail: "No valid build record. Run a production build to capture an identity." };
  try {
    const record = JSON.parse(fs.readFileSync(path.join(root, "build-info.json"), "utf8"));
    if (record.schema_version !== 1 || typeof record.build_id !== "string" || !record.build_id ||
        typeof record.app_version !== "string" || !/^[0-9a-f]{40}$/.test(record.source_commit || "") ||
        !/^[0-9a-f]{64}$/.test(record.source_fingerprint || "") || typeof record.source_dirty !== "boolean" ||
        !record.source_files || Array.isArray(record.source_files) || typeof record.source_files !== "object" ||
        !Object.keys(record.source_files).length || !record.captured_at_utc || !record.source_snapshot_id) return fallback;
    const { source_files } = record;
    const fields = ["schema_version", "app_version", "build_id", "release_status", "source_commit",
      "source_commit_author_at", "source_commit_at", "source_dirty", "source_change_count", "worktree_entry_count", "source_fingerprint",
      "source_snapshot_id", "captured_at", "captured_at_utc", "timezone", "environment", "dependencies", "date_basis", "validation"];
    const result = Object.fromEntries(fields.filter(key => key in record).map(key => [key, record[key]]));
    result.package_version = version;
    result.source_status = "captured";
    if (record.app_version !== version) {
      result.source_status = "version_mismatch";
      result.status_detail = "Package version differs from the captured build; rebuild before identifying this checkout as that build.";
    } else if (verifySources) {
      result.source_status = "recorded_files_match";
      for (const [name, digest] of Object.entries(source_files)) {
        let matches = false;
        try {
          const target = fs.realpathSync(path.resolve(root, name));
          const normalized = Buffer.from(fs.readFileSync(target).toString("latin1").replace(/\r\n/g, "\n"), "latin1");
          matches = target.startsWith(root + path.sep) && typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest) &&
            createHash("sha256").update(normalized).digest("hex") === digest;
        } catch {}
        if (!matches) {
          result.source_status = "changed_since_capture";
          result.status_detail = "Recorded source files differ or are unavailable. The identifier describes the saved capture; rebuild to capture current source.";
          break;
        }
      }
    }
    return result;
  } catch { return fallback; }
}

module.exports = { readBuildInfo };
