const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {browserUrl,allowedBrowserRequest}=require('./browserPolicy');
const {redactSecrets}=require('./redactSecrets');
const {pageOperation}=require('./browserPageTools');
const {createWorkflowStore,MAX_MEDIA}=require('./browserWorkflowStore');
const {transfer}=require('./browserMediaTransfer');
const TERMINAL=new Set(['completed','cancelled','failed','interrupted']);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=value=>createHash('sha256').update(value).digest('hex');
function sourceIdentity(raw) {
    const u=new URL(raw);
    const pathname=u.pathname.replace(/[a-z\d_-]{60,}/gi,'[opaque]');
    const safePath=redactSecrets(pathname).slice(0,1000);
    return {origin:u.origin,path:safePath,identity:hash(u.origin+u.pathname),recoverable:!u.search && !u.hash && safePath===u.pathname};
}
function checkpointMatches(source,raw) {
    try {
        if(!source || !browserUrl(raw))return false;
        const current=sourceIdentity(raw);
        if(current.identity===source.identity)return true;
        // Only the optional slash on a stable reel ID is equivalent. Generic
        // /page and /page/ may be different documents; never broaden origins.
        const reel=path=>path.match(/^\/reel\/([a-z\d_-]{1,100})\/?$/i)?.[1];
        return source.origin===current.origin && hash(source.origin+source.path)===source.identity &&
            !!reel(source.path) && reel(source.path)===reel(current.path);
    }catch{return false;}
}
function recoveryAddress(source) {
    if(!source?.recoverable)return null; // Old/query-dependent checkpoints require manual review.
    try {
        const url=source.origin+source.path;
        return browserUrl(url) && sourceIdentity(url).identity===source.identity ? url : null;
    }catch{return null;}
}
function strict(value,keys) {
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)))throw Error('Unsupported browser tool arguments.');
}
async function hashFile(file,check) {
    const digest=createHash('sha256');
    for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024})){check();digest.update(chunk);}
    check();return digest.digest('hex');
}
function target(value) {
    strict(value,['role','name']);
    if(!['button','link','textbox','combobox','checkbox','radio','video'].includes(value.role) || typeof value.name!=='string' || value.name.length>200)throw Error('Use an exact semantic role and name.');
    return value;
}

function createBrowserWorkflows({getContents,getProfileId,getRevision,storagePath,allowRequest,prepareMedia,cancelMedia,stopPage,restorePage}) {
    const store=createWorkflowStore(storagePath);
    let active=null,recovering=null;
    function publicState() {return {active:active?store.history().find(r=>r.id===active.id):null,history:store.history()};}
    function check(run) {
        if(run.cancelled)throw Error('cancelled');
        if(run.paused)throw Error(run.paused);
        if(run!==active || getProfileId()!==run.profileId || getContents()!==run.wc || run.wc.isDestroyed())throw Error('page_changed');
        if(!run.origins.includes(new URL(run.wc.getURL()).origin))throw Error('unexpected_origin');
    }
    function pause(reason) {
        if(!active || active.cancelled)return;
        active.paused=reason;active.refs.clear();active.controller?.abort();
        store.update(active.id,{status:'paused',stage:'review',reason});
    }
    function navigation(url,expected=false) {
        if(!active || active.cancelled || active.paused || active.wc!==getContents())return;
        let origin;try{origin=new URL(url).origin;}catch{pause('page_changed');return;}
        if(!active.origins.includes(origin)){pause('unexpected_origin');return;}
        if(!expected && !active.expectedNavigation)pause('unexpected_page_change');
        active.refs.clear();active.document=null;
    }
    async function evaluate(run,request,deadline) {
        check(run);
        const revision=getRevision();
        const remaining=deadline-Date.now();if(remaining<=0)throw Error('timeout');
        let timer,abort;
        // The DOM code checks the deadline too: queued execution after a modal
        // dialog or a timeout may never perform a late click/field entry.
        try {
            const result=await Promise.race([
                run.wc.executeJavaScriptInIsolatedWorld(1001,[{code:`(${pageOperation.toString()})(${JSON.stringify({...request,accountTarget:run.accountTarget,account:run.accountValue,deadline,origins:run.origins,fixture:!!allowRequest})})`}],true),
                new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),remaining);}),
                new Promise((_,reject)=>{abort=()=>reject(Error(run.cancelled?'cancelled':run.paused||'timeout'));run.controller?.signal.addEventListener('abort',abort,{once:true});}),
            ]);
            check(run);
            if(revision!==getRevision() && request.action!=='click')throw Error('stale_document');
            if(['account_changed','account_marker_missing'].includes(result?.error))pause(result.error);
            if(!result || result.error)throw Error(result?.error||'page_unavailable');
            if(result.challenge){pause('login_challenge');throw Error('login_challenge');}
            if(run.account!==undefined && hash(result.account||'')!==run.account){pause('account_changed');throw Error('account_changed');}
            if(run.account===undefined){run.account=hash(result.account||'');run.accountValue=result.account||'';}
            return result;
        } finally {clearTimeout(timer);if(abort)run.controller?.signal.removeEventListener('abort',abort);}
    }
    async function read(run,deadline,semantic) {
        const data=await evaluate(run,{action:semantic?'discover':'read',target:semantic},deadline);
        run.document=data.document;run.revision=getRevision();run.refs.clear();run.expectedNavigation=false;
        for(const el of data.elements)run.refs.set(el.id,{...el,document:data.document,revision:run.revision});
        const pageRef=`page:${run.id}:${data.document}:${run.revision}`;
        run.pageRef=pageRef;
        const source=sourceIdentity(run.wc.getURL());
        const addressHash=hash(run.wc.getURL());
        if(run.currentSource!==addressHash){run.currentSource=addressHash;store.update(run.id,{source});}
        return {pageRef,profileId:run.profileId,source,ready:data.ready,accountRef:run.account,
            accountStatus:data.accountStatus,
            elements:data.elements.map(({id,...el})=>({...el,elementRef:`element:${run.id}:${id}`})),text:redactSecrets(data.text),untrusted:true};
    }
    async function begin(value,fromRecovery=false) {
        strict(value,['profileId','accountTarget']);
        if(recovering && !fromRecovery)throw Error('Wait for checkpoint recovery to finish.');
        if(value.accountTarget)target(value.accountTarget);
        if(active?.busy)throw Error('Wait for the current browser operation to stop.');
        if(active && !active.cancelled && !TERMINAL.has(store.history().find(r=>r.id===active.id)?.status))throw Error('This browser page already has a workflow. Cancel it before starting another.');
        if(value.profileId!==getProfileId())throw Error('Explicitly select the workflow profile.');
        const wc=getContents(), raw=wc?.getURL();
        if(!wc || !browserUrl(raw) || !allowRequest && new URL(raw).protocol!=='https:')throw Error('Open a public HTTPS page in the selected profile first.');
        const row=store.create(value.profileId);
        const run={id:row.id,profileId:value.profileId,wc,origins:[new URL(raw).origin],accountTarget:value.accountTarget,refs:new Map(),cancelled:false,paused:null,busy:true,controller:new AbortController()};
        active=run;
        store.update(row.id,{source:sourceIdentity(raw)});
        try {
            const page=await wait(run,Date.now()+10000,{condition:'ready'});
            store.update(row.id,{accountBound:run.account!==hash(''),accountRef:run.account!==hash('')?run.account:null});
            return {workflowId:row.id,page,...publicState()};
        } catch(error) {
            if(!run.paused && !run.cancelled){
                run.cancelled=true;store.update(row.id,{status:'failed',reason:error.message==='timeout'?'timeout':'start_failed'});
                if(error.message==='timeout')stopPage?.();
            }
            throw Error(`Browser workflow: ${/^[a-z_]+$/.test(error.message)?error.message:'start_failed'}.`);
        } finally {
            run.busy=false;run.controller=null;
            if(store.history().find(r=>r.id===run.id)?.status==='cancelling')store.update(run.id,{status:'cancelled',stage:'stopped',reason:'cancelled'});
        }
    }
    function requireRun(value) {
        if(recovering)throw Error('Checkpoint recovery is still running.');
        if(!active || value.workflowId!==active.id)throw Error('Workflow not found for this page.');
        check(active);return active;
    }
    function resolveElement(run,value) {
        if(value.pageRef!==run.pageRef || run.revision!==getRevision())throw Error('stale_document');
        const match=typeof value.elementRef==='string' && value.elementRef.match(/^element:([a-f0-9]{32}):([a-f0-9-]{36})$/);
        const ref=match && match[1]===run.id && run.refs.get(match[2]);
        if(!ref || ref.document!==run.document || ref.revision!==getRevision())throw Error('stale_element');
        // A discovered name shared by multiple elements is not actionable.
        if([...run.refs.values()].filter(r=>r.role===ref.role && r.name===ref.name).length!==1)throw Error('ambiguous_element');
        return match[2];
    }
    async function permitted(run,raw) {
        check(run);
        if(!browserUrl(raw) || !allowRequest && new URL(raw).protocol!=='https:')throw Error('blocked_destination');
        const ok=await Promise.race([
            allowRequest?allowRequest(raw):allowedBrowserRequest(raw,host=>run.wc.session.resolveHost(host)),
            sleep(5000).then(()=>false),
        ]);
        if(!ok)throw Error('blocked_destination');check(run);
    }
    async function download(run,raw,file,limit,deadline) {
        let current=raw;
        for(let hop=0;hop<=5;hop++) {
            await permitted(run,current);
            if(Date.now()>=deadline)throw Error('timeout');
            const result=await transfer({session:run.wc.session,url:current,file,limit,signal:run.controller.signal,
                check:()=>{check(run);if(Date.now()>=deadline)throw Error('timeout');}});
            check(run);
            if(result.redirect) {
                if(hop===5)throw Error('redirect_limit');
                current=new URL(result.redirect,current).href;continue;
            }
            return result;
        }
    }
    async function capture(run,value,deadline) {
        if(!run.accountValue)throw Error('account_identity_unavailable');
        const element=resolveElement(run,value),revision=getRevision(),document=run.document;
        const descriptor=async()=>{
            const media=await evaluate(run,{action:'media',element,document},deadline);
            if(media.separateAudio)throw Error('unsupported_separate_audio');
            if(value.requireCaption && media.captionSource!=='selected-article')throw Error('unsupported_caption_source');
            return media;
        };
        let media=await descriptor();
        const metadataDeadline=Math.min(deadline,Date.now()+10000);
        while((!media.duration || media.ready<1) && Date.now()<metadataDeadline) {
            await sleep(100);media=await descriptor();
        }
        if(!media.duration || media.duration>600 || media.ready<1 || !/^https?:/.test(media.source))throw Error('unsupported_media');
        const identity=sourceIdentity(media.source).identity;
        if(!prepareMedia)throw Error('media_verifier_unavailable');
        const directory=store.allocate(run.id);
        const video=path.join(directory,'video.bin');
        store.update(run.id,{stage:'acquiring'});
        try {
            let result;
            for(let attempt=0;attempt<2;attempt++) {
                try {result=await download(run,media.source,video,MAX_MEDIA,deadline);break;}
                catch(error) {
                    fs.rmSync(video,{force:true});
                    if(error.message!=='media_address_expired' || attempt)throw error;
                    // One safe refresh: only the same DOM video/source identity
                    // may supply an updated signed address. Never store it.
                    const refreshDeadline=Math.min(deadline,Date.now()+5000);let refreshed;
                    while(Date.now()<refreshDeadline) {
                        await sleep(100);refreshed=await descriptor();
                        if(refreshed.source && sourceIdentity(refreshed.source).identity!==identity)throw Error('media_changed');
                        if(refreshed.source!==media.source && refreshed.ready>=1)break;
                    }
                    if(!refreshed || refreshed.source===media.source || refreshed.ready<1)throw error;
                    media=refreshed;
                }
            }
            if(!/^(video\/(mp4|webm)|application\/octet-stream)(;|$)/i.test(result.type))throw Error('unsupported_media_type');
            check(run);if(getRevision()!==revision)throw Error('stale_document');
            if(media.captionTruncated)throw Error('unsupported_caption_size');
            const usableTracks=media.tracks.filter(t=>['captions','subtitles','descriptions'].includes(t.kind));
            const captions={description:redactSecrets(media.caption),tracks:[],status:usableTracks.length||media.caption?'complete':'absent',timedStatus:usableTracks.length?'complete':'absent'};
            for(const [index,track] of media.tracks.entries()) {
                if(!['captions','subtitles','descriptions'].includes(track.kind))continue;
                const file=path.join(directory,`caption-${index}.txt`);
                const acquired=await download(run,track.src,file,1024*1024,deadline);
                if(!/^(text\/(vtt|plain)|application\/(ttml\+xml|x-subrip))(;|$)/i.test(acquired.type))throw Error('unsupported_caption_type');
                const text=fs.readFileSync(file,'utf8');
                if(!text.startsWith('WEBVTT'))throw Error('unsupported_caption_format');
                const safeText=redactSecrets(text.replace(/https?:\/\/[^\s"<>]+/gi,raw=>{try{const u=new URL(raw);return u.origin+u.pathname;}catch{return '[address]';}}));
                captions.tracks.push({kind:track.kind,language:String(track.language).slice(0,30),text:safeText});fs.rmSync(file);
            }
            fs.writeFileSync(path.join(directory,'captions.json'),JSON.stringify(captions));
            store.update(run.id,{stage:'verifying'});
            const sha256=await hashFile(video,()=>{check(run);if(Date.now()>=deadline)throw Error('timeout');});
            const verified=await prepareMedia(run.id,{duration:media.duration,bytes:result.bytes,sha256});
            check(run);if(getRevision()!==revision)throw Error('stale_document');
            const latest=await descriptor();if(sourceIdentity(latest.source).identity!==identity)throw Error('media_changed');
            const output={...verified,captions:captions.status,timedCaptions:captions.timedStatus,source:sourceIdentity(run.wc.getURL()),profileId:run.profileId};
            store.update(run.id,{status:'completed',stage:'complete',media:output,reason:null});
            run.cancelled=true;run.refs.clear();return output;
        } catch(error) {store.remove(run.id);throw error;}
    }
    async function tool(value) {
        strict(value,['workflowId','action','pageRef','elementRef','target','url','value','amount','timeoutMs','condition','requireCaption']);
        if(value.requireCaption!==undefined && typeof value.requireCaption!=='boolean')throw Error('Unsupported caption requirement.');
        const run=requireRun(value);
        if(run.busy)throw Error('This page is busy with another browser operation.');
        if(!['navigate','read','discover','reels','click','fill','scroll','wait','capture'].includes(value.action))throw Error('Unsupported browser operation.');
        const duration=value.timeoutMs===undefined?(value.action==='capture'?120000:10000):value.timeoutMs;
        if(!Number.isInteger(duration) || duration<100 || duration>(value.action==='capture'?180000:30000))throw Error('Choose a bounded operation timeout.');
        run.busy=true;run.controller=new AbortController();const deadline=Date.now()+duration;
        const timer=setTimeout(()=>run.controller.abort(),duration);
        try {
            if(value.action==='reels') {
                if(value.pageRef!==run.pageRef || run.revision!==getRevision())throw Error('stale_document');
                const data=await evaluate(run,{action:'reels',document:run.document},deadline);
                return {reels:data.reels,profileId:run.profileId,accountRef:run.account};
            }
            if(value.action==='read')return await read(run,deadline);
            if(value.action==='discover')return await read(run,deadline,target(value.target));
            if(value.action==='navigate') {
                if(typeof value.url!=='string')throw Error('blocked_destination');
                await permitted(run,value.url);
                if(!run.origins.includes(new URL(value.url).origin))throw Error('unexpected_origin');
                run.expectedNavigation=true;
                void run.wc.loadURL(value.url).catch(()=>{});
                return await wait(run,deadline,{condition:'ready'});
            }
            if(value.action==='wait')return await wait(run,deadline,value);
            if(value.action==='capture')return await capture(run,value,deadline);
            if(value.pageRef!==run.pageRef || run.revision!==getRevision())throw Error('stale_document');
            const element=value.action==='scroll'?undefined:resolveElement(run,value);
            if(value.action==='fill' && (typeof value.value!=='string' || value.value.length>2000 || redactSecrets(value.value)!==value.value))throw Error('unsafe_field');
            if(value.action==='scroll' && (!Number.isInteger(value.amount) || Math.abs(value.amount)>2000))throw Error('invalid_scroll');
            run.expectedNavigation=value.action==='click';
            const result=await evaluate(run,{action:value.action,element,document:run.document,value:value.value,amount:value.amount},deadline);
            if(value.action==='click') {
                // Clicks are never retried. Readiness and document/account checks
                // verify the resulting page; callers must inspect its state.
                return {clicked:result.clicked,page:await wait(run,deadline,{condition:'ready'})};
            }
            const page=await read(run,deadline);
            return {filled:result.filled,scrolled:result.scrolled,atBoundary:result.atBoundary,page};
        } catch(error) {
            let reason=/^[a-z_]+$/.test(error.message)?error.message:'operation_failed';
            if(reason==='media_address_expired')pause('reauthentication_required');
            if(reason==='timeout' || run.controller.signal.aborted && !run.cancelled && !run.paused) {
                run.cancelled=true;run.refs.clear();run.controller.abort();stopPage?.();store.remove(run.id);
                store.update(run.id,{status:'failed',stage:'review',reason:'timeout'});
                reason='timeout';
            } else if(value.action==='capture' && !run.paused && !run.cancelled) {
                run.cancelled=true;store.remove(run.id);store.update(run.id,{status:'failed',stage:'review',reason});
            }
            throw Error(`Browser workflow: ${reason}.`);
        } finally {
            clearTimeout(timer);run.busy=false;run.controller=null;run.expectedNavigation=false;
            const status=store.history().find(r=>r.id===run.id)?.status;
            if(run.cancelled && status==='cancelling') {
                store.remove(run.id);store.update(run.id,{status:'cancelled',stage:'stopped',reason:'cancelled',media:null});
            }
        }
    }
    async function wait(run,deadline,value) {
        if(!['ready','element'].includes(value.condition||'ready'))throw Error('unsupported_wait');
        const semantic=value.condition==='element'?target(value.target):null;
        while(Date.now()<deadline) {
            check(run);
            if(!run.wc.isLoading()) {
                const page=await read(run,deadline,semantic);
                if(page.ready==='complete' && (!semantic || page.elements.length===1))return page;
                if(semantic && page.elements.length>1)throw Error('ambiguous_element');
            }
            await sleep(100);
        }
        throw Error('timeout');
    }
    async function cancel(value={},fromRecovery=false) {
        strict(value,['workflowId']);
        if(recovering && !fromRecovery) {
            recovering.cancelled=true;
            const wc=getContents();if(getProfileId()===recovering.profileId && wc && !wc.isDestroyed())wc.stop();
        }
        const run=active;if(!run || value.workflowId && run.id!==value.workflowId)return publicState();
        const status=store.history().find(r=>r.id===run.id)?.status;
        if(run.cancelled && TERMINAL.has(status) && !run.busy)return publicState();
        run.cancelled=true;run.refs.clear();store.update(run.id,{status:'cancelling',stage:'stopping',reason:'cancelled'});
        run.controller?.abort();if(!run.wc.isDestroyed())run.wc.stop();
        if(run.busy)stopPage?.();
        await cancelMedia?.(run.id);
        // Keep the page lease until its worker exits. New workflows cannot race
        // backend decoding or a network write still being cancelled.
        const deadline=Date.now()+10000;
        while(run.busy && Date.now()<deadline)await sleep(50);
        if(run.busy)throw Error('Cancellation is still stopping. Wait before starting another workflow.');
        store.remove(run.id);store.update(run.id,{status:'cancelled',stage:'stopped',reason:'cancelled',media:null});return publicState();
    }
    async function resume(value) {
        strict(value,['workflowId','profileId','accountTarget','restorePage']);
        if(value.restorePage!==undefined && typeof value.restorePage!=='boolean')throw Error('Choose whether to restore the saved page.');
        const previous=store.history().find(r=>r.id===value.workflowId);
        if(!previous || previous.profileId!==value.profileId || value.profileId!==getProfileId())throw Error('Select the checkpoint profile before resuming.');
        if(recovering || active?.busy)throw Error('Wait for the current operation to stop.');
        const accountTarget=value.accountTarget ?? (active?.id===previous.id?active.accountTarget:undefined);
        if(accountTarget)target(accountTarget);
        const matches=checkpointMatches(previous.source,getContents()?.getURL());
        const destination=recoveryAddress(previous.source);
        if(!matches && (!value.restorePage || !destination || !restorePage))throw Error('This checkpoint belongs to '+(previous.source?.origin||'the saved page')+(previous.source?.path||'')+'. Open it in this profile, or start a new workflow on the current page.');
        const previousRun=active?.id===previous.id?active:null;
        const recovery={profileId:value.profileId,cancelled:false};recovering=recovery;
        const continuing=()=>{if(recovery.cancelled)throw Error('Checkpoint recovery cancelled.');};
        try {
            if(active && !active.cancelled)await cancel({workflowId:active.id},true);
            continuing();
            if(!matches)await restorePage(value.profileId,destination);
            continuing();
            if(value.profileId!==getProfileId())throw Error('The selected account profile changed during recovery.');
            // Fresh references and bounded readiness, never replay old clicks/captures.
            const result=await begin({profileId:value.profileId,accountTarget},true);
            try {
                continuing();
                if(!checkpointMatches(previous.source,getContents()?.getURL()))throw Error('The saved page redirected to a different document. Review the page before starting a new workflow.');
                if(previous.accountRef && previous.accountRef!==result.page.accountRef)throw Error('The signed-in account changed or its control could not be matched. Choose the original account control before resuming, or start a new workflow.');
                if(previous.accountBound && result.page.accountRef===hash(''))throw Error('The signed-in account could not be verified. Choose its account control before resuming.');
                return {...result,restoredPage:!matches};
            }catch(error){await cancel({workflowId:result.workflowId},true);throw error;}
        }catch(error){
            // Failed readiness/login/account checks retain the original recovery
            // identity. A new login-challenge checkpoint must not lose its binding.
            if(!recovery.cancelled) {
                store.update(previous.id,{status:'paused',stage:'review',reason:'recovery_requires_review'});
                if(active?.id!==previous.id && activeStateStatus()==='paused')store.update(active.id,{source:previous.source,accountBound:previous.accountBound,accountRef:previous.accountRef||null});
                else if(previousRun && activeStateStatus()!=='paused')active=previousRun;
            }else store.update(previous.id,{status:'cancelled',stage:'stopped',reason:'cancelled'});
            throw recovery.cancelled?Error('Checkpoint recovery cancelled.'):error;
        }finally{recovering=null;}
    }
    function activeStateStatus(){return active?store.get(active.id)?.status:null;}
    return {begin,tool,state:publicState,activeState:()=>active?store.get(active.id):null,pause,navigation,cancel,resume,
        releaseMedia(value) {
            strict(value,['workflowId']);
            const row=store.history().find(r=>r.id===value.workflowId);
            if(!row || !TERMINAL.has(row.status) || active?.id===row.id && active.busy)throw Error('Media is still in use.');
            store.remove(row.id);store.update(row.id,{media:null});return {cleared:true};
        },
        allowNavigation(url) {
            if(!active || active.cancelled || active.paused)return true;
            try{if(active.origins.includes(new URL(url).origin))return true;}catch{}
            pause('unexpected_origin');return false;
        },
        busy:()=>!!recovering || !!active?.busy,active:()=>!!active && !active.cancelled,
        async clearMedia(){if(active && (!active.cancelled || active.busy))await cancel({workflowId:active.id});return store.clear();},
        async dispose(){if(active && (!active.cancelled || active.busy))await cancel({workflowId:active.id});},
    };
}
module.exports={createBrowserWorkflows,sourceIdentity,checkpointMatches,recoveryAddress};
