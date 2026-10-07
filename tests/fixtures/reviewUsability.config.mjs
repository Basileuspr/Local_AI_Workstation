import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({root:process.cwd(),plugins:[react()],server:{host:'127.0.0.1',port:5197,strictPort:true},
  build:{outDir:'tmp/review-usability-ui',emptyOutDir:false,rollupOptions:{input:'tests/fixtures/reviewUsability.html'}}});
