const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-browser-persistence-'));
const server=http.createServer((req,res)=>{
  if(req.url==='/download'){res.setHeader('Content-Disposition','attachment; filename="fixture.bin"');return res.end('owned fixture download');}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Profile QA</title><h1>Owned browser fixture</h1>');
});
async function run(phase,site){return new Promise((resolve,reject)=>{
  const env={...process.env,LAW_QA_PROFILE:work,LAW_QA_SITE:site,LAW_QA_PHASE:phase};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[path.join(__dirname,'qa-browser-profile.cjs')],{env,windowsHide:true,stdio:'inherit'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Profile ${phase} failed (${code})`)));
});}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site=`http://browser.example.com:${server.address().port}`;
  try{await run('write',site);await run('read',site);console.log(JSON.stringify({ok:true,checks:['Separate process cookie, LocalStorage and IndexedDB persistence','Isolated popup and opener flow','Download requires chosen destination','Close destroys login windows','Cache-only preserves login; all-data clearing removes login'],artifacts:work},null,2));}
  finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
