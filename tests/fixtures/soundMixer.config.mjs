import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({plugins:[react()],base:'./',build:{outDir:'artifacts/sound-mixer/fixture-build',emptyOutDir:true,rollupOptions:{input:path.resolve('tests/fixtures/soundMixer.html')}}});
