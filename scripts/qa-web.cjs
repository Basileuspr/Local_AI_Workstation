const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),{spawn}=require('node:child_process');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-web-ui-qa-'));let backend,server;
async function boot(){return new Promise((resolve,reject)=>{
  backend=spawn(path.resolve(__dirname,'../venv/Scripts/python.exe'),[path.resolve(__dirname,'../tests/fixtures/web_backend.py'),work],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let buffer='';const timer=setTimeout(()=>reject(Error('Fixture backend timeout.')),20000);
  backend.stdout.on('data',c=>{buffer+=c;try{const info=JSON.parse(buffer.split('\n')[0]);clearTimeout(timer);resolve(info);}catch{}});backend.stderr.on('data',c=>process.stderr.write(c));backend.once('error',reject);
});}
(async()=>{
  const info=await boot();server=https.createServer({key:fs.readFileSync(path.join(work,'fixture.key')),cert:fs.readFileSync(path.join(work,'fixture.pem'))},(req,res)=>{
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><title>Owned rendered release</title></head><body><main><h1>Release</h1><p>Captured release says version 3.2 supports offline inference. The rendered release is selected explicitly by the user.</p><input hidden type="password" value="PASSWORD_SECRET"><input type="hidden" value="HIDDEN_TOKEN"><p>Bearer AUTH_SECRET token=SECRET</p></main></body></html>');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={...process.env,LAW_WEB_QA_WORK:work,LAW_WEB_QA_SITE:`https://browser.example.com:${server.address().port}`,LAW_WEB_QA_PORT:String(info.port),LAW_WEB_QA_CERT:info.fingerprint};delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{const child=spawn(require('electron'),[path.join(__dirname,'qa-web-worker.cjs')],{windowsHide:true,env,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Web UI QA failed (${code}).`)));});
  const saved=JSON.parse(fs.readFileSync(path.join(work,'saved-selection.json')));if(!saved.untrusted||!saved.content_hash)throw Error('Explicit Knowledge handoff lost provenance.');
  console.log(JSON.stringify({ok:true,artifacts:work,checks:['Actual Electron React research and recurring-source UI','Clickable citations and retrieval timestamps','Rendered browser fallback excludes password/hidden/session secrets','Cache and transient cleanup preserve Chromium login','Knowledge handoff only after explicit button click']}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{server?.close();backend?.kill();});
