'use strict';

const CHANNELS=['browser','media-manager','integrations'];
function normalizeNativeMix(value) {
    if(!value || typeof value!=='object' || !Number.isFinite(value.volume) || value.volume<0 || value.volume>1 || typeof value.muted!=='boolean')throw Error('Invalid mixer settings.');
    const channels={};
    for(const id of CHANNELS) {
        const channel=value.channels?.[id];
        if(!channel || !Number.isFinite(channel.volume) || channel.volume<0 || channel.volume>1 || typeof channel.muted!=='boolean')throw Error('Invalid mixer channel.');
        channels[id]={volume:channel.volume,muted:channel.muted};
    }
    return {volume:value.volume,muted:value.muted,channels};
}
// Fixed player-volume code only. IPC accepts bounded numbers and booleans.
function applyPlayerVolume(volume) {
    const key='__lawPlayerMix';
    if(globalThis[key]) {globalThis[key].set(volume);return;}
    const players=new WeakMap(), active=new Set(), roots=new WeakSet();let gain=volume;
    const update=media=>{
        active.add(media);
        let value=players.get(media);
        if(!value) {
            value={base:media.volume,expected:media.volume};players.set(media,value);
            media.addEventListener('volumechange',()=>{
                if(Math.abs(media.volume-value.expected)<.00001)return;
                value.base=Math.min(1,Math.max(0,gain?media.volume/gain:media.volume));update(media);
            });
        }
        value.expected=Math.min(1,Math.max(0,value.base*gain));
        if(Math.abs(media.volume-value.expected)>.00001)media.volume=value.expected;
    };
    const scan=(root=document,depth=0)=>{
        if(depth>8)return;
        if(root.matches?.('audio,video'))update(root);
        if(root.shadowRoot)scan(root.shadowRoot,depth+1);
        root.querySelectorAll('audio,video').forEach(update);
        if((root===document || root.host) && !roots.has(root)) {
            roots.add(root);
            new MutationObserver(records=>{
                for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1)scan(node,depth);
                for(const media of active)if(!media.isConnected)active.delete(media);
            }).observe(root,{childList:true,subtree:true});
        }
        root.querySelectorAll('*').forEach(node=>{if(node.shadowRoot)scan(node.shadowRoot,depth+1);});
    };
    globalThis[key]={set(value){gain=value;for(const media of active){if(media.isConnected)update(media);else active.delete(media);}}};scan();
}
function createNativeMixer(channel) {
    let value={volume:1,muted:false}, master={volume:1,muted:false};
    const contents=new Set(), installed=new WeakSet();
    function apply(wc) {
        if(wc.isDestroyed?.()) {contents.delete(wc);return;}
        const volume=master.volume*value.volume;
        wc.setAudioMuted?.(master.muted || value.muted || volume===0);
        if(volume===1 && !installed.has(wc))return;
        installed.add(wc);
        const code=`(${applyPlayerVolume.toString()})(${volume})`;
        try {
            const frames=wc.mainFrame?.framesInSubtree || [wc.mainFrame];
            for(const frame of frames)if(frame?.executeJavaScript) {
                try{void frame.executeJavaScript(code).catch(()=>{});}catch{}
            }
        }catch{} // A renderer may disappear between checking it and accessing its frames.
    }
    return {watch(wc){contents.add(wc);apply(wc);wc.on?.('did-frame-finish-load',()=>apply(wc));wc.once?.('destroyed',()=>contents.delete(wc));},
        configure(next){master=next;value=next.channels[channel];for(const wc of contents)apply(wc);}};
}
module.exports={normalizeNativeMix,createNativeMixer,applyPlayerVolume};
