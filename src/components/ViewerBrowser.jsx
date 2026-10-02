import {useContext,useEffect,useRef,useState} from 'react';
import {NavigationOpenContext} from './AppLayout';
import './ViewerBrowser.css';
import { WINDOW_LAYOUT_EVENT } from '../windowRendering';
import { FloatingToolBoundsContext, avoidFloatingTool } from '../floatingToolBounds';

export default function ViewerBrowser({active,onOpenSource}) {
  const desktop=typeof window!=='undefined' ? window.workstationDesktop : null;
  const supported=!!desktop?.startViewerBrowser, drawerOpen=useContext(NavigationOpenContext);
  const floatingTool = useContext(FloatingToolBoundsContext);
  const surface=useRef(null), address=useRef(null), revision=useRef(null), serial=useRef(0);
  const [status,setStatus]=useState({ready:false}),[url,setUrl]=useState(''),[error,setError]=useState('');
  const [catalog,setCatalog]=useState(null),[selected,setSelected]=useState(''),[source,setSource]=useState(null),[busy,setBusy]=useState(false);
  const [inspecting,setInspecting]=useState(false);
  const [privacy,setPrivacy]=useState(false),[clearKind,setClearKind]=useState('cookies');
  function observe(next) {
    if(revision.current!==next.revision){revision.current=next.revision;serial.current++;setCatalog(null);setSelected('');setSource(null);setBusy(false);}
    setStatus(next);
    if(document.activeElement!==address.current)setUrl(next.url==='about:blank'?'':next.url || '');
  }
  useEffect(()=>{
    if(!active || !supported)return;
    let stopped=false,timer;
    const poll=async()=>{try {const next=await desktop.viewerBrowserState();if(!stopped)observe(next);}catch {}finally{if(!stopped)timer=setTimeout(poll,500);}};
    desktop.startViewerBrowser().then(next=>{if(!stopped){observe(next);void poll();}}).catch(failure=>{if(!stopped)setError(failure.message);});
    return()=>{stopped=true;clearTimeout(timer);};
  },[active,supported,desktop]);
  useEffect(()=>desktop?.onViewerBrowserAddress?.(()=>{address.current?.focus();address.current?.select();}),[desktop]);
  useEffect(()=>{
    if(!supported)return;
    const place=()=>{const b=surface.current?.getBoundingClientRect();void desktop.placeViewerBrowser({visible:active && status.ready && !!status.url && status.url!=='about:blank' && !drawerOpen && !inspecting && !privacy,bounds:b && avoidFloatingTool({x:b.x,y:b.y,width:b.width,height:b.height}, floatingTool)}).catch(()=>{});};
    place();const observer=new ResizeObserver(place);if(surface.current)observer.observe(surface.current);
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    window.addEventListener(WINDOW_LAYOUT_EVENT,place);
    return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.removeEventListener(WINDOW_LAYOUT_EVENT,place);void desktop.placeViewerBrowser({visible:false}).catch(()=>{});};
  },[active,status.ready,status.url,drawerOpen,inspecting,privacy,supported,desktop,floatingTool]);
  async function navigate(event,target=url){event?.preventDefault();setError('');setInspecting(false);try{const next=await desktop.navigateViewerBrowser(target);if(next.error)throw new Error(next.error);observe(next);}catch(failure){setError(failure.message);}}
  async function command(action){setError('');try{const next=await desktop.viewerBrowserCommand(action);if(next.error)throw new Error(next.error);observe(next);}catch(failure){setError(failure.message);}}
  async function inspect(){
    setBusy(true);setError('');setInspecting(true);const ticket=++serial.current;
    try{const next=await desktop.inspectViewerBrowser();if(next.error)throw new Error(next.error);if(ticket===serial.current){setCatalog(next);setSelected('');setSource(null);}}
    catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  async function select(id){
    setSelected(id);setSource(null);setError('');const ticket=++serial.current;setBusy(true);
    try{const next=await desktop.viewerBrowserSource(id);if(next.error)throw new Error(next.error);if(ticket===serial.current)setSource(next);}
    catch(failure){if(ticket===serial.current)setError(failure.message);}finally{if(ticket===serial.current)setBusy(false);}
  }
  return <section className="viewer-browser" aria-label="Web browser">
    <form className="browser-toolbar" onSubmit={navigate}>
      <button type="button" disabled={!supported || !status.back} onClick={()=>command('back')} aria-label="Back">←</button>
      <button type="button" disabled={!supported || !status.forward} onClick={()=>command('forward')} aria-label="Forward">→</button>
      <button type="button" disabled={!supported || !status.ready} onClick={()=>command(status.loading?'stop':'reload')}>{status.loading?'Stop':'Reload'}</button>
      <input ref={address} aria-label="Page address" placeholder="https://example.com" value={url} onChange={event=>setUrl(event.target.value)} disabled={!supported}/>
      <button disabled={!supported || !url.trim()}>Go</button>
    </form>
    <div className="browser-toolbar"><button disabled={!supported || !status.ready || status.url==='about:blank' || busy} onClick={inspect}>{busy?'Reading source…':'Inspect page'}</button>
      <button disabled={!status.ready} onClick={()=>{setInspecting(false);}}>Browse page</button>
      <button disabled={!status.ready} onClick={()=>command('close')}>Close page</button>
      <button disabled={!supported} aria-expanded={privacy} onClick={()=>setPrivacy(value=>!value)}>Browser privacy</button>
      <span>{status.title || 'Browser'}{status.loading?' · Loading…':''}</span>
    </div>
    {!supported && <p>Open the desktop app to browse pages. If the app is already open, fully quit and reopen it after this update.</p>}
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
    {status.notice && <p role="status">{status.notice}</p>}
    {privacy && <section className="browser-privacy" aria-label="Browser privacy">
      <h2>Browser privacy</h2>

      <p>Profile location: <code>{status.profilePath || 'Open Browser to initialize its profile.'}</code></p>

      <label>Clear browser data <select value={clearKind} onChange={event=>setClearKind(event.target.value)}>
        <option value="cookies">Cookies / site login data</option><option value="cache">Cache</option>
        <option value="site">LocalStorage / site data</option><option value="all">All browser data</option>
      </select></label>
      <button disabled={busy || status.clearing} onClick={async()=>{setBusy(true);setError('');try{const next=await desktop.clearViewerBrowserData(clearKind);if(next.error)throw Error(next.error);observe(next);}catch(failure){setError(failure.message);}finally{setBusy(false);}}}>Clear selected data…</button>


    </section>}
    {status.popup && <p>A page requested another window. <button onClick={()=>navigate(null,status.popup)}>Open linked page here</button></p>}
    <div ref={surface} className="browser-surface" hidden={inspecting || privacy}>
      {!status.url || status.url==='about:blank' ? <p>Enter a public page address to begin. F6 or Ctrl+L returns to the address bar.</p> : null}
    </div>
    {inspecting && <section className="browser-inspector" aria-label="Page sources">
      <p>{catalog?.pageUrl || 'Inspecting the current page…'}</p>
      <label>Detected source<select aria-label="Detected source" value={selected} onChange={event=>select(event.target.value)}><option value="">Choose HTML, CSS, or JavaScript ({catalog?.items.length || 0})</option>
        {catalog?.items.map(item=><option key={item.id} value={item.id}>{item.kind.toUpperCase()} · {item.name}</option>)}
      </select></label>
      {source && <><div className="browser-toolbar"><button onClick={()=>onOpenSource(source)}>Open in {source.kind==='js'?'JavaScript':source.kind.toUpperCase()} Viewer</button><span>{source.truncated?'Source truncated at the inspection size limit':'Loaded source'}</span></div>
        <textarea aria-label="Inspected source" readOnly value={source.text} spellCheck={false}/></>}
    </section>}

  </section>;
}
