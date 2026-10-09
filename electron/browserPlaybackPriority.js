const os=require('node:os');

// Only this browser's visible, playing renderer receives a modest Windows CPU
// boost. Restore the previous class on pause/hide/navigation; never touch AI jobs.
function createBrowserPlaybackPriority({isVisible,platform=process.platform,priority=os}) {
    const records=new Map();let watchedWindow=null;
    function restore(wc,row) {
        if(row.previous===undefined)return;
        try {
            // A dead/replaced renderer must not target a reused OS process ID.
            if(!wc.isDestroyed() && wc.getOSProcessId()===row.pid && priority.getPriority(row.pid)===priority.constants.priority.PRIORITY_ABOVE_NORMAL)
                priority.setPriority(row.pid,row.previous);
        }catch{}
        row.previous=undefined;row.pid=null;
    }
    function sync() {
        if(platform!=='win32')return;
        for(const [wc,row] of records) {
            let visible=false,pid;
            try {visible=row.playing && !wc.isDestroyed() && isVisible(wc);if(visible)pid=wc.getOSProcessId();}catch{}
            if(!visible){restore(wc,row);continue;}
            if(row.pid!==pid)restore(wc,row);
            if(row.previous!==undefined || !Number.isInteger(pid) || pid<=0)continue;
            try {
                const previous=priority.getPriority(pid),desired=priority.constants.priority.PRIORITY_ABOVE_NORMAL;
                if(previous>desired){priority.setPriority(pid,desired);row.previous=previous;row.pid=pid;}
            }catch{} // Permission/renderer races leave normal playback available.
        }
    }
    const windowEvents=['show','restore','hide','minimize'];
    function unwatchWindow(){if(watchedWindow)for(const name of windowEvents)watchedWindow.removeListener(name,sync);watchedWindow=null;}
    return {
        sync,
        watch(wc,win) {
            if(platform!=='win32' || records.has(wc))return;
            if(win!==watchedWindow){unwatchWindow();watchedWindow=win;for(const name of windowEvents)win?.on(name,sync);}
            const row={playing:false},listen=(name,fn)=>{wc.on(name,fn);row.removers.push(()=>wc.removeListener(name,fn));};
            row.removers=[];records.set(wc,row);
            listen('media-started-playing',()=>{row.playing=true;sync();});
            listen('media-paused',()=>{row.playing=false;sync();});
            listen('did-start-navigation',(_event,_url,inPlace,mainFrame)=>{if(mainFrame && !inPlace){row.playing=false;sync();}});
            listen('render-process-gone',()=>{row.playing=false;restore(wc,row);});
            listen('destroyed',()=>{restore(wc,row);for(const remove of row.removers)remove();records.delete(wc);});
        },
        reset(){for(const row of records.values())row.playing=false;sync();},
        dispose(){for(const [wc,row] of records){restore(wc,row);for(const remove of row.removers)remove();}records.clear();unwatchWindow();},
    };
}
module.exports={createBrowserPlaybackPriority};
