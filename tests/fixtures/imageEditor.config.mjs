import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({
  root: path.resolve(import.meta.dirname, '../..'), plugins: [react()], base: './', worker: { format: 'es' },
  build: { outDir: 'tmp/image-editor-crop-qa', emptyOutDir: true, rollupOptions: { input: 'tests/fixtures/imageEditor.html' } },
});
