const {redactSecrets}=require('./redactSecrets');

// Named read-only fallback. The user chooses and navigates the Browser page.
// No JS, cookies, account fields, URLs or selectors are accepted from a model.
function createWebResearch({browser,request,busy=()=>false}) {
    return {
        background:enabled=>{if(typeof enabled!=='boolean')throw Error('Choose enable or disable monitoring.');return request('/web-system/background',{enabled});},
        read:async id=>{
            if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw Error('Select a current research request.');
            if(busy())throw Error('Pause or cancel Reels processing before reading this browser page.');
            const initial=browser.state();const url=new URL(initial.url);
            if(url.protocol!=='https:'||url.username||url.password||[...url.searchParams.keys()].some(k=>/token|secret|password|signature|session|authorization|api.?key|csrf|cookie/i.test(k)||/^(sig|key|code|state|nonce|auth|jwt|ticket|sso)$/i.test(k)))throw Error('Choose a public HTTPS page with a stable address.');
            let workflow;
            try {
                workflow=await browser.startWorkflow({profileId:initial.selected});
                const page=await browser.browserTool({workflowId:workflow.workflowId,action:'read',timeoutMs:10000});
                const current=browser.state();
                if(current.selected!==initial.selected||current.url!==initial.url||page.pageRef!==workflow.page.pageRef)throw Error('The browser document changed during capture.');
                return await request(`/web-system/research/${id}/browser-page`,{url:initial.url,title:redactSecrets(initial.title||url.hostname).slice(0,300),text:redactSecrets(page.text).slice(0,8000)});
            } finally {if(workflow)await browser.cancelWorkflow();}
        },
    };
}
module.exports={createWebResearch};
