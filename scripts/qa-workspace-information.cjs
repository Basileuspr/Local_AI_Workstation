// Real Electron layout and dialogs, isolated from saved app data and services.
const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {appAsset,APP_HEADERS}=require('../electron/security');
const root=path.resolve(__dirname,'..'),work=fs.mkdtempSync(path.join(os.tmpdir(),'law-workspace-info-qa-'));
app.setPath('userData',path.join(work,'profile'));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win;const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checks=[];
const timeout=setTimeout(()=>app.exit(1),120000);
app.whenReady().then(async()=>{
  const {build}=await import('vite'),react=(await import('@vitejs/plugin-react')).default;
  await build({configFile:false,root,base:'./',plugins:[react()],logLevel:'error',build:{outDir:path.join(work,'dist'),emptyOutDir:true,rollupOptions:{input:path.join(root,'tests/fixtures/workspaceInfo.html')}}});
  protocol.handle('app',request=>{const file=appAsset(path.join(work,'dist'),request.url);return new Response(fs.readFileSync(file),{headers:{...APP_HEADERS,'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)]||'application/octet-stream')}});});
  win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}));
  const js=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){throw Error(`${error.message}\n${code}`);}};
  const until=async(code,label)=>{for(let i=0;i<200;i++){if(await js(code))return;await sleep(25);}throw Error('Timed out: '+label);};
  const capture=async name=>{for(let i=0;i<3;i++){win.webContents.invalidate();await sleep(140);}fs.writeFileSync(path.join(work,name),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());};
  await win.loadURL('app://local/tests/fixtures/workspaceInfo.html');
  await until(`!!document.querySelector('nav[aria-label="Preview workspaces"]')`,'fixture');
  const tabs=await js(`[...document.querySelectorAll('nav[aria-label="Preview workspaces"] button')].map(b=>b.textContent).filter(t=>t!=="Pin reference in preview")`);
  assert.equal(tabs.length,34);
  for(const label of tabs){
    await js(`[...document.querySelectorAll('nav[aria-label="Preview workspaces"] button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
    await until(`document.querySelector('.workspace-navigation .workspace-info-button')?.getAttribute('aria-label')===${JSON.stringify((label==='Chat'?'Chats':label)+' information')}`,label);
    await js("document.querySelector('.workspace-navigation .workspace-info-button').click()");
    const result=await js(`(()=>{const d=document.querySelector('.workspace-navigation .workspace-info-dialog');return {open:d.open,paragraphs:d.querySelectorAll('p').length,entries:d.querySelectorAll('dt').length,text:d.innerText,overflow:d.scrollWidth>d.clientWidth+1};})()`);
    assert(result.open,label);assert.equal(result.paragraphs,0,label);assert(result.entries>15,label);assert(!result.overflow,label);
    if(label==='Chat'){for(const term of ['Chat model','Temperature','Tools and tool calls','Automatic tool execution is not connected'])assert(result.text.includes(term));await capture('chat-information.png');}
    if(label==='Image Manager'){assert(result.text.includes('Name / Save name'));await capture('image-manager-information.png');}
    if(label==='Media Manager')assert(await js('document.body.textContent.includes("Embedded view covered by dialog")'));
    await js("document.querySelector('.workspace-navigation .workspace-info-heading button').click()");
    await until("document.activeElement===document.querySelector('.workspace-navigation .workspace-info-button')",'return focus');
  }
  checks.push('All 34 real AppLayout information buttons open their scoped guides with individual entries, no paragraph blocks, no horizontal overflow, and focus restoration');
  await js("[...document.querySelectorAll('nav[aria-label=\"Preview workspaces\"] button')].find(b=>b.textContent==='Chat').click()");
  await until("document.querySelector('.workspace-navigation .workspace-info-button')?.getAttribute('aria-label')==='Chats information'",'chat');
  await js("document.querySelector('[aria-label=\"chats draft\"]').value='Keep this neutral draft';document.querySelector('.workspace-navigation .workspace-info-button').click()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await until("!document.querySelector('.workspace-navigation .workspace-info-dialog').open",'Escape closes');
  assert.equal(await js("document.querySelector('[aria-label=\"chats draft\"]').value"),'Keep this neutral draft');
  await js("[...document.querySelectorAll('nav[aria-label=\"Preview workspaces\"] button')].find(b=>b.textContent==='Pin reference in preview').click()");
  await until("!!document.querySelector('.pinned-pane-heading .workspace-info-button')",'pinned information');
  await js("document.querySelector('.pinned-pane-heading .workspace-info-button').click()");
  assert((await js("document.querySelector('.pinned-pane-heading .workspace-info-dialog').innerText")).includes('Application folders'));
  await js("document.querySelector('.pinned-pane-heading .workspace-info-heading button').click()");
  win.setSize(620,820);
  await js("document.querySelector('.workspace-navigation .workspace-info-button').click()");
  await sleep(100);
  assert(await js("(()=>{const d=document.querySelector('.workspace-navigation .workspace-info-dialog');return d.scrollWidth<=d.clientWidth+1})()"));
  await capture('chat-information-narrow.png');
  checks.push('Escape preserves the chat draft; pinned workspace has its own guide; Media Manager is covered while Info is open; narrow dialog fits');
  fs.writeFileSync(path.join(work,'report.json'),JSON.stringify({ok:true,checks,tabs},null,2));
  console.log(JSON.stringify({ok:true,checks,artifacts:work},null,2));
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{clearTimeout(timeout);win?.destroy();app.exit(process.exitCode||0);});
