import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
export default defineConfig({
  plugins: [react()],
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
});