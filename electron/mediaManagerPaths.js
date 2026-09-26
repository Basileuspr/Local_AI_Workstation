const fs = require("node:fs");
const path = require("node:path");

// Code ships with the workstation. Reports and media remain private runtime data.
function mediaManagerPaths({ root, desktop, userData, environment = process.env, isDirectory = value => {
    try { return fs.statSync(value).isDirectory(); } catch { return false; }
} }) {
    const directory = environment.LAW_MEDIA_MANAGER_DIR || path.join(root, "media-manager");
    const legacyReports = path.join(desktop, "Media Organizer", "runs");
    const reports = environment.LAW_MEDIA_MANAGER_REPORTS
        || (environment.LAW_MEDIA_MANAGER_DIR ? path.join(directory, "runs")
            : isDirectory(legacyReports) ? legacyReports : path.join(userData, "media-manager", "runs"));
    return { directory, reports };
}

module.exports = { mediaManagerPaths };
