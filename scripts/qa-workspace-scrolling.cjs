// Real Electron layout QA with the API-isolated workspaceControls fixture.
// Start its Vite server first; all API responses and the profile are disposable.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-workspace-scrolling-'));
app.setPath('userData',path.join(work,'profile'));
let win;
const watchdog=setTimeout(()=>app.exit(1),120000);
app.whenReady().then(async()=>{
  win=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error')console.error('Renderer: '+event.message);});
  await win.loadURL(process.env.LAW_SCROLL_QA_URL || 'http://127.0.0.1:5298/tests/fixtures/workspaceControls.html');
  const js=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){console.error('QA operation: '+code);throw error;}};
  const frame=()=>js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const settle=()=>new Promise(resolve=>setTimeout(resolve,350));
  const wait=async(code,label)=>{for(let i=0;i<200;i++){if(await js(code))return;await frame();}throw Error('Timed out: '+label);};
  await wait('document.querySelectorAll("[data-sidebar-route]").length>30','navigation');
  const routes=await js('[...document.querySelectorAll("[data-sidebar-route]")].map(n=>({id:n.dataset.sidebarRoute,label:n.textContent.trim()}))');
  async function navigate(route){
    await js(`(()=>{if(document.querySelector('#app-navigation[inert]'))document.querySelector('.navigation-toggle').click();})()`);await frame();
    await js(`(()=>{const n=document.querySelector('[aria-label="Find a tab"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(route.label)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await frame();
    await js(`document.querySelector('[data-sidebar-route="${route.id}"]').click()`);await frame();
    await wait(`document.querySelector('[data-capture-tab="${route.id}"]:not([hidden])')?.clientHeight>0`,'pane '+route.id);
    await wait(`!document.querySelector('[data-capture-tab="${route.id}"]').textContent.trim().startsWith('Opening ')`,'workspace '+route.id);
  }
  const measure=tab=>js(`(()=>{
    const pane=document.querySelector('[data-capture-tab="${tab}"]'),bounds=pane.getBoundingClientRect();
    const scrollParents=n=>{const parents=[];for(let p=n.parentElement;p&&p!==pane.parentElement;p=p.parentElement)parents.push(p);return parents;};
    const inScroll=n=>scrollParents(n).some(p=>{const r=p.getBoundingClientRect();return ['auto','scroll'].includes(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight+2&&r.top>=bounds.top-2&&r.bottom<=bounds.bottom+2;});
    const clipped=[...pane.querySelectorAll('button,input,select,summary')].filter(n=>n.getClientRects().length&&!n.closest('dialog,[hidden]')).filter(n=>{const r=n.getBoundingClientRect();return (r.bottom>bounds.bottom+2||r.top<bounds.top-2)&&!inScroll(n);}).map(n=>n.getAttribute('aria-label')||n.textContent.trim()||n.placeholder||n.type);
    return {tab:${JSON.stringify(tab)},width:Math.round(bounds.width),height:Math.round(bounds.height),paneScroll:pane.scrollHeight,roots:[...pane.children].filter(n=>n.getClientRects().length).map(n=>({class:n.className,height:n.clientHeight,scroll:n.scrollHeight,overflow:getComputedStyle(n).overflowY})),clipped};
  })()`);
  const results=[];
  for(const [width,height] of [[1280,720],[1280,480],[768,500],[390,660]]){
    win.setContentSize(width,height);await frame();
    for(const route of routes){
      await navigate(route);
      await js(`(()=>{const pane=document.querySelector('[data-capture-tab="${route.id}"]');for(const n of pane.querySelectorAll('details:not([open])>summary,.sm-effects>button[aria-expanded="false"]'))if(n.getClientRects().length&&!n.closest('[hidden],dialog'))n.click();})()`);await frame();
      const result={viewport:[width,height],...await measure(route.id)};results.push(result);
      if(result.clipped.length)console.log(JSON.stringify(result));
    }
  }
  const checks=[];
  fs.writeFileSync(path.join(work,'layout-audit.json'),JSON.stringify(results,null,2));
  for(const id of ['sound-mixer','styling-library','folder-review']){
    win.setContentSize(1280,480);await frame();await navigate(routes.find(route=>route.id===id));
    if(id==='sound-mixer')await js("document.querySelector('[aria-label=\"Speech channel\"] .sm-effects>button').click()");
    const selector=id==='sound-mixer'?'.sm-workspace':id==='styling-library'?'.styling-library':'.folder-review-workspace';
    const rect=await js(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return {x:r.right-30,y:r.top+50,top:r.top,bottom:r.bottom,pageTop:document.documentElement.scrollTop};})()`);
    assert.equal(rect.pageTop,0,'focus keeps the application in the viewport');
    win.webContents.focus();
    win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(rect.x),y:Math.round(rect.y)});
    await settle();
    console.log(JSON.stringify({wheelTarget:id,rect,hit:await js(`document.elementFromPoint(${Math.round(rect.x)},${Math.round(rect.y)})?.outerHTML.slice(0,120)`)}));
    win.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(rect.x),y:Math.round(rect.y),deltaY:-600,deltaX:0,canScroll:true,phase:'began'});
    await wait(`document.querySelector('${selector}').scrollTop>0`,'wheel scroll '+id);
    win.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(rect.x),y:Math.round(rect.y),deltaY:0,deltaX:0,phase:'ended'});
    await settle();
    const scroll=await js(`(()=>{const n=document.querySelector('${selector}');return {top:n.scrollTop,height:n.clientHeight,content:n.scrollHeight};})()`);
    checks.push({tab:id,wheelScroll:scroll});
    if(id==='sound-mixer')fs.writeFileSync(path.join(work,'sound-mixer-scrolled.png'),(await win.webContents.capturePage()).toPNG());
    if(id==='styling-library'){
      await js("[...document.querySelectorAll('.sl-example-content>button')].at(-1).click()");await frame();
      assert(await js("document.querySelector('.sl-code-dialog').open"),'code dialog opens from last gallery item');
      const dialog=await js("(()=>{const n=document.querySelector('.sl-code-dialog');return {height:n.clientHeight,content:n.scrollHeight,bottom:n.getBoundingClientRect().bottom,viewport:innerHeight};})()");
      assert(dialog.bottom<=dialog.viewport,'dialog stays in viewport');checks.push({codeDialog:dialog});
      assert.equal(await js("document.documentElement.scrollTop"),0,'opening a distant example preserves the app viewport');
      await js("document.querySelector('[aria-label=\"Close example code\"]').click()");await frame();
      fs.writeFileSync(path.join(work,'styling-library-scrolled.png'),(await win.webContents.capturePage()).toPNG());
    }
    if(id==='folder-review'){
      const before=scroll.top;await navigate(routes.find(route=>route.id==='audio'));await navigate(routes.find(route=>route.id===id));
      assert.equal(await js("document.querySelector('.folder-review-workspace').scrollTop"),before,'tab scroll retained');
      checks.push({tab:id,retainedScroll:true});
    }
  }
  for(const id of ['sound-mixer','styling-library']){
    win.setContentSize(1280,720);await frame();await navigate(routes.find(route=>route.id===id));
    await js("document.querySelector('[aria-label=\"Workspace options\"]').click()");await frame();
    await js("[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Pin beside chat').click()");await frame();
    const pinned=await measure(id);checks.push({pinned:true,...pinned});
    assert.equal(pinned.clipped.length,0,'pinned actions reachable '+id);
    assert(await js(`document.querySelector('[data-capture-tab="${id}"] .pinned-pane-heading').getBoundingClientRect().bottom<=document.querySelector('[data-capture-tab="${id}"]').getBoundingClientRect().bottom`),'pin heading visible');
    await js("document.querySelector('[aria-label=\"Close side pane\"]').click()");await frame();
  }
  const problems=results.filter(result=>result.clipped.length);
  const report={passed:problems.length===0,routeCount:routes.length,layoutChecks:results.length,results,checks,work};
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,routeCount:routes.length,layoutChecks:results.length,checks:checks.length,problems:problems.map(p=>({tab:p.tab,viewport:p.viewport,clipped:p.clipped})),work}));
  assert.equal(problems.length,0,'All expanded tab actions need a scroll path');
  clearTimeout(watchdog);win.destroy();app.quit();
}).catch(error=>{console.error(error.stack||error);clearTimeout(watchdog);win?.destroy();app.exit(1);});
