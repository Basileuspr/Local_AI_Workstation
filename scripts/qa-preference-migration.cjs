const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("node:path"), fs = require("node:fs"), { pathToFileURL } = require("node:url");
const { migratePreferences, KEYS, MARKER } = require("../electron/preferenceMigration");
if (!process.env.LAW_USER_DATA_DIR || !process.env.LAW_QA_RESULT) throw new Error("Isolated profile required");
app.setPath("userData", process.env.LAW_USER_DATA_DIR);
protocol.registerSchemesAsPrivileged([{scheme:"app",privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
    const oldPath = path.resolve(__dirname,"../dist/index.html");
    protocol.handle("app", () => new Response("<!doctype html><title>Preference migration</title>", {headers:{"content-type":"text/html"}}));
    let phase = "seed";
    try {
        const win = new BrowserWindow({show:false,webPreferences:{javascript:false,sandbox:true,contextIsolation:true,nodeIntegration:false}});
        const execute = code => win.webContents.executeJavaScriptInIsolatedWorld(991, [{code}]);
        await win.loadFile(oldPath);
        await execute(`localStorage.setItem(${JSON.stringify(KEYS[0])}, JSON.stringify({temperature:0.42,customProfiles:[{id:'legacy',name:'Retained'}]}))`);
        phase = "migrate";
        await migratePreferences({BrowserWindow,oldPath,appUrl:"app://local/index.html"});
        phase = "verify";
        await win.loadURL("app://local/index.html");
        const result = await execute(`({value:JSON.parse(localStorage.getItem(${JSON.stringify(KEYS[0])})),marker:localStorage.getItem(${JSON.stringify(MARKER)})})`);
        await win.loadFile(oldPath);
        result.original = await execute(`JSON.parse(localStorage.getItem(${JSON.stringify(KEYS[0])}))`);
        fs.writeFileSync(process.env.LAW_QA_RESULT,JSON.stringify(result));
    } catch(error) { fs.writeFileSync(process.env.LAW_QA_RESULT,JSON.stringify({phase,error:error.message,stack:error.stack})); }
    app.quit();
});
