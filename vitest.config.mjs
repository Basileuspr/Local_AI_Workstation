import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Separate from vite.config.mjs because that one sets `root: "src"` for the
// app build, which would hide the tests/ directory from the runner.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/frontend/**/*.test.{js,jsx}"],
    // Pure logic plus react-dom/server rendering — no DOM implementation needed.
    environment: "node",
  },
});
