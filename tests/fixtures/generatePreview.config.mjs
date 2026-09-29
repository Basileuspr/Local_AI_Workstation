import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
export default defineConfig({
  plugins:[react(), {name:'fixture-saved-images',configureServer(server) {
    let failNext = false;
    server.middlewares.use((request,response,next) => {
      if (request.url === '/__fixture/fail-next-preview') { failNext = true; response.end('ok'); return; }
      if (!request.url.startsWith('/sessions/fixture-chat/images/by-id/')) return next();
      if (failNext) { failNext = false; response.statusCode = 503; response.end('Fixture image failure'); return; }
      response.setHeader('Content-Type','image/svg+xml');
      response.end(readFileSync(new URL('./generatePreview.svg',import.meta.url)));
    });
  }}],
  optimizeDeps:{entries:['tests/fixtures/generatePreview.html','tests/fixtures/generationPersistence.html']},
  server:{host:'127.0.0.1',port:5179,strictPort:true},
});
