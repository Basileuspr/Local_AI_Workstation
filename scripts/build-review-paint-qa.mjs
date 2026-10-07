import {build} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
await build({configFile:false,root,plugins:[react()],base:'./',worker:{format:'es'},build:{outDir:path.join(root,'tmp/review-paint-qa'),emptyOutDir:true,rollupOptions:{input:[path.join(root,'tests/fixtures/paint.html'),path.join(root,'tests/fixtures/visualReview.html'),path.join(root,'tests/fixtures/videoReview.html')]}}});
