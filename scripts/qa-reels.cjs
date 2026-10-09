const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),https=require('node:https'),{spawn}=require('node:child_process');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-reels-qa-'));
let backend,server,acquired=0,repositoryHits=0;
async function boot() {return new Promise((resolve,reject)=>{
    backend=spawn(path.resolve(__dirname,'../venv/Scripts/python.exe'),[path.resolve(__dirname,'../tests/fixtures/reels_backend.py'),work],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let buffer='';const timer=setTimeout(()=>reject(Error('Fixture backend did not start.')),30000);
    backend.stdout.on('data',chunk=>{buffer+=chunk;try{const info=JSON.parse(buffer.split('\n')[0]);clearTimeout(timer);resolve(info);}catch{}});
    backend.stderr.on('data',chunk=>process.stderr.write(chunk));backend.once('error',reject);
});}
async function run(phase,site,info) {await new Promise((resolve,reject)=>{
    const env={...process.env,LAW_REELS_QA_WORK:work,LAW_REELS_QA_SITE:site,LAW_REELS_QA_PHASE:phase,LAW_REELS_QA_PORT:String(info.port),LAW_REELS_QA_CERT:info.fingerprint};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(require('electron'),[path.join(__dirname,'qa-reels-worker.cjs')],{windowsHide:true,env,stdio:'inherit'});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Reels ${phase} failed (${code}).`)));
});}
(async()=>{
    const info=await boot();const video=fs.readFileSync(info.video);
    server=https.createServer({key:fs.readFileSync(path.join(work,'fixture.key')),cert:fs.readFileSync(path.join(work,'fixture.pem'))},(req,res)=>{
        if(req.url.startsWith('/repository')){repositoryHits++;return res.end('Never automatically visit this');}
        if(req.url.startsWith('/media')){
            if(!/qa_account=Owned/.test(req.headers.cookie||'')){res.statusCode=401;return res.end('Login required');}
            if(!req.headers.range)acquired++;
            res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Length',video.length);return res.end(video);
        }
        res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
        res.end(`<!doctype html><title>Reels fixture</title><span aria-label="Current account">Owned</span>
          ${req.url.startsWith('/conversation')?'<a href="/reel/first/">First reel</a><a href="/reel/first/?token=SECRET">Duplicate</a><a href="/reel/second/">Second reel</a>':
          '<article><video title="Selected reel" src="/media?signature=SECRET" preload="auto"></video><figcaption>A creator demonstrates a local tool. github.com/fixture/owned-tool</figcaption></article>'}`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const site=`https://browser.example.com:${server.address().port}`;
    await run('write',site,info);const before=acquired;
    await new Promise(resolve=>{backend.once('exit',resolve);backend.kill();});
    const restarted=await boot();await run('read',site,restarted);
    if(acquired!==before||repositoryHits)throw Error('Duplicate acquisition or automatic repository navigation.');
    console.log(JSON.stringify({ok:true,completeAuthenticatedTransfers:acquired,repositoryHits,artifacts:work},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{server?.close();backend?.kill();});
