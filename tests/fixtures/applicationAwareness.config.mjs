import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import os from 'node:os';
import path from 'node:path';

const fixtureBuild = process.env.LAW_QA_FIXTURES === '1';
export default defineConfig(({ command }) => ({
  root: command === 'build' && !fixtureBuild ? 'src' : '.',
  plugins: [react()],
  cacheDir: path.join(os.tmpdir(), `law-awareness-vite-${process.pid}`),
  optimizeDeps: { entries: ['tests/fixtures/applicationAwareness.html', 'tests/fixtures/chatStartup.html'] },
  server: { host: '127.0.0.1', port: 5289, strictPort: true },
  build: { outDir: path.join(os.tmpdir(), fixtureBuild ? 'law-awareness-fixture-build' : 'law-awareness-build'), emptyOutDir: true,
    rollupOptions: { input: fixtureBuild ? [path.resolve('tests/fixtures/chatStartup.html'), path.resolve('tests/fixtures/applicationAwareness.html')] : path.resolve('src/index.html') } },
}));
