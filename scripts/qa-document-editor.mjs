// Independent build/preview: never empties live dist or rewrites build identity.
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(os.tmpdir(), 'law-document-editor-qa', 'build');
if (process.argv.includes('--serve')) {
  const fixtureDir = path.join(os.tmpdir(), 'law-document-editor-qa', 'fixture');
  await build({ configFile: false, root, plugins: [react()], base: '/', build: { outDir: fixtureDir, emptyOutDir: true,
    rollupOptions: { input: path.join(root, 'tests/fixtures/documentEditor.html') } } });
  await preview({ configFile: false, root, build: { outDir: fixtureDir },
    preview: { host: '127.0.0.1', port: 5176, strictPort: true } });
  console.log('Editor fixture: http://127.0.0.1:5176/tests/fixtures/documentEditor.html?apiPort=8016&apiToken=editor-qa-token');
} else {
  await build({ configFile: false, root: path.join(root, 'src'), plugins: [react()], base: './',
    define: { __LAW_BUILD_INFO__: 'null' }, build: { outDir, emptyOutDir: true } });
  console.log(`Isolated application build: ${outDir}`);
}
