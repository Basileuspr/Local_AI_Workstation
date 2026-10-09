// Two real, hidden Electron processes and an isolated authenticated backend.
// Only the fixture dependency permits browser.example.com to resolve to loopback.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'law-browser-foundation-'));
let backend,server,privateHits=0,authenticatedMedia=0,expired=0;
async function bootBackend() {
    return new Promise((resolve,reject)=>{
        backend=spawn(path.resolve(__dirname,'../venv/Scripts/python.exe'),[path.resolve(__dirname,'../tests/fixtures/browserMedia_backend.py'),work],{windowsHide:true,stdio:['ignore','pipe','pipe']});
        let output='';const timer=setTimeout(()=>reject(Error('Fixture backend startup timed out.')),30000);
        backend.stdout.on('data',bytes=>{output+=bytes.toString();const line=output.split('\n')[0];try{const info=JSON.parse(line);clearTimeout(timer);resolve(info);}catch{}});
        backend.stderr.on('data',bytes=>process.stderr.write(bytes));backend.once('error',reject);
    });
}
async function run(phase,site,port) {
    const env={...process.env,LAW_FOUNDATION_WORK:work,LAW_FOUNDATION_PHASE:phase,LAW_FOUNDATION_SITE:site,LAW_FOUNDATION_BACKEND:String(port)};delete env.ELECTRON_RUN_AS_NODE;
    await new Promise((resolve,reject)=>{
        const child=spawn(require('electron'),[path.join(__dirname,'qa-browser-foundation-worker.cjs')],{windowsHide:true,env,stdio:'inherit'});
        child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Foundation ${phase} failed (${code}).`)));
    });
}
(async()=>{
    const info=await bootBackend();const video=fs.readFileSync(info.video);
    server=http.createServer((req,res)=>{
        if(req.url.startsWith('/private')){privateHits++;return res.end('private destination must never be reached');}
        if(req.url.startsWith('/media')) {
            if(!/qa_login=Bob/.test(req.headers.cookie||'')){res.statusCode=401;return res.end('Login required');}
            if(req.url.includes('signature=OLD') && !req.headers.range){expired++;res.statusCode=403;return res.end('Expired address');}
            authenticatedMedia++;res.setHeader('Content-Type','video/mp4');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Length',video.length);
            if(req.url.includes('slow=1') && !req.headers.range) {
                res.write(video.subarray(0,128));const timer=setTimeout(()=>res.end(video.subarray(128)),5000);res.on('close',()=>clearTimeout(timer));return;
            }
            return res.end(video);
        }
        if(req.url==='/blocked-caption') {res.writeHead(302,{Location:`http://127.0.0.1:${server.address().port}/private`});return res.end();}
        if(req.url==='/caption') {
            if(!/qa_login=Bob/.test(req.headers.cookie||'')){res.statusCode=401;return res.end('Login required');}
            const vtt='WEBVTT\n\n00:00.000 --> 00:02.500\nOwned fixture speech\n';res.setHeader('Content-Type','text/vtt');res.setHeader('Content-Length',Buffer.byteLength(vtt));return res.end(vtt);
        }
        const account=/qa_login=Bob/.test(req.headers.cookie||'')?'Bob':'Alice';
        res.setHeader('Content-Type','text/html');res.setHeader('Cache-Control','no-store');
        res.end(`<!doctype html><title>Foundation fixture</title><span aria-label="Current account">${account}</span>
          <h1>Owned fixture</h1><p>token=SECRET</p><input type="hidden" value="SECRET"><span hidden>SECRET</span>
          <label>Search<input type="search" name="search"></label><button id="change" onclick="this.textContent='Changed'">Change</button>
          <button>Duplicate</button><button>Duplicate</button><button id="next" onclick="location.href='/next'">Next</button>
          <article><video title="Selected reel" src="/media?signature=NEW" preload="auto"><track kind="captions" src="/caption" srclang="en"></video><figcaption>Owned reel description<br>Authorization: Bearer SECRET</figcaption></article>
          <div style="height:2000px"></div>`);
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const site=`http://browser.example.com:${server.address().port}`;
    await run('write',site,info.port);await run('read',site,info.port);
    assert.equal(privateHits,0);assert(authenticatedMedia>0);assert.equal(expired,1);
    console.log(JSON.stringify({ok:true,privateHits,authenticatedMedia,expiredRefreshes:expired,artifacts:work},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{server?.close();backend?.kill();});
