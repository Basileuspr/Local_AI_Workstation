import {build} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
const root=fs.realpathSync(process.cwd());
// Deliberately separate from production build identity/source-capture hooks.
// These diagnostic outputs must never replace dist or a packaged application.
await build({configFile:false,plugins:[react()],root,base:'./',build:{
  outDir:path.join(root,'tmp/viewer-hardening-qa'),emptyOutDir:true,
  rollupOptions:{input:[path.join(root,'tests/fixtures/viewerBrowser.html'),path.join(root,'tests/fixtures/reels.html'),path.join(root,'tests/fixtures/web.html')]},
}});
await build({configFile:false,plugins:[react()],root:path.join(root,'src'),base:'./',worker:{format:'es'},
  assetsInclude:['**/*.bin'],
  define:{__LAW_BUILD_INFO__:JSON.stringify({build_id:'browser-foundation-diagnostic'})},
  build:{outDir:path.join(root,'tmp/browser-foundation-app-compile'),emptyOutDir:true},
});
