import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";

export default defineConfig({
  plugins: [react(), { name: "tool-registry-fixture", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const name = { "/__fixture/registry.json": "registry.json", "/__fixture/registry.md": "registry.md" }[request.url];
      if (!name) return next();
      if (!process.env.LAW_REGISTRY_FIXTURE_DIR) { response.statusCode = 503; response.end("Set LAW_REGISTRY_FIXTURE_DIR to an exported test catalog."); return; }
      response.setHeader("Content-Type", name.endsWith("json") ? "application/json" : "text/plain; charset=utf-8");
      response.end(readFileSync(path.join(process.env.LAW_REGISTRY_FIXTURE_DIR, name)));
    });
  } }],
  optimizeDeps: { entries: ["tests/fixtures/toolRegistry.html"] },
  server: { host: "127.0.0.1", port: 5187, strictPort: true },
});
