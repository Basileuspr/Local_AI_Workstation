// Change the native surface only when its actual geometry/visibility changes.
// Disable background throttling after showing it (not while it is hidden).
function placeBrowserView(view,win,value) {
    const wc=view.webContents,b=value?.bounds;
    let bounds=null;
    if(win && value?.visible && b && [b.x,b.y,b.width,b.height].every(Number.isFinite)) {
        const [w,h]=win.getContentSize(),scale=win.webContents.getZoomFactor();
        const x=Math.max(0,Math.round(b.x*scale)),y=Math.max(0,Math.round(b.y*scale));
        const width=Math.min(w-x,Math.round(b.width*scale)),height=Math.min(h-y,Math.round(b.height*scale));
        if(width>0 && height>0)bounds={x,y,width,height};
    }
    let changed=false;
    if(bounds) {
        const old=view.getBounds();
        if(['x','y','width','height'].some(key=>old[key]!==bounds[key])){view.setBounds(bounds);changed=true;}
    }
    const visible=!!bounds;
    if(view.getVisible()!==visible){view.setVisible(visible);changed=true;}
    const throttle=!visible || win?.isVisible?.()===false || !!win?.isMinimized?.();
    if(wc.getBackgroundThrottling()!==throttle)wc.setBackgroundThrottling(throttle);
    return changed;
}
module.exports={placeBrowserView};
