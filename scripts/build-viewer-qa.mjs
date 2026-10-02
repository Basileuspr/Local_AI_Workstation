import {build} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await build({configFile:false,root,plugins:[react()],base:'./',worker:{format:'es'},build:{outDir:path.join(root,'tmp/viewer-hardening-qa'),emptyOutDir:true,
  rollupOptions:{input:{browser:path.join(root,'tests/fixtures/viewerBrowser.html'),model:path.join(root,'tests/fixtures/modelViewer.html')}}}});
