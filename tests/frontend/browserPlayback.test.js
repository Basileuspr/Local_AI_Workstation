import {createRequire} from 'node:module';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {EventEmitter} from 'node:events';
import {claimBrowserSurface,createBrowserPlacementScheduler,visibleSurfaceBounds} from '../../src/browserPlacement';
const require=createRequire(import.meta.url),{createBrowserRequestGate}=require('../../electron/browserPolicy');
const {placeBrowserView}=require('../../electron/browserPlacement');
const {createBrowserPlaybackPriority}=require('../../electron/browserPlaybackPriority');
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('native surface pane boundaries',()=>{
  it('clips a scrolled Browser to its own pane and hides it once the surface is outside the viewport',()=>{
    const pane={clientLeft:0,clientTop:0,clientWidth:420,clientHeight:300,parentElement:null,
      getBoundingClientRect:()=>({left:600,top:100,right:1020,bottom:400})};
    let rect={left:600,top:250,right:1020,bottom:700};
    const surface={parentElement:pane,getClientRects:()=>[rect],getBoundingClientRect:()=>rect};
    vi.stubGlobal('window',{innerWidth:1000,innerHeight:700,getComputedStyle:()=>({overflowX:'hidden',overflowY:'auto'})});
    expect(visibleSurfaceBounds(surface)).toEqual({x:600,y:250,width:400,height:150});
    rect={left:600,top:450,right:1020,bottom:900};expect(visibleSurfaceBounds(surface)).toBeNull();
    expect(visibleSurfaceBounds({getClientRects:()=>[]})).toBeNull();
  });
});

describe('shared native browser ownership',()=>{
  it('does not let a secondary account panel hide the visible Browser and hands the page back without closing it',()=>{
    const desktop={placeViewerBrowser:vi.fn(async()=>{})},browserChanged=vi.fn(),accountChanged=vi.fn();
    const browser=claimBrowserSurface(desktop,browserChanged,1),account=claimBrowserSurface(desktop,accountChanged,0);
    expect(browser.owns()).toBe(true);expect(account.owns()).toBe(false);
    expect(desktop.placeViewerBrowser).not.toHaveBeenCalled();
    browser.release();expect(browser.owns()).toBe(false);expect(account.owns()).toBe(true);
    expect(accountChanged).toHaveBeenLastCalledWith(true);
    expect(desktop.placeViewerBrowser).toHaveBeenCalledOnce();
    browser.release();expect(desktop.placeViewerBrowser).toHaveBeenCalledOnce();
    account.release();expect(desktop.placeViewerBrowser).toHaveBeenLastCalledWith({visible:false});
  });
  it('leaves an existing owner unchanged when a non-owning account panel unmounts',()=>{
    const desktop={placeViewerBrowser:vi.fn(async()=>{})};
    const browser=claimBrowserSurface(desktop,()=>{},1),account=claimBrowserSurface(desktop,()=>{},0);
    account.release();expect(browser.owns()).toBe(true);expect(desktop.placeViewerBrowser).not.toHaveBeenCalled();
    browser.release();
  });
});
describe('visible playback CPU priority',()=>{
  it('restores the exact previous priority on hide and pause, never lowers an already higher priority, and removes listeners',()=>{
    let shown=true,current=0;const wc=new EventEmitter(),win=new EventEmitter();wc.isDestroyed=()=>false;wc.getOSProcessId=()=>123;
    const priority={constants:{priority:{PRIORITY_ABOVE_NORMAL:-7}},getPriority:()=>current,setPriority:vi.fn((_pid,value)=>{current=value;})};
    const controller=createBrowserPlaybackPriority({platform:'win32',isVisible:()=>shown,priority});controller.watch(wc,win);
    wc.emit('media-started-playing');expect(current).toBe(-7);shown=false;win.emit('hide');expect(current).toBe(0);
    shown=true;win.emit('show');expect(current).toBe(-7);wc.emit('media-paused');expect(current).toBe(0);
    current=-14;wc.emit('media-started-playing');expect(current).toBe(-14);wc.emit('media-paused');expect(current).toBe(-14);
    controller.dispose();expect(wc.eventNames()).toEqual([]);expect(win.eventNames()).toEqual([]);
  });
  it('leaves unsupported platforms and permission failures usable without modifying other processes',()=>{
    const wc=new EventEmitter();wc.isDestroyed=()=>false;wc.getOSProcessId=()=>123;
    const priority={constants:{priority:{PRIORITY_ABOVE_NORMAL:-7}},getPriority:()=>0,setPriority:vi.fn(()=>{throw Error('denied');})};
    const controller=createBrowserPlaybackPriority({platform:'win32',isVisible:()=>true,priority});controller.watch(wc,new EventEmitter());
    expect(()=>wc.emit('media-started-playing')).not.toThrow();controller.dispose();
    const unsupported=createBrowserPlaybackPriority({platform:'linux',isVisible:()=>true,priority});unsupported.watch(wc,null);unsupported.sync();unsupported.dispose();
    expect(wc.eventNames()).toEqual([]);expect(priority.setPriority).toHaveBeenCalledWith(123,-7);
  });
});
describe('stream request checks',()=>{
  it('shares concurrent segment/CDN DNS work and revalidates later requests, including private rebinding answers',async()=>{
    let complete;const lookup=vi.fn(()=>new Promise(resolve=>{complete=resolve;}));
    const gate=createBrowserRequestGate(lookup);
    const burst=Array.from({length:100},(_,i)=>gate.allowed(`https://video.example.com/segment/${i}`));
    await Promise.resolve();expect(lookup).toHaveBeenCalledOnce();
    complete({endpoints:[{address:'8.8.8.8'}]});expect((await Promise.all(burst)).every(Boolean)).toBe(true);
    const later=gate.allowed('https://video.example.com/next');await Promise.resolve();expect(lookup).toHaveBeenCalledTimes(2);
    complete({endpoints:[{address:'127.0.0.1'}]});expect(await later).toBe(false);
    expect(await gate.allowed('file:///C:/secret')).toBe(false);expect(await gate.allowed('http://127.0.0.1')).toBe(false);
    gate.dispose();expect(await gate.allowed('https://example.com')).toBe(false);
  });
  it('bounds DNS stalls and rejects requests rather than hanging stream admission',async()=>{
    vi.useFakeTimers();const gate=createBrowserRequestGate(()=>new Promise(()=>{}),{timeoutMs:100,maxPending:1});
    const slow=gate.allowed('https://video.example.com/segment');await Promise.resolve();
    expect(await gate.allowed('https://other.example.com/')).toBe(false);
    await vi.advanceTimersByTimeAsync(100);expect(await slow).toBe(false);gate.dispose();
  });
});
describe('native video surface placement',()=>{
  function fixture(){
    let visible=false,bounds={x:0,y:0,width:0,height:0},throttle=true;
    const wc={getBackgroundThrottling:()=>throttle,setBackgroundThrottling:vi.fn(value=>{throttle=value;})};
    const view={webContents:wc,getVisible:()=>visible,getBounds:()=>bounds,setVisible:vi.fn(value=>{visible=value;}),setBounds:vi.fn(value=>{bounds=value;})};
    const win={isVisible:()=>true,isMinimized:()=>false,getContentSize:()=>[1000,800],webContents:{getZoomFactor:()=>1}};
    return {view,win,wc};
  }
  it('does not resize, toggle visibility or reset throttling when an unchanged layout is repeated',()=>{
    const {view,win,wc}=fixture(),placement={visible:true,bounds:{x:10,y:100,width:900,height:600}};
    expect(placeBrowserView(view,win,placement)).toBe(true);
    for(let i=0;i<100;i++)expect(placeBrowserView(view,win,placement)).toBe(false);
    expect(view.setBounds).toHaveBeenCalledOnce();expect(view.setVisible).toHaveBeenCalledOnce();expect(wc.setBackgroundThrottling).toHaveBeenCalledOnce();
    expect(wc.setBackgroundThrottling).toHaveBeenCalledWith(false);
    expect(placeBrowserView(view,win,{visible:false})).toBe(true);expect(wc.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
  });
  it('clips to the window and throttles hidden/minimized hosts while preserving sandbox preferences',()=>{
    const {view,win,wc}=fixture();win.isMinimized=()=>true;
    placeBrowserView(view,win,{visible:true,bounds:{x:900,y:700,width:400,height:300}});
    expect(view.getBounds()).toEqual({x:900,y:700,width:100,height:100});expect(wc.getBackgroundThrottling()).toBe(true);
    expect(placeBrowserView(view,win,{visible:true,bounds:{x:NaN,y:0,width:100,height:100}})).toBe(true);expect(view.getVisible()).toBe(false);
  });
});
describe('renderer placement scheduling',()=>{
  it('merges scroll/resize bursts, skips identical IPC and cancels obsolete frames without hiding a playing page',async()=>{
    let frame,placement={visible:true,bounds:{x:0,y:0,width:500,height:400}};
    const win={requestAnimationFrame:vi.fn(fn=>{frame=fn;return 1;}),cancelAnimationFrame:vi.fn()};
    const send=vi.fn(async()=>{}),scheduler=createBrowserPlacementScheduler({window:win,measure:()=>placement,send});
    for(let i=0;i<100;i++)scheduler.schedule();expect(win.requestAnimationFrame).toHaveBeenCalledOnce();frame();await Promise.resolve();expect(send).toHaveBeenCalledOnce();
    scheduler.schedule();frame();await Promise.resolve();expect(send).toHaveBeenCalledOnce();
    placement={visible:true,bounds:{x:0,y:2,width:500,height:400}};scheduler.schedule();frame();await Promise.resolve();expect(send).toHaveBeenCalledTimes(2);
    scheduler.schedule();scheduler.dispose();expect(win.cancelAnimationFrame).toHaveBeenCalled();frame();await Promise.resolve();expect(send).toHaveBeenCalledTimes(2);
  });
});
