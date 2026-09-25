/**
 * Frontend runtime configuration.
 *
 * The renderer cannot read environment variables, so the backend's address has
 * to arrive another way. Electron appends `?apiPort=NNNN` when it loads the
 * page, because it is the process that chose the port. Everything else falls
 * back to the development default, which keeps `npm run vite` working with a
 * separately started backend.
 *
 * Resolution order:
 *   1. ?apiBase=http://127.0.0.1:port   loopback override for debugging
 *   2. ?apiPort=NNNN               what Electron passes
 *   3. http://127.0.0.1:8000       the development default
 */

export const DEFAULT_API_PORT = 8000;
export const DEFAULT_API_BASE = `http://127.0.0.1:${DEFAULT_API_PORT}`;

function readSearchParams() {
  if (typeof window === "undefined" || !window.location) return null;
  try {
    // Electron's loadFile puts the query on `search`; loadURL behaves the same.
    return new URLSearchParams(window.location.search || "");
  } catch {
    return null;
  }
}

export function resolveApiBase(params = readSearchParams()) {
  if (!params) return DEFAULT_API_BASE;

  const explicit = (params.get("apiBase") || "").trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) &&
          !url.username && !url.password && !url.search && !url.hash && url.pathname === "/") {
        return `http://127.0.0.1:${url.port || 80}`;
      }
    } catch { /* Fall back to the local API without sending credentials elsewhere. */ }
  }

  const port = Number(params.get("apiPort") || "");
  if (Number.isInteger(port) && port > 0 && port < 65536) {
    return `http://127.0.0.1:${port}`;
  }

  return DEFAULT_API_BASE;
}

export const API_BASE = globalThis.window?.workstationDesktop?.connection?.base || resolveApiBase();

/**
 * Per-launch credential proving a request came from this application window.
 *
 * Electron generates it, hands the same value to the backend as an environment
 * variable and to its own main frame through the preload bridge. It dies with
 * the process. Browser development may explicitly pass apiToken in its URL;
 * the desktop does not persist its credential in localStorage or its page URL.
 */
export function resolveApiToken(params = readSearchParams()) {
  return (params?.get("apiToken") || "").trim();
}

export const API_TOKEN = globalThis.window?.workstationDesktop?.connection?.token || resolveApiToken();
