// Unsaved edits survive tab switches in RAM, never localStorage or a backend.
let pending=null;
export const pendingEditor=()=>pending;
export const retainEditor=value=>{pending=value;};
if(typeof window!=='undefined')window.addEventListener('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
