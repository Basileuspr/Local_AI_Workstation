// Runs the real desktop entry point against a caller-provided isolated profile
// and data directory. Does not access the normal application's saved data.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
if (!process.env.LAW_USER_DATA_DIR || !process.env.LAW_DATA_DIR || !process.env.LAW_QA_RESULT) throw new Error("Isolated QA paths are required");
let finished = false;
function finish(result) {
    if (finished) return;
    finished = true;
    fs.writeFileSync(process.env.LAW_QA_RESULT, JSON.stringify(result, null, 2));
    app.quit();
}
setTimeout(() => finish({error: "Desktop QA timed out"}), 55000);
require("../electron/main");
app.whenReady().then(async () => {
    const deadline = Date.now() + 50000;
    while (Date.now() < deadline) {
        const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith("app://local/") && item.webContents.getURL().includes("apiPort="));
        if (win && !win.webContents.isLoading()) {
            try {
                const result = await win.webContents.executeJavaScript(`(async () => {
                    const connection = window.workstationDesktop?.connection;
                    if (!connection?.token) return {error:'Missing desktop bridge credential'};
                    const paths = ['/sessions/list','/image-generation/models','/image-workflows','/faces/characters','/queue','/system/stats'];
                    const status = {};
                    for (const path of paths) status[path] = (await fetch(connection.base + path, {headers:{'X-LAW-Session':connection.token}})).status;
                    const denied = (await fetch(connection.base + '/sessions/list')).status;
                    const desktop = await window.workstationDesktop.openDriveRoot('not-a-drive');
                    return {status, denied, desktop, credentialInUrl: location.href.includes('apiToken'), title:document.title,
                        rendered:!!document.querySelector('#root')?.textContent.trim(), origin:location.origin};
                })()`);
                if (process.env.LAW_QA_SCENES === "1") {
                    result.scenes = await win.webContents.executeJavaScript(`(async () => {
                        const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
                        const click = label => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label); if (!button) throw new Error('Missing button: ' + label); button.click(); };
                        click('Image Workflows'); await pause(300); click('Iterative scenes'); await pause(1500);
                        click('+ New iterative scene'); await pause(700);
                        const section = document.querySelector('[aria-label="Iterative scenes"]');
                        const field = [...section.querySelectorAll('label')].find(l => l.querySelector('span')?.textContent === 'Appearance').querySelector('input');
                        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
                        setter.call(field,'Short brown hair, blue work shirt'); field.dispatchEvent(new Event('input',{bubbles:true}));
                        await pause(1700);
                        const c = window.workstationDesktop.connection;
                        const get = path => fetch(c.base+path,{headers:{'X-LAW-Session':c.token}}).then(r=>r.json());
                        const id = localStorage.getItem('law-last-iterative-scene-v1');
                        const saved = await get('/image-workflows/'+id);
                        if (saved.scene.state.character.appearance !== field.value) throw new Error('Autosave lost the edited field');
                        click('Processing stages'); await pause(100); click('Iterative scenes'); await pause(200);
                        return {id,mode:saved.mode,appearance:saved.scene.state.character.appearance,prompt:saved.prompt_settings.prompt,
                          restoredAcrossTabs:section.querySelector('input').value === saved.name,
                          sceneOptions:[...section.querySelector('[aria-label="Saved iterative scene"]').options].map(o=>o.textContent),
                          alert:section.querySelector('[role="alert"]')?.textContent || null};
                    })()`);
                    await win.webContents.capturePage().then(img => fs.writeFileSync(path.join(path.dirname(process.env.LAW_QA_RESULT),"scene-desktop.png"), img.toPNG()));
                    win.webContents.reload();
                    await new Promise(resolve => win.webContents.once("did-finish-load", resolve));
                    await new Promise(resolve => setTimeout(resolve,1800));
                    result.sceneReloaded = await win.webContents.executeJavaScript(`(async () => {
                        [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Image Workflows').click();
                        await new Promise(resolve=>setTimeout(resolve,2000));
                        const section=document.querySelector('[aria-label="Iterative scenes"]');
                        const field=[...section.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent==='Appearance')?.querySelector('input');
                        return field?.value==='Short brown hair, blue work shirt';
                    })()`);
                    if (!result.sceneReloaded) throw new Error('Saved scene did not restore after reopening its pane');
                }
                finish(result);
                return;
            } catch (error) { finish({error: error.message}); return; }
        }
        await new Promise(resolve => setTimeout(resolve, 300));
    }
});
