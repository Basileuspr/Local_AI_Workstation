import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const { mobileVersion } = createRequire(import.meta.url)("../scripts/mobile-build.cjs");
const project = fileURLToPath(new URL("..", import.meta.url));
const version = mobileVersion(project), base = `/releases/${version}/`;

// A separate build avoids loading desktop IPC and leaves its bundle untouched.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base,
  define: { __LAW_MOBILE_VERSION__: JSON.stringify(version) },
  plugins: [react(), {
    name: "mobile-shell-worker",
    generateBundle(_options, bundle) {
      if (mobileVersion(project) !== version) this.error("Phone source changed during the build. Wait for edits to finish and retry.");
      const publicFiles = ["icon.svg", "icon-192.png", "icon-512.png", "manifest.webmanifest"];
      const assets = ["index.html", ...publicFiles, ...Object.keys(bundle).filter(name => name.startsWith("assets/"))].map(name => base + name);
      const worker = `
const CACHE = 'law-mobile-${version}';
const SHELL = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
// Immutable release URLs let old pages keep running when a new worker activates.
// Applying an update is a separate phone action; activation never reloads a draft.
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  const shell = url.pathname === '/' || url.pathname === '/index.html';
  if (!shell && !SHELL.includes(url.pathname)) return;
  const target = shell ? ${JSON.stringify(base + 'index.html')} : event.request;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(target)) || fetch(target)));
});
`;
      this.emitFile({ type: "asset", fileName: "sw.js", source: worker });
    },
    writeBundle(options, bundle) {
      // Vite finalizes index.html after generateBundle hooks. Hash the actual
      // output, including copied public files, only after those writes finish.
      if (mobileVersion(project) !== version) this.error('Phone source changed during the build. Retry after edits finish.');
      const names = new Set(['index.html', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', ...Object.keys(bundle)]);
      const files = Object.fromEntries([...names].map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(options.dir, name))).digest('hex')]));
      fs.writeFileSync(path.join(options.dir, 'client-version.json'), JSON.stringify({version, files}) + '\n');
    },
  }],
  build: { outDir: fileURLToPath(new URL("../dist/mobile", import.meta.url)), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
