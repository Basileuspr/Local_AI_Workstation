import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const server=await createServer({configFile:false,root,plugins:[react()],server:{host:'127.0.0.1',port:5419,strictPort:true}});
await server.listen();
console.log('Generation recovery fixture: http://127.0.0.1:5419/tests/fixtures/generationHardening.html');
