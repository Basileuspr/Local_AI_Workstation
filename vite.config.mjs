import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { prepareBuild } = require("./scripts/prepare-build.cjs");
const { readBuildInfo } = require("./electron/buildInfo.js");
export default defineConfig(({ command }) => {
  if (command === "build") prepareBuild(__dirname);
  const build = readBuildInfo(__dirname, { verifySources: false });
  const rendererIdentity = Object.fromEntries(["app_version", "build_id", "source_commit", "source_dirty", "captured_at_utc"].map(key => [key, build[key] ?? null]));
  return {
  plugins: [react(), {
    name: "law-build-identity",
    generateBundle() {
      const verified = readBuildInfo(__dirname);
      if (verified.build_id !== build.build_id || verified.source_status !== "recorded_files_match")
        this.error("Captured source changed during compilation. Finish source edits, then rebuild to record a matching identity.");
      this.emitFile({ type: "asset", fileName: "build-info.json", source: JSON.stringify(build, null, 2) + "\n" });
    },
  }],
  define: { __LAW_BUILD_INFO__: JSON.stringify(rendererIdentity) },
  root: "src",
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: Number.parseInt(process.env.LAW_VITE_PORT || "", 10) || 5173,
    strictPort: true,
    // Loopback by default: the dev server exposes source and proxies nothing
    // that should reach the LAN. Set LAW_VITE_HOST=0.0.0.0 to share it
    // deliberately, e.g. when testing from another device.
    host: process.env.LAW_VITE_HOST || "127.0.0.1",
  },
  };
});
