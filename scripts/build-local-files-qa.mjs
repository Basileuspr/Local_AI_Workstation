import {build} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await build({configFile:false,root,plugins:[react()],base:'./',build:{outDir:path.join(root,'tmp/local-files-qa'),emptyOutDir:true,
  rollupOptions:{input:path.join(root,'tests/fixtures/localFiles.html')}}});
