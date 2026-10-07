// Real Chromium menu, selector and draft checks with disposable fake services.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'law-control-actions-')));
const destination=path.resolve('artifacts/control-audit');fs.mkdirSync(destination,{recursive:true});
let win;const watchdog=setTimeout(()=>app.exit(1),120000);
app.whenReady().then(async()=>{
  win=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',event=>{if(event.level==='error')console.error('Renderer: '+event.message);});
  await win.loadURL('http://127.0.0.1:5298/tests/fixtures/controlAudit.html');
  const js=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){console.error('QA operation: '+code);throw error;}};
  const frame=()=>js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const wait=async(code,label)=>{for(let i=0;i<250;i++){if(await js(code))return;await frame();}throw Error('Timed out: '+label);};
  const checks=[];
  const verify=async(code,label)=>{assert(await js(code),label);checks.push(label);};
  await wait('document.querySelectorAll("[data-sidebar-route]").length>30','navigation');
  const routes=await js('[...document.querySelectorAll("[data-sidebar-route]")].map(n=>({id:n.dataset.sidebarRoute,label:n.textContent.trim()}))');
  async function navigate(id){
    const route=routes.find(route=>route.id===id);
    await js("if(document.querySelector('#app-navigation[inert]'))document.querySelector('.navigation-toggle').click()");await frame();
    await js(`(()=>{const n=document.querySelector('[aria-label="Find a tab"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(route.label)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await frame();
    await js(`document.querySelector('[data-sidebar-route="${id}"]').click()`);await frame();
    await wait(`document.querySelector('[data-capture-tab="${id}"]:not([hidden])')?.clientHeight>0 && !document.querySelector('[data-capture-tab="${id}"]').textContent.trim().startsWith('Opening ')`,'pane '+id);
  }
  const pane=id=>`document.querySelector('[data-capture-tab="${id}"]')`;
  async function click(id,label){await js(`[...${pane(id)}.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(label)}).click()`);await frame();}
  async function select(selector,value){await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await frame();}
  async function fill(selector,value){await js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`);await frame();}
  await navigate('tools');
  await verify(`document.querySelector('[aria-label="Tab to capture"]').options.length===${routes.length}`,'every tab remains available for capture');
  await select('[aria-label="Tab to capture"]','capture:sound-mixer');
  await verify("!document.querySelector('[data-control-audit-log]')",'selecting a capture target does not execute it');
  await click('tools','Capture tab');
  await verify("document.querySelector('[aria-label=\"Tab to capture\"]').disabled",'capture selector locks while an action is pending');
  await wait("document.querySelector('[data-control-audit-log]')?.textContent==='Captured sound-mixer'",'capture callback');
  await verify("!document.querySelector('[aria-label=\"Tab to capture\"]').disabled",'capture controls recover after completion');
  await select('[aria-label="Function template"]','Open Sound settings');
  await verify("!document.querySelector('.function-sequence-editor')",'template selection does not open or run a function');
  await click('tools','Use template');
  await verify("document.querySelector('.function-sequence-editor input').value==='Open Sound settings' && document.querySelectorAll('.function-step-list>li').length===2",'Use template opens the selected sequence as a draft');
  await click('tools','Cancel');
  await js("document.querySelector('.function-custom .action-menu-trigger').focus()");
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});await frame();
  await verify("document.activeElement.textContent==='Edit' && document.querySelector('.function-custom .action-menu-trigger').getAttribute('aria-expanded')==='true'",'ArrowDown opens options and focuses the first enabled action');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});await frame();
  await verify("document.activeElement.textContent==='Duplicate'",'arrow keys move between menu actions');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await frame();
  await verify("!document.querySelector('.function-custom .action-menu-panel').matches(':popover-open') && document.activeElement.classList.contains('action-menu-trigger')",'Escape closes the menu and restores trigger focus');
  await click('tools','Function options ⌄');await click('tools','Edit');
  await verify("document.querySelector('.function-sequence-editor input').value==='Preview function' && !document.querySelector('.function-custom .action-menu-panel').matches(':popover-open')",'Edit executes the retained action and closes its menu');
  await click('tools','Function options ⌄');
  await verify("[...document.querySelector('.function-custom .action-menu-panel').querySelectorAll('button')].slice(0,2).every(n=>n.disabled)",'disabled Edit and Duplicate stay disabled while editing');
  await click('tools','Cancel');
  await navigate('generate');
  await fill('form[aria-label="Image generation controls"] textarea','A neutral sample prompt');
  await fill('[aria-label="Steps"]','24');
  await js("document.querySelector('.image-number-shortcuts>summary').click()");await frame();
  await click('generate','+5');
  await verify("document.querySelector('[aria-label=\"Steps\"]').value==='29'",'folded numeric shortcuts retain their adjustment behavior');
  await js("document.querySelector('.image-number-shortcuts>summary').click()");await frame();
  await click('generate','Tab options ⌄');await click('generate','Tab options ⌄');
  await verify("document.querySelector('[aria-label=\"Steps\"]').value==='29' && document.querySelector('form[aria-label=\"Image generation controls\"] textarea').value==='A neutral sample prompt'",'closing controls retains numeric values and prompt drafts');
  await navigate('html-viewer');
  await fill('[aria-label="HTML source"]','<h1>Preview draft</h1>');
  await click('html-viewer','Preview');
  await verify("document.querySelector('iframe[title=\"HTML preview\"]').getAttribute('sandbox')===''",'Preview retains the sandbox boundary');
  await click('html-viewer','Edit source');
  await verify("document.querySelector('[aria-label=\"HTML source\"]').value==='<h1>Preview draft</h1>'",'preview toggle preserves edited source');
  await navigate('image-manager');
  await wait("document.querySelector('[aria-label=\"Select Preview.png\"]')",'sample catalog');
  await verify("!document.querySelector('.im-selection .action-menu')",'selection actions are absent until images are selected');
  await js("document.querySelector('[aria-label=\"Select Preview.png\"]').click()");await frame();
  await verify("document.querySelector('.im-selected-tags') && !document.querySelector('.im-selected-tags').open",'tagging tools appear collapsed after selection');
  await js("document.querySelector('.im-selected-tags>summary').click()");await frame();
  await fill('[aria-label="Selected image tags"]','Draft tag');
  await js("document.querySelector('.im-selected-tags>summary').click();document.querySelector('.im-selected-tags>summary').click()");await frame();
  await verify("document.querySelector('[aria-label=\"Selected image tags\"]').value==='Draft tag'",'tag drafts survive collapsing and reopening');
  await click('image-manager','Selection options ⌄');await click('image-manager','Favorite');
  await wait("document.querySelector('[data-control-audit-log]')?.textContent.includes('\"favorite\":true')",'favorite metadata callback');
  checks.push('selection menu uses the existing metadata API and selected IDs');
  await navigate('images');await click('images','Larger thumbnails');
  await verify("document.querySelector('.image-library-workspace').dataset.density==='comfortable'",'thumbnail toggle switches to the larger layout');
  await click('images','Compact thumbnails');
  await verify("document.querySelector('.image-library-workspace').dataset.density==='compact'",'thumbnail toggle restores compact layout');
  await navigate('dashboard');await click('dashboard','App data options ⌄');await click('dashboard','RESET APP DATA & SANITIZE APPLICATION');
  await verify("document.querySelector('.reset-native-dialog').open && !document.querySelector('.dashboard-reset .action-menu-panel').matches(':popover-open')",'reset menu closes before opening the existing confirmation dialog');
  await click('dashboard','Keep app data');
  await verify("!document.querySelector('.reset-native-dialog')",'reset review can be cancelled without executing a reset');
  await click('dashboard','App data options ⌄');await click('dashboard','IMPORT BACK-UP');
  await verify("document.querySelector('.reset-native-dialog').open && document.querySelector('.reset-native-dialog').textContent.includes('Preview.zip')",'backup import still requires its existing review dialog');
  await js("document.querySelector('.reset-native-dialog').querySelectorAll('.reset-actions button')[1].click()");await frame();
  await verify("!document.querySelector('.reset-native-dialog')",'import review can be cancelled without importing data');
  await navigate('tools');await click('tools','Function options ⌄');
  const outside=await js("(()=>{const r=document.querySelector('#functions-heading').getBoundingClientRect();return {x:Math.round(r.left+5),y:Math.round(r.top+5)};})()");
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...outside});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...outside});await frame();
  await verify("!document.querySelector('.function-custom .action-menu-panel').matches(':popover-open')",'clicking outside closes action menus');
  const menuRoutes=['generate','tools','characters','dashboard','html-viewer','css-viewer','js-viewer','shortcuts','sound-mixer','image-manager'];
  const layouts=[];
  for(const [width,height] of [[1280,480],[768,500],[390,660]]){
    win.setContentSize(width,height);await frame();
    for(const id of menuRoutes){
      await navigate(id);
      const count=await js(`${pane(id)}.querySelectorAll('.action-menu-trigger').length`);
      for(let i=0;i<count;i++){
        await js(`(()=>{const n=${pane(id)}.querySelectorAll('.action-menu-trigger')[${i}];n.scrollIntoView({block:'nearest'});n.focus({preventScroll:true});n.click();})()`);await frame();
        const bounds=await js(`(()=>{const n=${pane(id)}.querySelectorAll('.action-menu-panel')[${i}],r=n.getBoundingClientRect();return {id:${JSON.stringify(id)},index:${i},open:n.matches(':popover-open'),left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};})()`);
        assert(bounds.open && bounds.left>=0 && bounds.top>=0 && bounds.right<=bounds.width+1 && bounds.bottom<=bounds.height+1,'menu remains in viewport '+JSON.stringify(bounds));layouts.push(bounds);
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await frame();
      }
    }
  }
  fs.writeFileSync(path.join(destination,'actions-result.json'),JSON.stringify({passed:true,checks,menuLayouts:layouts,limitation:'Fake APIs and fake desktop capture; no real file operations, devices or inference executed.'},null,2));
  console.log(JSON.stringify({passed:true,behaviorChecks:checks.length,menuLayouts:layouts.length}));
  clearTimeout(watchdog);win.destroy();app.quit();
}).catch(error=>{console.error(error.stack||error);clearTimeout(watchdog);win?.destroy();app.exit(1);});
