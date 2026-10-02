import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], optimizeDeps: { entries: ['tests/fixtures/thinkingTrace.html'] }, server: { host: '127.0.0.1', port: 5189, strictPort: true } });
