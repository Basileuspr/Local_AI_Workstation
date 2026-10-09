import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { realpathSync } from 'node:fs';
const root = realpathSync(process.cwd());
export default defineConfig({ root, assetsInclude: ['**/*.bin'], plugins: [react()], base: './', build: {
  outDir: path.join(root, 'artifacts/mini-piano/audio-fixture-build'), emptyOutDir: true,
  rollupOptions: { input: path.join(root, 'tests/fixtures/pianoAudio.html') } } });
