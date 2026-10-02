import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react(),{name:'synthetic-preview',configureServer(server){server.middlewares.use((req,res,next)=>{if(/^\/image-manager\/images\/[^/]+\/(thumbnail|file)/.test(req.url))req.url='/tests/fixtures/generatePreview.svg';next();});}}],optimizeDeps:{entries:['tests/fixtures/fileSelection.html']},server:{host:'127.0.0.1',port:5191,strictPort:true}});
