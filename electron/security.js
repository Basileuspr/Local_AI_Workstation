const fs = require("node:fs");
const path = require("node:path");

// Node reports custom-scheme URL.origin as "null", even though Chromium gives
// our registered standard scheme an origin. Compare its parsed parts instead.
function trustedUrl(value, devUrl = null) {
    try {
        const url = new URL(value);
        if (url.username || url.password) return false;
        if (url.protocol === "app:") return url.hostname === "local" && !url.port;
        return Boolean(devUrl && url.origin === new URL(devUrl).origin && url.protocol === "http:");
    } catch { return false; }
}

function externalUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
            && !url.searchParams.has("law_token") && !url.searchParams.has("apiToken");
    } catch { return false; }
}

function appAsset(root, value) {
    if (!trustedUrl(value)) throw new Error("Untrusted application URL");
    const relative = decodeURIComponent(new URL(value).pathname).replace(/^\/+/, "") || "index.html";
    const target = path.resolve(root, relative);
    const inside = (base, child) => child.startsWith(base + path.sep);
    if (!inside(path.resolve(root), target) || !inside(fs.realpathSync(root), fs.realpathSync(target))) {
        throw new Error("Asset escapes application directory");
    }
    return target;
}

const APP_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*; media-src 'self' blob: http://localhost:* http://127.0.0.1:*; connect-src 'self' http://localhost:* http://127.0.0.1:*; object-src 'none'; frame-src 'self' about:; base-uri 'none'; form-action 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
};

module.exports = { trustedUrl, externalUrl, appAsset, APP_HEADERS };
