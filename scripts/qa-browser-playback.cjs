// A real compositor/video probe in a disposable profile. Muted generated media
// exercises decoding, frame presentation, seeking and focus changes, not a user's
// videos or login. Optional public YouTube playback uses this same fresh profile.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
if(!process.versions.electron) {
    const {spawn,spawnSync}=require('node:child_process');
    const work=process.env.LAW_PLAYBACK_WORK || fs.mkdtempSync(path.join(os.tmpdir(),'law-playback-qa-'));
    (async()=>{
        const video=path.join(work,'1080p60.mp4');
        if(!fs.existsSync(video)) {
            const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=60',
                '-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','16','-c:v','libx264','-preset','ultrafast','-crf','28','-pix_fmt','yuv420p',
                '-threads','2','-c:a','aac','-movflags','+faststart',video],{windowsHide:true,encoding:'utf8'});
            if(result.status!==0)throw Error(result.stderr || result.error?.message || 'Fixture encoding failed');
        }
        for(const mode of (process.env.LAW_PLAYBACK_MODES || 'compatible,hardware').split(',')) await new Promise((resolve,reject)=>{
            const env={...process.env,LAW_PLAYBACK_WORK:work,LAW_PLAYBACK_MODE:mode};delete env.ELECTRON_RUN_AS_NODE;
            const child=spawn(require('electron'),[__filename],{env,windowsHide:true,stdio:'inherit'});
            child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Playback ${mode} failed (${code})`)));
        });
        console.log(JSON.stringify({artifacts:work},null,2));
    })().catch(error=>{console.error(error);process.exitCode=1;});
} else {
    const {app,BrowserWindow,WebContentsView,session,screen}=require('electron');
    const {configureRendering,attachWindowRendering}=require('../electron/windowRendering');
    const {createViewerBrowser}=require('../electron/viewerBrowser');
    const work=process.env.LAW_PLAYBACK_WORK,mode=process.env.LAW_PLAYBACK_MODE;
    const profile=path.join(work,`${mode}-${process.env.LAW_PLAYBACK_LABEL || 'probe'}`);fs.mkdirSync(profile,{recursive:true});
    fs.writeFileSync(path.join(profile,'window-rendering.json'),JSON.stringify({mode}));app.setPath('userData',profile);
    configureRendering({app});
    app.commandLine.appendSwitch('host-resolver-rules','MAP playback.example.com 127.0.0.1');
    app.commandLine.appendSwitch('no-proxy-server');
    if(process.env.LAW_PLAYBACK_ANGLE)app.commandLine.appendSwitch('use-angle',process.env.LAW_PLAYBACK_ANGLE);
    if(process.env.LAW_PLAYBACK_OCCLUSION==='off')app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');
    let win,browser,rendering,server,remote,view;
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function until(fn,label){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await sleep(50);}throw Error(`Timed out: ${label}`);}
    const timeout=setTimeout(()=>app.exit(1),90000);
    app.whenReady().then(async()=>{
        const file=path.join(work,'1080p60.mp4'),bytes=fs.statSync(file).size;
        server=http.createServer((req,res)=>{
            if(req.url==='/clip.mp4') {
                res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');
                const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
                const start=range?Number(range[1]):0,end=range?.[2]?Math.min(bytes-1,Number(range[2])):bytes-1;
                if(start>=bytes){res.writeHead(416,{'Content-Range':`bytes */${bytes}`});return res.end();}
                if(range)res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes}`,'Content-Length':end-start+1});
                else res.setHeader('Content-Length',bytes);
                return fs.createReadStream(file,{start,end}).pipe(res);
            }
            res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Playback probe</title><style>body{margin:0;background:#111}video{width:100%;height:100vh}</style><video controls muted preload="auto" src="/clip.mp4"></video>');
        });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        const site=`http://playback.example.com:${server.address().port}`;
        win=new BrowserWindow({show:false,width:1100,height:700,title:'Video playback check',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
        await win.loadURL('data:text/html,<body style="background:%23111;color:white">Video playback check</body>');
        if(process.env.LAW_PLAYBACK_TOP==='1')win.setAlwaysOnTop(true);
        win.showInactive();rendering=attachWindowRendering({window:win,screen});
        const TestView=class extends WebContentsView{constructor(options){super(options);remote=this.webContents;view=this;}};
        browser=createViewerBrowser({WebContentsView:TestView,session,getWindow:()=>win,profileDirectory:profile,
            allowRequest:raw=>{try{return new URL(raw).origin===site;}catch{return false;}}});
        await browser.navigate(site);
        browser.place({visible:true,bounds:{x:0,y:30,width:1100,height:640}});rendering.repaint();
        await until(()=>!remote.isLoading(),'owned media page');
        const decoders=[];
        remote.debugger.attach('1.3');remote.debugger.on('message',(_event,method,params)=>{
            if(method==='Media.playerPropertiesChanged')for(const p of params.properties || [])
                if(['kVideoDecoderName','kIsPlatformVideoDecoder'].includes(p.name))decoders.push(p);
        });await remote.debugger.sendCommand('Media.enable');
        await remote.executeJavaScript(`(()=>{
            const v=document.querySelector('video');window.probe={waits:0,stalls:0,frames:0,gaps:[],last:0};
            v.addEventListener('waiting',()=>{if(probe.armed)probe.waits++});v.addEventListener('stalled',()=>{if(probe.armed)probe.stalls++});
            function frame(now){if(probe.armed){probe.frames++;if(probe.last)probe.gaps.push(now-probe.last);probe.last=now;}v.requestVideoFrameCallback(frame)}
            v.requestVideoFrameCallback(frame);v.muted=true;return v.play();})()`,true);
        await until(()=>remote.executeJavaScript("!document.querySelector('video').paused && document.querySelector('video').currentTime>.5"),'video playback');
        await remote.executeJavaScript('probe.armed=true;probe.started=performance.now();probe.before=document.querySelector("video").getVideoPlaybackQuality().droppedVideoFrames;');
        const before=rendering.state().repaintCount;
        // Model background host clock updates and browser layout notifications.
        const pulse=setInterval(()=>{rendering.repaint({passive:true});browser.place({visible:true,bounds:{x:0,y:30,width:1100,height:640}});},500);
        await sleep(2500);win.webContents.focus();await sleep(2500);remote.focus();await sleep(2500);
        clearInterval(pulse);
        const result=await remote.executeJavaScript(`(()=>{probe.armed=false;const v=document.querySelector('video'),q=v.getVideoPlaybackQuality(),g=[...probe.gaps].sort((a,b)=>a-b);return {
            elapsed:(performance.now()-probe.started)/1000,currentTime:v.currentTime,frames:probe.frames,p95GapMs:g[Math.floor(g.length*.95)]||0,maxGapMs:g.at(-1)||0,
            waits:probe.waits,stalls:probe.stalls,totalFrames:q.totalVideoFrames,droppedFrames:q.droppedVideoFrames-probe.before,visibility:document.visibilityState,
            width:v.videoWidth,height:v.videoHeight,paused:v.paused};})()`);
        result.mode=mode;result.features=app.getGPUFeatureStatus();result.decoders=decoders;
        const display=screen.getDisplayMatching(win.getBounds());result.display={width:display.size.width,height:display.size.height,frequency:display.displayFrequency,scale:display.scaleFactor};
        result.remoteBackgroundThrottling=remote.getBackgroundThrottling();result.repaints=rendering.state().repaintCount-before;
        if(!(result.currentTime>6 && result.frames>100 && result.width===1920))console.error('Playback did not make expected progress',JSON.stringify(result));
        assert(result.currentTime>6 && result.frames>100 && result.width===1920,'Video made meaningful progress');
        await remote.executeJavaScript("document.querySelector('video').currentTime=12;document.querySelector('video').play()",true);
        await until(()=>remote.executeJavaScript("document.querySelector('video').currentTime>12.2 && document.querySelector('video').readyState>=3"),'seek recovery');
        result.seekRecovered=true;
        console.log(JSON.stringify(result,null,2));
        fs.writeFileSync(path.join(work,`${process.env.LAW_PLAYBACK_LABEL || 'probe'}-${mode}.json`),JSON.stringify(result,null,2));
        remote.debugger.detach();await browser.dispose();
        if(process.env.LAW_PLAYBACK_YOUTUBE==='1') {
            browser=createViewerBrowser({WebContentsView:TestView,session,getWindow:()=>win,profileDirectory:path.join(profile,'public')});
            await browser.navigate('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
            browser.place({visible:true,bounds:{x:0,y:30,width:1100,height:640}});rendering.repaint();
            await until(()=>remote.executeJavaScript("!!document.querySelector('video')"),'public YouTube player');
            const buttons=await remote.executeJavaScript("[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).slice(0,30).map(b=>({text:b.textContent.trim().slice(0,60),label:b.getAttribute('aria-label')}))");
            console.log('YouTube visible controls',JSON.stringify(buttons));
            const playing=await remote.executeJavaScript("(()=>{const v=document.querySelector('video');v.muted=true;return v.play().then(()=>({playing:true}),e=>({playing:false,error:e.name}));})()",true);
            console.log('YouTube play',JSON.stringify(playing));
            await sleep(8000);
            const youtube=await remote.executeJavaScript("(()=>{const v=document.querySelector('video'),q=v.getVideoPlaybackQuality();return {currentTime:v.currentTime,width:v.videoWidth,height:v.videoHeight,paused:v.paused,readyState:v.readyState,totalFrames:q.totalVideoFrames,droppedFrames:q.droppedVideoFrames,error:v.error?.code||null};})()");
            console.log('YouTube playback',JSON.stringify(youtube));fs.writeFileSync(path.join(work,'youtube.json'),JSON.stringify(youtube,null,2));
            await browser.dispose();
        }
        rendering.dispose();win.destroy();server.close();clearTimeout(timeout);app.exit(0);
    }).catch(async error=>{console.error(error);try{await browser?.dispose();rendering?.dispose();win?.destroy();server?.close();}catch{}clearTimeout(timeout);app.exit(1);});
}
