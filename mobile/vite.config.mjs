import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// A separate build avoids loading desktop IPC and leaves its bundle untouched.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), {
    name: "mobile-shell-worker",
    generateBundle(_options, bundle) {
      const assets = ["/", "/index.html", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", ...Object.keys(bundle).filter(name => name.startsWith("assets/")).map(name => "/" + name)];
      const version = createHash("sha256").update(JSON.stringify(bundle)).digest("hex").slice(0, 16);
      this.emitFile({ type: "asset", fileName: "sw.js", source: `
const CACHE = 'law-mobile-${version}';
const SHELL = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('law-mobile-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !SHELL.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
` });
    },
  }],
  build: { outDir: fileURLToPath(new URL("../dist/mobile", import.meta.url)), emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
});
