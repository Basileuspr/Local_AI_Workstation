import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], worker: { format: 'es' },
  optimizeDeps: { entries: ['tests/fixtures/workspaceControls.html', 'tests/fixtures/workspaceControlsMedia.html'] },
  server: { host: '127.0.0.1', port: 5298, strictPort: true,
    watch: { ignored: ['**/artifacts/**', '**/docs/**', '**/dist/**'] } },
});
