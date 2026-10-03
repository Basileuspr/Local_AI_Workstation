import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import os from 'node:os';

// Synthetic timer/native-view fixture; no backend or user data is loaded.
const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(os.tmpdir(), 'law-clock-style-qa-' + Date.now());
await build({ configFile: false, root, plugins: [react()], base: '/',
  build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(root, 'tests/fixtures/workstationTime.html') } } });
const server = await preview({ configFile: false, root, build: { outDir },
  preview: { host: '127.0.0.1', port: 5197, strictPort: true } });
server.printUrls();
