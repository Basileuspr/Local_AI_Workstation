// Executed only as fixed host code in world 1001. Never accept a script, CSS
// selector, debugger command, coordinate, or cookie request from a caller.
function pageOperation(request) {
    if(Date.now()>request.deadline)return {error:'timeout'};
    const uuid=()=>{const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
        const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
    const key='__law_browser_tools_v1';
    if(!globalThis[key])globalThis[key]={document:uuid(),elements:new Map()};
    const state=globalThis[key];
    const sensitive=/password|passwd|secret|token|cookie|authorization|session|csrf|otp|one.?time|verification.?code|credit.?card|security.?code|auth|mfa/i;
    const clean=(value,limit=200)=>String(value||'').replace(/https?:\/\/[^\s"<>]+/gi,raw=>{try {const u=new URL(raw);return u.origin+u.pathname;}catch{return '[address]';}})
        .replace(/(?:authorization|proxy-authorization|set-cookie|cookie)\s*[:=]\s*[^\r\n]*/gi,'[redacted]')
        .replace(/(?:(?:bearer|basic)\s+|(?:password|token|secret|session|sessionid|csrf|code|state|api[_-]?key|signature)\s*[:=]\s*)[^\s,;]+/gi,'[redacted]').slice(0,limit);
    const visible=e=>e.isConnected && !!e.getClientRects().length && getComputedStyle(e).visibility!=='hidden' && !e.closest('[hidden],[aria-hidden="true"]');
    const role=e=>e.getAttribute('role') || ({BUTTON:'button',A:'link',SELECT:'combobox',TEXTAREA:'textbox',VIDEO:'video'}[e.tagName])
        || (e.tagName==='INPUT'?(['button','submit','reset'].includes(e.type)?'button':['checkbox','radio'].includes(e.type)?e.type:'textbox'):'');
    const name=e=>clean(e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()
        || [...(e.labels||[])].map(l=>l.textContent).join(' ') || (e.tagName==='INPUT'?e.getAttribute('placeholder'):e.tagName==='VIDEO'?e.getAttribute('title'):e.innerText) || e.getAttribute('title'));
    const credential=e=>e.tagName==='INPUT' && ['password','email','hidden'].includes(e.type) || sensitive.test([e.getAttribute('name'),e.id,e.getAttribute('autocomplete'),e.getAttribute('aria-label'),name(e)].join(' '));
    const challengeNodes=[...document.querySelectorAll('input[type=password],input[autocomplete=one-time-code],iframe[src*="captcha"],[role=dialog]')].filter(visible);
    const text=(document.body?.innerText||'').slice(0,20000);
    const challenge=challengeNodes.some(e=>e.tagName!=='DIV' || /sign.?in|log.?in|verify|captcha|authentication|two.?factor/i.test(e.innerText||''))
        || /\/accounts\/login|\/login|\/challenge|\/checkpoint|\/oauth\/|\/signin/i.test(location.pathname)
        || /session (?:has )?expired|verify (?:your )?identity|enter (?:the )?(?:verification|security) code|confirm you(?:'|’)re human/i.test(text);
    const accountLabel=/^(?:current account|signed in as|account identity)(?:\b|:)/i;
    const genericIdentity=/^(?:account|accounts|account menu|menu|profile|your profile|profile picture|avatar|avatar image|sign in|log in|switch account|select account|current account|signed in as|account identity)$/i;
    const identities=[];
    for(const e of document.querySelectorAll('[aria-label]')) {
        if(!visible(e) || !accountLabel.test(e.getAttribute('aria-label')||'') || credential(e))continue;
        const label=e.getAttribute('aria-label')||'';
        const details=[label.replace(accountLabel,'').replace(/^[:\s]+/,''),e.innerText||'',e.querySelector('img')?.getAttribute('alt')||'']
            .map(value=>clean(value).trim()).filter(value=>value && !genericIdentity.test(value));
        if(!details.length)continue;
        // Retain the existing marker serialization for meaningful checkpoints.
        const value=clean(label+' '+(e.innerText||'')+' '+(e.querySelector('img')?.getAttribute('alt')||'')+' '+(e.tagName==='A'?new URL(e.href).pathname:''));
        identities.push({e,value});
    }
    // Read only the visible active-account header, never creator/channel links
    // elsewhere on a video page. A static "Account menu" button proves nothing.
    if(/^(?:(?:www|m)\.)?youtube\.com$/i.test(location.hostname))for(const e of document.querySelectorAll('ytd-active-account-header-renderer')) {
        if(!visible(e))continue;
        const handle=e.querySelector('#channel-handle'),title=e.querySelector('#account-name');
        const value=handle && visible(handle)?clean(handle.innerText).trim():'';
        const titleValue=title && visible(title)?clean(title.innerText).trim():'';
        if(/^@[^\s<>/@]{2,100}$/.test(value))identities.push({e,value:'youtube:'+value+'|'+titleValue});
    }
    const selected=request.accountTarget?identities.filter(({e})=>role(e)===request.accountTarget.role && name(e)===request.accountTarget.name):identities;
    const values=[...new Set(selected.map(({value})=>value))];
    const account=values.length===1?values[0]:'';
    const accountStatus={status:account?'identified':values.length>1?'ambiguous':'unavailable',message:account?'Signed-in account identified.':values.length>1
        ?'More than one account identity is visible. Close account-switching menus and check again.'
        :'Signed-in account could not be identified. Open the website’s account menu so your name or handle is visible, then check again. If it is still unidentified, automatic account checks are not supported on this page.'};
    if(request.document && request.document!==state.document)return {error:'stale_document'};
    if(challenge)return {document:state.document,ready:document.readyState,challenge:true,account:'',elements:[],text:''};
    if(request.accountTarget && (!account || selected.length!==1))return {error:'unsupported_account_control'};
    if(request.account!==undefined && request.account!==account)return {error:'account_changed'};
    if(request.action==='reels') {
        const reels=new Map();
        for(const a of document.querySelectorAll('a[href]')) {
            if(!visible(a))continue;
            try {
                const u=new URL(a.href),match=u.pathname.match(/^\/reels?\/([a-zA-Z0-9_-]{1,64})\/?$/);
                if(u.origin!==location.origin || !match)continue;
                reels.set(match[1],{id:match[1],url:u.origin+u.pathname.replace(/\/$/,'')+'/'});
            }catch{}
        }
        return {document:state.document,account,reels:[...reels.values()].slice(0,100),untrusted:true};
    }
    if(request.action==='read' || request.action==='discover') {
        state.elements.clear();
        const elements=[];
        for(const e of [...document.querySelectorAll('button,a[href],input:not([type=hidden]),textarea,select,video,[role]')].filter(visible).slice(0,300)) {
            if(credential(e))continue;
            const r=role(e), n=name(e);if(!r)continue;
            if(request.target && (r!==request.target.role || n!==request.target.name))continue;
            const id=uuid();state.elements.set(id,{e,role:r,name:n,href:e.getAttribute('href'),type:e.getAttribute('type')});
            elements.push({id,role:r,name:n,disabled:!!e.disabled});
        }
        // Read rendered prose, never HTML/scripts/hidden fields or form values.
        const walker=document.createTreeWalker(document.body||document.documentElement,NodeFilter.SHOW_TEXT);
        let node,output='';
        while((node=walker.nextNode()) && output.length<8000) {
            const p=node.parentElement;
            if(p && visible(p) && !p.closest('script,style,noscript,input,textarea,select,[contenteditable],[data-private],ytd-active-account-header-renderer') && !credential(p))output+=clean(node.textContent)+' ';
        }
        return {document:state.document,ready:document.readyState,challenge:false,account,accountStatus,elements,text:output.slice(0,8000),untrusted:true};
    }
    const found=request.element && state.elements.get(request.element), e=found?.e;
    if(request.element && (!e || !visible(e) || role(e)!==found.role || name(e)!==found.name || e.getAttribute('href')!==found.href || e.getAttribute('type')!==found.type))return {error:'stale_element'};
    if(e && (credential(e) || e.disabled || e.readOnly))return {error:'unsafe_element'};
    if(e && [...document.querySelectorAll('button,a[href],input:not([type=hidden]),textarea,select,video,[role]')].filter(n=>visible(n) && role(n)===found.role && name(n)===found.name).length!==1)return {error:'ambiguous_element'};
    if(request.action==='click') {
        if(!['button','link','checkbox','radio'].includes(found.role))return {error:'unsupported_element'};
        if(found.role==='link') {
            const u=new URL(e.href);
            if(u.protocol!=='https:' && !request.fixture || !request.origins.includes(u.origin))return {error:'unexpected_destination'};
        }
        const form=e.form;
        if(form && e.type==='submit' && !request.origins.includes(new URL(form.action).origin))return {error:'unexpected_destination'};
        e.click();return {document:state.document,account,clicked:true};
    }
    if(request.action==='fill') {
        if(!['INPUT','TEXTAREA'].includes(e.tagName) || !['text','search','url','tel',''].includes(e.type||'') && e.tagName!=='TEXTAREA' || sensitive.test(request.value))return {error:'unsafe_field'};
        const prototype=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(e,request.value);
        e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
        return {document:state.document,account,filled:e.value===request.value};
    }
    if(request.action==='scroll') {
        const before=scrollY;window.scrollBy({top:request.amount,behavior:'instant'});
        return {document:state.document,account,scrolled:scrollY!==before,atBoundary:scrollY===before};
    }
    if(request.action==='media') {
        if(e?.tagName!=='VIDEO')return {error:'unsupported_media'};
        const articleCaption=e.closest('article')?.querySelector('figcaption');
        const pageCaption=document.querySelector('meta[property="og:description"]');
        const caption=articleCaption?.innerText||pageCaption?.content||'';
        if(e.querySelectorAll('track').length>16)return {error:'unsupported_caption_count'};
        return {document:state.document,account,source:e.currentSrc||e.src,duration:Number.isFinite(e.duration)?e.duration:null,
            separateAudio:[...document.querySelectorAll('audio')].some(a=>a.currentSrc||a.getAttribute('src')||a.querySelector('source[src]')),
            ready:e.readyState,tracks:[...e.querySelectorAll('track')].map(t=>({src:t.src,kind:t.kind,language:t.srclang})).slice(0,16),
            caption:clean(caption,8000),captionTruncated:caption.length>8000,
            captionSource:articleCaption?'selected-article':pageCaption?'page-metadata':'unverified'};
    }
    return {error:'unsupported_operation'};
}
module.exports={pageOperation};
