import {build,preview} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..');
const outDir=path.join(os.tmpdir(),'law-linked-apps-qa-'+Date.now());
if(process.argv.includes('--serve')) {
  await build({configFile:false,root,plugins:[react()],base:'/',build:{outDir,emptyOutDir:true,rollupOptions:{input:path.join(root,'tests/fixtures/linkedApps.html')}}});
  const server=await preview({configFile:false,root,build:{outDir},preview:{host:'127.0.0.1',port:5196,strictPort:true}});server.printUrls();
} else {
  await build({configFile:false,root:path.join(root,'src'),plugins:[react()],base:'./',build:{outDir,emptyOutDir:true}});
  console.log('Isolated application build: '+outDir);
}
