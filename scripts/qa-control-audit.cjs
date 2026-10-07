// Disposable, API-isolated Electron control inventory. Start the controls fixture first.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'law-control-audit-'));
app.setPath('userData',profile);
const destination=path.resolve(process.env.LAW_CONTROL_AUDIT_DIR || 'artifacts/control-audit');
fs.mkdirSync(destination,{recursive:true});
let win;
const watchdog=setTimeout(()=>app.exit(1),120000);
app.whenReady().then(async()=>{
  win=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  await win.loadURL('http://127.0.0.1:5298/tests/fixtures/workspaceControls.html');
  const js=code=>win.webContents.executeJavaScript(code);
  const frame=()=>js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const wait=async(code,label)=>{for(let i=0;i<200;i++){if(await js(code))return;await frame();}throw Error('Timed out: '+label);};
  await wait('document.querySelectorAll("[data-sidebar-route]").length>30','navigation');
  const routes=await js('[...document.querySelectorAll("[data-sidebar-route]")].map(n=>({id:n.dataset.sidebarRoute,label:n.textContent.trim()}))');
  const inventory=[];
  for(const route of routes){
    await js(`(()=>{if(document.querySelector('#app-navigation[inert]'))document.querySelector('.navigation-toggle').click();})()`);await frame();
    await js(`(()=>{const n=document.querySelector('[aria-label="Find a tab"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(route.label)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await frame();
    await js(`document.querySelector('[data-sidebar-route="${route.id}"]').click()`);await frame();
    await wait(`document.querySelector('[data-capture-tab="${route.id}"]:not([hidden])')?.clientHeight>0`,'pane '+route.id);
    await wait(`!document.querySelector('[data-capture-tab="${route.id}"]').textContent.trim().startsWith('Opening ')`,'workspace '+route.id);
    inventory.push(await js(`(()=>{
      const pane=document.querySelector('[data-capture-tab="${route.id}"]');
      const controls=[...pane.querySelectorAll('button,select,summary,input')].filter(n=>n.checkVisibility()&&!n.closest('dialog:not([open]),[hidden]')).filter(n=>{for(let p=n.parentElement;p&&p!==pane;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open&&!p.querySelector(':scope>summary')?.contains(n))return false;return true;}).map(n=>({kind:n.tagName.toLowerCase(),name:n.getAttribute('aria-label')||n.labels?.[0]?.textContent.trim()||n.textContent.trim()||n.placeholder||n.type,disabled:n.matches(':disabled')}));
      return {id:${JSON.stringify(route.id)},label:${JSON.stringify(route.label)},buttons:controls.filter(n=>n.kind==='button').length,controls};
    })()`));
  }
  const phase=process.env.LAW_CONTROL_AUDIT_PHASE || 'before';
  fs.writeFileSync(path.join(destination,phase+'.json'),JSON.stringify({viewport:[1280,720],routes:inventory,limitation:'Neutral empty fixtures; counts include scrollable controls and exclude closed panels. Native Media Manager is audited separately.'},null,2));
  console.log(JSON.stringify(inventory.map(({id,buttons})=>({id,buttons})).sort((a,b)=>b.buttons-a.buttons)));
  clearTimeout(watchdog);win.destroy();app.quit();
}).catch(error=>{console.error(error.stack||error);clearTimeout(watchdog);win?.destroy();app.exit(1);});
