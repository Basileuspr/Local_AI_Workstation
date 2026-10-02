import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], optimizeDeps: { entries: ["tests/fixtures/sidebarNavigationSizing.html"] }, server: { host: "127.0.0.1", port: 5289, strictPort: true, watch: { ignored: ["**/artifacts/**", "**/docs/**", "**/dist/**"] } } });
