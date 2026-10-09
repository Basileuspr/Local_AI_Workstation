// One page owner and one reel at a time. No browser/session data enters prompts.
const {redactSecrets}=require('./redactSecrets');
const ID=/^[a-f0-9]{32}$/;
function strict(value,keys) {
    if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)))throw Error('Unsupported Reels arguments.');
}
function createReelsAnalyzer({browser,request}) {
    let binding=null,active=null,lastError=null,recovering=false;
    const unwrap=value=>{if(value?.error)throw Error(value.error);return value;};
    const stopped=run=>{if(run.stop)throw Error('reels_stopped');};
    function verifyProfile(profile) {
        if(browser.state().selected!==profile)throw Error('Select the source account profile before continuing.');
    }
    function pageSnapshot(run) {
        const state=browser.state();verifyProfile(run.batch.profileId);
        if(state.activeTabId!==run.tabId || state.ready===false)throw Error('The source browser tab changed. Review the original conversation before resuming.');
        return {revision:state.revision,url:state.url};
    }
    function verifyPage(run,snapshot) {
        const current=pageSnapshot(run);
        if(current.revision!==snapshot.revision || current.url!==snapshot.url)throw Error('The browser page changed during processing. Review the original conversation before resuming.');
    }
    async function sourcePage(profile,accountTarget) {
        verifyProfile(profile);
        const current=new URL(browser.state().url);
        if(current.search || current.hash || /[a-z\d_-]{60,}/i.test(current.pathname))throw Error('Open a stable source address without query parameters or a fragment before continuing. This source needs a site adapter.');
        const workflow=unwrap(await browser.startWorkflow({profileId:profile,...(accountTarget?{accountTarget}:{})}));
        const page=workflow.page;
        if(!page.accountRef || page.accountRef==='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') {
            await browser.cancelWorkflow({workflowId:workflow.workflowId});throw Error('The signed-in account could not be identified. Open the website’s account menu, then check the account again. This site’s account check may not be supported yet.');
        }
        return workflow;
    }
    async function discover(value) {
        strict(value,['profileId','accountTarget']);
        if(active || recovering)throw Error('Pause processing or wait for recovery before changing the source.');
        const workflow=await sourcePage(value.profileId,value.accountTarget);
        try {
            const found=await browser.browserTool({workflowId:workflow.workflowId,action:'reels',pageRef:workflow.page.pageRef});
            const sourceUrl=workflow.page.source.origin+workflow.page.source.path;
            if(!found.reels.length)throw Error('No visible stable reel links were found. Open the conversation and scroll to the shared reels.');
            binding={profileId:value.profileId,sourceUrl,reels:found.reels,accountRef:workflow.page.accountRef,accountTarget:value.accountTarget};
            return {profileId:value.profileId,sourceUrl,reels:found.reels};
        } finally {await browser.cancelWorkflow({workflowId:workflow.workflowId});}
    }
    async function checkpoint(run,body) {return request('checkpoint',{batchId:run.batch.id,...body});}
    async function backendSettled(run) {
        const deadline=Date.now()+10000;
        while(Date.now()<deadline) {
            try {
                if(!(await request('state')).processing?.includes(run.batch.id))return true;
            }catch{return false;}
            await new Promise(resolve=>setTimeout(resolve,100));
        }
        return false;
    }
    async function returnToSource(run,snapshot) {
        verifyPage(run,snapshot);
        const exit=await sourcePage(run.batch.profileId,run.accountTarget);
        try {
            verifyPage(run,snapshot);
            if(exit.page.accountRef!==run.accountRef)throw Error('The account changed during processing. Review the original conversation before resuming.');
            // Renew document/account checks before leaving the captured reel.
            // Controlled navigation also rejects a tab switch racing this check.
            await browser.browserTool({workflowId:exit.workflowId,action:'navigate',url:run.batch.sourceUrl});
        }finally{await browser.cancelWorkflow({workflowId:exit.workflowId});}
    }
    async function analyze(run,body,snapshot) {
        // Keep a read-only workflow bound to the reel while local inference
        // runs. It detects DOM account/login changes even without navigation.
        const guard=await sourcePage(run.batch.profileId,run.accountTarget);
        let changed=null,cancellation=null,reading=null,lastRead=0;
        const changedPage=error=>{if(changed)return;changed=error;cancellation=request('cancel',{batchId:run.batch.id}).catch(()=>{});};
        const monitor=setInterval(()=>{
            if(changed)return;
            try{verifyPage(run,snapshot);}catch(error){changedPage(error);return;}
            if(!reading && Date.now()-lastRead>=1000) {
                lastRead=Date.now();reading=browser.browserTool({workflowId:guard.workflowId,action:'read',timeoutMs:1500})
                    .then(page=>{if(page.accountRef!==run.accountRef)throw Error('The account changed during processing. Review the original conversation before resuming.');})
                    .catch(changedPage).finally(()=>{reading=null;});
            }
        },250);
        try {
            verifyPage(run,snapshot);
            if(guard.page.accountRef!==run.accountRef)throw Error('The account changed before local analysis.');
            await request('analyze',body);
            run.batch.items[body.index].status='complete';
            if(changed)throw changed;
            verifyPage(run,snapshot);
        }catch(error){throw changed||error;}
        finally{
            clearInterval(monitor);if(reading)await reading;
            await browser.cancelWorkflow({workflowId:guard.workflowId});
            if(cancellation)await cancellation;
        }
    }
    async function loop(run) {
        let workflowId;
        try {
            await checkpoint(run,{status:'running'});
            for(let index=0;index<run.batch.items.length;index++) {
                const item=run.batch.items[index];
                if(['complete','duplicate','unsupported'].includes(item.status))continue;
                stopped(run);pageSnapshot(run);
                run.index=index;run.stage='opening';
                const source=await sourcePage(run.batch.profileId,run.accountTarget);
                workflowId=source.workflowId;run.workflowId=workflowId;
                if(source.page.source.origin+source.page.source.path!==run.batch.sourceUrl || source.page.accountRef!==run.accountRef)throw Error('Source page or account changed. Review the original conversation before resuming.');
                let page=await browser.browserTool({workflowId,action:'navigate',url:item.url});
                stopped(run);
                if(page.accountRef!==run.accountRef || page.source.origin+page.source.path!==new URL(item.url).origin+new URL(item.url).pathname)throw Error('Unexpected reel or account.');
                page=await browser.browserTool({workflowId,action:'wait',condition:'element',target:{role:'video',name:run.videoName||''},timeoutMs:15000});
                // Names must be exact and unique. A manually selected video label
                // supports sites naming their player; unnamed unique video is default.
                const videos=page.elements.filter(e=>e.role==='video');
                if(videos.length!==1)throw Error('Choose an unambiguous reel player.');
                const snapshot=pageSnapshot(run);
                run.stage='acquiring';await checkpoint(run,{index,itemStatus:'acquiring',workflowId});
                let media;
                try {
                    media=await browser.browserTool({workflowId,action:'capture',pageRef:page.pageRef,elementRef:videos[0].elementRef,requireCaption:true});
                } catch(error) {
                    const safe=/unsupported_|incomplete_|media_verification_failed|operation_failed/.test(error.message);
                    if(!safe)throw error;
                    await checkpoint(run,{index,itemStatus:'unsupported'});item.status='unsupported';
                    await browser.cancelWorkflow({workflowId});workflowId=null;run.workflowId=null;
                    await returnToSource(run,snapshot);
                    if(run.pause)break;
                    continue;
                }
                stopped(run);verifyPage(run,snapshot);
                if(media.completeness!=='complete' || !['complete','absent'].includes(media.audio) || media.source.origin+media.source.path!==new URL(item.url).origin+new URL(item.url).pathname)throw Error('Incomplete or mismatched acquisition.');
                run.stage='analyzing';
                await analyze(run,{batchId:run.batch.id,index,workflowId,capturedUrl:item.url},snapshot);
                // Backend saves first and removes video/audio/transcript/frames.
                await browser.releaseWorkflowMedia({workflowId});workflowId=null;run.workflowId=null;
                run.stage='returning';await returnToSource(run,snapshot);
                if(run.pause)break;
            }
            await checkpoint(run,{status:run.pause?'paused':'complete'});
        } catch(error) {
            lastError=run.stop?'Processing stopped. Temporary evidence cleared.':redactSecrets(error.message).slice(0,400);
            await request('cancel',{batchId:run.batch.id}).catch(()=>{});
            run.hold=!await backendSettled(run);
            if(run.hold){run.stage='stopping';lastError='The local worker is still stopping. Retry Cancel before starting another sequence or clearing media.';}
            if(workflowId) {
                await browser.cancelWorkflow({workflowId}).catch(()=>{});
                if(!run.hold)await browser.releaseWorkflowMedia({workflowId}).catch(()=>{});
            }
            if(run.index!==undefined && run.batch.items[run.index].status!=='complete')await checkpoint(run,{index:run.index,itemStatus:'interrupted'}).catch(()=>{});
            await checkpoint(run,{status:run.stop==='cancel'?'cancelled':'paused'}).catch(()=>{});
        } finally {if(active===run && !run.hold)active=null;}
    }
    function launch(batch,accountTarget,accountRef,videoName) {
        lastError=null;const run={batch,accountTarget,accountRef,videoName,tabId:browser.state().activeTabId,stage:'starting',pause:false,stop:null};active=run;
        run.pending=loop(run);return {started:true,batchId:batch.id};
    }
    return {
        discover,
        busy:()=>!!active || recovering,
        async controls(value) {
            strict(value,['profileId']);
            if(active || recovering)throw Error('Pause processing or wait for recovery before reading account controls.');
            verifyProfile(value.profileId);
            const workflow=await browser.startWorkflow({profileId:value.profileId});
            try{return {profileId:value.profileId,revision:browser.state().revision,tabId:browser.state().activeTabId,
                ...(workflow.page.accountStatus||{status:workflow.page.accountRef && workflow.page.accountRef!=='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'?'identified':'unavailable'})};}
            finally{await browser.cancelWorkflow({workflowId:workflow.workflowId});}
        },
        async state(){return {...await request('state'),active:active?{batchId:active.batch.id,index:active.index,stage:active.stage,pauseRequested:active.pause}:null,recovering,error:lastError};},
        async start(value) {
            strict(value,['visionModel','summaryModel','whisperModel','videoName']);
            if(active || recovering || !binding)throw Error('Discover the source before starting a sequence, and wait for recovery to finish.');
            verifyProfile(binding.profileId);
            await request('preflight',{visionModel:value.visionModel,summaryModel:value.summaryModel,whisperModel:value.whisperModel});
            const batch=await request('create',{profileId:binding.profileId,sourceUrl:binding.sourceUrl,reels:binding.reels.map(r=>r.url),
                accountRef:binding.accountRef,visionModel:value.visionModel,summaryModel:value.summaryModel,whisperModel:value.whisperModel});
            return launch(batch,binding.accountTarget,binding.accountRef,value.videoName);
        },
        async resume(value) {
            strict(value,['batchId','accountTarget','videoName']);
            if(active || recovering || !ID.test(value.batchId))throw Error('A sequence is still stopping or recovering, or its ID is invalid.');
            recovering=true;
            try {
            const batch=(await request('state')).batches.find(b=>b.id===value.batchId);
            if(!batch)throw Error('Sequence unavailable.');
            verifyProfile(batch.profileId);
            // A saved sequence resumes from its conversation, even if a reel
            // or another tab was left open. The selected account is never changed.
            if(browser.state().url!==batch.sourceUrl || browser.state().ready===false || browser.workflowState?.().active?.status==='paused') {
                if(!browser.restoreWorkflowPage)throw Error('Open the source conversation in the selected account profile before resuming.');
                lastError=null;await browser.restoreWorkflowPage(batch.profileId,batch.sourceUrl);
            }
            const source=await sourcePage(batch.profileId,value.accountTarget);
            try {
                if(source.page.source.origin+source.page.source.path!==batch.sourceUrl || source.page.accountRef!==batch.accountRef)throw Error('Review the original conversation in its original account before resuming.');
            }finally{await browser.cancelWorkflow({workflowId:source.workflowId});}
            await request('preflight',{visionModel:batch.visionModel,summaryModel:batch.summaryModel,whisperModel:batch.whisperModel});
            return launch(batch,value.accountTarget,batch.accountRef,value.videoName);
            }finally{recovering=false;}
        },
        async pause(){if(active)active.pause=true;return {pauseRequested:!!active};},
        async cancel(){
            const run=active;if(!run)return {stopped:true};run.stop='cancel';
            await request('cancel',{batchId:run.batch.id});
            if(run.workflowId)await browser.cancelWorkflow({workflowId:run.workflowId}).catch(()=>{});
            // Lease is held until backend inference and cleanup settle.
            await run.pending;
            if(run.hold) {
                if(!await backendSettled(run))return {stopped:false};
                if(run.workflowId)await browser.releaseWorkflowMedia({workflowId:run.workflowId});
                await checkpoint(run,{status:'cancelled'});active=null;lastError=null;
            }
            return {stopped:true};
        },
        async clear(){if(active || recovering)throw Error('Cancel the sequence and wait for it to stop before clearing cache.');return request('clear');},
        async dispose(){if(active && !(await this.cancel()).stopped)throw Error('Wait for the local Reels worker to stop before exiting.');},
    };
}
module.exports={createReelsAnalyzer};
