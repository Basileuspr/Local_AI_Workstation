const fs=require('node:fs');

// Chromium supplies cookies from precisely this session. They are never read
// by the application. Redirects are returned to the policy checker, never
// followed automatically. No caller can supply headers or cookie values.
function transfer({session,url,file,limit,signal,check}) {
    const {net}=require('electron');
    return new Promise((resolve,reject)=>{
        let settled=false,output=null,received=0;
        const request=net.request({url,session,credentials:'include',redirect:'manual',cache:'no-store',referrerPolicy:'no-referrer'});
        function finish(error,result) {
            if(settled)return;settled=true;
            signal.removeEventListener('abort',abort);
            if(output!==null){fs.closeSync(output);output=null;}
            request.abort();
            if(error)reject(Error(error));else resolve(result);
        }
        const abort=()=>finish('transfer_aborted');
        signal.addEventListener('abort',abort,{once:true});
        request.on('redirect',(_status,_method,redirect)=>finish(null,{redirect}));
        request.on('login',(_info,callback)=>{callback();finish('reauthentication_required');});
        request.on('error',()=>finish('acquisition_failed'));
        request.on('abort',()=>finish('transfer_aborted'));
        // The response stream (or the abort/deadline) owns completion. Chromium
        // may close its request handle before delivering the queued response.
        request.on('response',response=>{
            const header=name=>{const value=response.headers[name];return String(Array.isArray(value)?value[0]||'':value||'');};
            if([401,403,410].includes(response.statusCode))return finish('media_address_expired');
            if(response.statusCode!==200)return finish('unsupported_acquisition');
            const declared=Number(header('content-length'));
            if(!Number.isSafeInteger(declared) || declared<=0 || declared>limit || header('content-encoding'))return finish('unsupported_complete_length');
            try{check();output=fs.openSync(file,'wx');}catch(error){return finish(/^[a-z_]+$/.test(error.message)?error.message:'workspace_unavailable');}
            response.on('data',chunk=>{
                if(settled)return;
                try {
                    check();received+=chunk.byteLength;
                    if(received>declared || received>limit)return finish('media_size_limit');
                    fs.writeSync(output,chunk);
                } catch(error) {finish(/^[a-z_]+$/.test(error.message)?error.message:'transfer_failed');}
            });
            response.on('error',()=>finish('incomplete_transfer'));
            response.on('aborted',()=>finish('incomplete_transfer'));
            response.on('end',()=>finish(received!==declared?'incomplete_transfer':null,{bytes:received,type:header('content-type')}));
        });
        if(signal.aborted)return abort();
        request.end();
    });
}
module.exports={transfer};
