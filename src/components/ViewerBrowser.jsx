import {useContext,useEffect,useId,useRef,useState} from 'react';
import {NavigationOpenContext} from './AppLayout';
import './ViewerBrowser.css';
import { WINDOW_LAYOUT_EVENT } from '../windowRendering';
import { FloatingToolBoundsContext, avoidFloatingTool } from '../floatingToolBounds';
import BrowserBookmarks from './BrowserBookmarks';
import {claimBrowserSurface,createBrowserPlacementScheduler,visibleSurfaceBounds} from '../browserPlacement';
import {beginBrowserWorkflow,workflowCheckpoint} from '../browserWorkflowRecovery';
import BrowserAccountStatus from './BrowserAccountStatus';

export default function ViewerBrowser({active,onOpenSource,accountOnly=false}) {
  const desktop=typeof window!=='undefined' ? window.workstationDesktop : null;
  const supported=!!desktop?.startViewerBrowser, drawerOpen=useContext(NavigationOpenContext);
  const floatingTool = useContext(FloatingToolBoundsContext);
  const surface=useRef(null), address=useRef(null), revision=useRef(null), serial=useRef(0);
  const observedStatus=useRef('');
  const observedTab=useRef(null),surfaceId=`browser-page-${useId()}`;
  const [status,setStatus]=useState({ready:false}),[url,setUrl]=useState(''),[error,setError]=useState('');
  const [ownsSurface,setOwnsSurface]=useState(false),surfaceClaim=useRef(null);
  const [catalog,setCatalog]=useState(null),[selected,setSelected]=useState(''),[source,setSource]=useState(null),[busy,setBusy]=useState(false);
  const [inspecting,setInspecting]=useState(false);
  const [privacy,setPrivacy]=useState(false),[clearKind,setClearKind]=useState('cookies');
  const [bookmarks,setBookmarks]=useState(false),[bookmarkPage,setBookmarkPage]=useState(null);
  const [tabSettings,setTabSettings]=useState(false),[inactiveMinutes,setInactiveMinutes]=useState('2');
  const [profileName,setProfileName]=useState(''),[addingProfile,setAddingProfile]=useState(false);
  const [workflowPage,setWorkflowPage]=useState(null),[videoRef,setVideoRef]=useState(''),[workflowHistory,setWorkflowHistory]=useState([]);
  function observe(next) {
    if(revision.current!==next.revision){revision.current=next.revision;serial.current++;setCatalog(null);setSelected('');setSource(null);setBusy(false);}
    const identity=JSON.stringify(next);
    if(identity!==observedStatus.current){observedStatus.current=identity;setStatus(next);}
    if(next.activeTabId!==observedTab.current){observedTab.current=next.activeTabId;setWorkflowPage(null);setVideoRef('');}
    if(document.activeElement!==address.current)setUrl(next.url==='about:blank'?'':next.url || '');
  }
  useEffect(()=>{
    if(!active || !supported)return;
    let stopped=false,timer;
    const poll=async()=>{let interval=1500;try {const next=await desktop.viewerBrowserState();if(next.loading || next.workflow?.status==='running')interval=500;if(!stopped)observe(next);}catch {}finally{if(!stopped)timer=setTimeout(poll,interval);}};
    desktop.startViewerBrowser().then(next=>{if(!stopped){observe(next);void poll();}}).catch(failure=>{if(!stopped)setError(failure.message);});
    return()=>{stopped=true;clearTimeout(timer);};
  },[active,supported,desktop]);
  useEffect(()=>{
    if(!active || !ownsSurface)return;
    return desktop?.onViewerBrowserAddress?.(()=>{address.current?.focus();address.current?.select();});
  },[active,ownsSurface,desktop]);
  useEffect(()=>{
    if(!active || !supported)return;
    const claim=claimBrowserSurface(desktop,setOwnsSurface,accountOnly?0:1);surfaceClaim.current=claim;
    return()=>{claim.release();if(surfaceClaim.current===claim)surfaceClaim.current=null;};
  },[active,supported,desktop,accountOnly]);
  useEffect(()=>{
    if(!active || !ownsSurface || !desktop?.createViewerBrowserTab)return;
    const newWindow=()=>void browserAction(()=>desktop.newViewerBrowserWindow());
    const shortcut=action=>void changeTab(()=>desktop.viewerBrowserTabShortcut(action),action==='new');
    const remove=desktop.onViewerBrowserTabShortcut?.(shortcut);
    const removeWindow=desktop.onViewerBrowserNewWindow?.(newWindow);
    const keydown=event=>{
      if(!(event.ctrlKey || event.metaKey) || event.altKey)return;
      const key=event.key.toLowerCase(),action=key==='t'&&!event.shiftKey?'new':key==='w'&&!event.shiftKey?'close':key==='tab'?(event.shiftKey?'previous':'next'):null;
      if(key==='n' && !event.shiftKey && desktop.newViewerBrowserWindow){event.preventDefault();newWindow();return;}
      if(action){event.preventDefault();shortcut(action);}
    };
    window.addEventListener('keydown',keydown);
    return()=>{remove?.();removeWindow?.();window.removeEventListener('keydown',keydown);};
  },[active,ownsSurface,desktop]);
  useEffect(()=>{
    if(!supported || !active || !ownsSurface)return;
    const visible=active && status.ready && !!status.url && status.url!=='about:blank' && !drawerOpen && !inspecting && !privacy && !bookmarks && !tabSettings;
    const placement=createBrowserPlacementScheduler({window,send:value=>surfaceClaim.current?.owns()?desktop.placeViewerBrowser(value):undefined,measure:()=>{
      const bounds=visibleSurfaceBounds(surface.current);return {visible:!!visible && !!bounds,bounds:avoidFloatingTool(bounds, floatingTool)};
    }});
    const place=()=>visible?placement.schedule():placement.hide();
    place();const observer=new ResizeObserver(place);if(surface.current)observer.observe(surface.current);
    if(surface.current?.parentElement)observer.observe(surface.current.parentElement);
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    window.addEventListener(WINDOW_LAYOUT_EVENT,place);
    return()=>{placement.dispose();observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);window.removeEventListener(WINDOW_LAYOUT_EVENT,place);};
  },[active,ownsSurface,status.ready,status.url,status.activeTabId,drawerOpen,inspecting,privacy,bookmarks,tabSettings,supported,desktop,floatingTool]);
  async function navigate(event,target=url){event?.preventDefault();setError('');setInspecting(false);try{const next=await desktop.navigateViewerBrowser(target);if(next.error)throw new Error(next.error);observe(next);setBookmarks(false);setPrivacy(false);setTabSettings(false);}catch(failure){setError(failure.message);}}
  async function command(action){setError('');try{const next=await desktop.viewerBrowserCommand(action);if(next.error)throw new Error(next.error);observe(next);}catch(failure){setError(failure.message);}}
  async function browserAction(work) {
    setBusy(true);setError('');
    try {const next=await work();if(next?.error)throw Error(next.error);return next;}
    catch(failure){setError(failure.message);return null;}finally{setBusy(false);}
  }
  async function changeTab(work,focusAddress=false) {
    const next=await browserAction(work);
    if(next){observe(next);setInspecting(false);setBookmarks(false);setPrivacy(false);setTabSettings(false);setWorkflowPage(null);setVideoRef('');
      setUrl(next.url==='about:blank'?'':next.url || '');
      if(focusAddress){setUrl('');address.current?.focus();address.current?.select();}}
  }
  function openTabSettings() {
    setInactiveMinutes(String(status.tabSettings?.inactiveMinutes ?? 2));setTabSettings(value=>!value);
    setInspecting(false);setBookmarks(false);setPrivacy(false);
  }
  async function workflow(startFresh=false) {
    const next=await browserAction(()=>beginBrowserWorkflow(desktop,status,{fresh:startFresh}));
    if(next){setWorkflowPage({...next.page,workflowId:next.workflowId});setVideoRef('');setWorkflowHistory(next.history||[]);observe(await desktop.viewerBrowserState());}
  }
  async function inspect(){
    setBusy(true);setError('');setInspecting(true);setBookmarks(false);setPrivacy(false);setTabSettings(false);const ticket=++serial.current;
    try{const next=await desktop.inspectViewerBrowser();if(next.error)throw new Error(next.error);if(ticket===serial.current){setCatalog(next);setSelected('');setSource(null);}}
    catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  async function select(id){
    setSelected(id);setSource(null);setError('');const ticket=++serial.current;setBusy(true);
    try{const next=await desktop.viewerBrowserSource(id);if(next.error)throw new Error(next.error);if(ticket===serial.current)setSource(next);}
    catch(failure){if(ticket===serial.current)setError(failure.message);}finally{if(ticket===serial.current)setBusy(false);}
  }
  return <section className="viewer-browser" aria-label="Web browser">
    {desktop?.createViewerBrowserTab && <div className="browser-tabs-toolbar">
      <div className="browser-tabs" role="tablist" aria-label="Browser tabs">
        {(status.tabs||[]).map((tab,index)=><div className={`browser-tab${tab.id===status.activeTabId?' selected':''}`} key={tab.id}>
          <button type="button" role="tab" aria-selected={tab.id===status.activeTabId} aria-controls={surfaceId}
            aria-label={`Tab ${index+1}: ${tab.title || (tab.url==='about:blank'?'New tab':tab.url)}${tab.suspended?' (Suspended)':''}`}
            title={`${tab.title || 'New tab'}\n${tab.url}${tab.suspended?'\nSuspended — select to reload':''}`}
            disabled={busy || status.clearing} onClick={()=>changeTab(()=>desktop.selectViewerBrowserTab(tab.id))}>
            <span>{tab.title || (tab.url==='about:blank'?'New tab':tab.url)}</span>{tab.suspended && <small>Suspended</small>}
          </button>
          <button type="button" className="browser-tab-close" aria-label={`Close tab ${index+1}`} disabled={busy || status.clearing}
            onClick={()=>changeTab(()=>desktop.closeViewerBrowserTab(tab.id))}>×</button>
        </div>)}
      </div>
      <button type="button" disabled={busy || status.clearing || (status.tabs?.length || 0)>=(status.maxTabs || 24)} onClick={()=>changeTab(()=>desktop.createViewerBrowserTab(),true)}>+ New tab</button>
      {desktop.newViewerBrowserWindow && <button type="button" disabled={busy || status.clearing} title="Open an independent Browser window (Ctrl+N)" onClick={()=>browserAction(()=>desktop.newViewerBrowserWindow())}>New window</button>}
      <button type="button" disabled={busy || status.clearing || !status.tabSettings} aria-expanded={tabSettings} onClick={openTabSettings}>Tab settings</button>
    </div>}
    <form className="browser-toolbar" onSubmit={navigate}>
      <button type="button" disabled={!supported || !status.back} onClick={()=>command('back')} aria-label="Back">←</button>
      <button type="button" disabled={!supported || !status.forward} onClick={()=>command('forward')} aria-label="Forward">→</button>
      <button type="button" disabled={!supported || !status.ready} onClick={()=>command(status.loading?'stop':'reload')}>{status.loading?'Stop':'Reload'}</button>
      <input ref={address} aria-label="Page address" placeholder="https://example.com" value={url} onChange={event=>setUrl(event.target.value)} disabled={!supported}/>
      <button disabled={!supported || !url.trim()}>Go</button>
      {desktop?.browserBookmarks && <>
        <button type="button" aria-expanded={bookmarks} onClick={()=>{setBookmarks(v=>!v);setBookmarkPage(null);setPrivacy(false);setInspecting(false);setTabSettings(false);}}>Bookmarks</button>
        <button type="button" disabled={!status.ready||!status.url||status.url==='about:blank'} onClick={()=>{setBookmarkPage({title:status.title,url:status.url});setBookmarks(true);setPrivacy(false);setInspecting(false);setTabSettings(false);}}>☆ Bookmark page</button>
      </>}
    </form>
    {!accountOnly && <div className="browser-toolbar"><button disabled={!supported || !status.ready || status.url==='about:blank' || busy} onClick={inspect}>{busy?'Reading source…':'Inspect page'}</button>
      <button disabled={!status.ready} onClick={()=>{setInspecting(false);setBookmarks(false);setPrivacy(false);setTabSettings(false);}}>Browse page</button>
      <button disabled={!status.ready} onClick={()=>changeTab(()=>desktop.closeViewerBrowserTab?desktop.closeViewerBrowserTab(status.activeTabId):desktop.viewerBrowserCommand('close'))}>Close page</button>
      <button disabled={!supported} aria-expanded={privacy} onClick={()=>{setPrivacy(value=>!value);setBookmarks(false);setTabSettings(false);}}>Browser privacy</button>
      <span>{status.title || 'Browser'}{status.loading?' · Loading…':''}</span>
    </div>}
    {desktop?.viewerBrowserProfiles && <div className="browser-toolbar browser-accounts">
      <label>Account profile <select aria-label="Account profile" value={status.selected||'default'} disabled={busy || status.clearing} onChange={async event=>{
        const next=await browserAction(()=>desktop.selectViewerBrowserProfile(event.target.value));if(next){observe(next);setWorkflowPage(null);setVideoRef('');}
      }}>{(status.profiles||[{id:'default',name:'Existing browser'}]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button disabled={busy} onClick={()=>setAddingProfile(v=>!v)} aria-expanded={addingProfile}>Add isolated profile</button>
      {addingProfile && <><input aria-label="New profile label" value={profileName} maxLength={60} placeholder="Account label" onChange={e=>setProfileName(e.target.value)}/>
        <button disabled={busy||!profileName.trim()} onClick={async()=>{
          const profile=await browserAction(()=>desktop.createViewerBrowserProfile(profileName));
          if(profile){const next=await browserAction(()=>desktop.selectViewerBrowserProfile(profile.id));if(next)observe(next);setProfileName('');setAddingProfile(false);setWorkflowPage(null);}
        }}>Create and select</button></>}
      <span>Log in and complete MFA in the page or its login window.</span>
    </div>}
    {!accountOnly && desktop?.startBrowserWorkflow && <div className="browser-toolbar browser-workflow">
      <button disabled={busy||status.loading||(!workflowCheckpoint(status)&&(!status.ready||status.url==='about:blank'))||status.workflow?.status==='running'} onClick={()=>workflow()}>
        {workflowCheckpoint(status)?'Open saved page and resume':'Start browser workflow'}</button>
      {workflowCheckpoint(status)&&<button disabled={busy||status.loading||!status.ready||status.url==='about:blank'} onClick={()=>workflow(true)}>Start new on this page</button>}
      <button disabled={!status.workflow||['completed','cancelled','failed'].includes(status.workflow.status)} onClick={async()=>{await browserAction(()=>desktop.cancelBrowserWorkflow({workflowId:status.workflow.id}));setWorkflowPage(null);}}>Cancel workflow</button>
      {workflowPage && status.workflow?.status==='running' && <>
        <select aria-label="Target video" value={videoRef} onChange={e=>setVideoRef(e.target.value)}><option value="">Choose a page video</option>
          {workflowPage.elements.filter(e=>e.role==='video').map((e,i)=><option key={e.elementRef} value={e.elementRef}>{e.name||`Video ${i+1}`}</option>)}</select>
        <button disabled={busy||!videoRef||!status.workflow.accountBound} onClick={async()=>{
          await browserAction(()=>desktop.browserTool({workflowId:workflowPage.workflowId,action:'capture',pageRef:workflowPage.pageRef,elementRef:videoRef}));
          observe(await desktop.viewerBrowserState());setWorkflowPage(null);
        }}>Capture selected video</button>
      </>}
      <span role="status">{status.workflow?`${status.workflow.status} · ${status.workflow.reason||status.workflow.stage}`:'Direct video files supported; streams require an acquisition adapter.'}</span>
      {status.workflow?.status==='running' && workflowPage && <BrowserAccountStatus identified={!!status.workflow.accountBound} message={workflowPage.accountStatus?.message} busy={busy} disabled={status.loading} onCheck={async()=>{
        const next=await browserAction(()=>desktop.resumeBrowserWorkflow({workflowId:workflowPage.workflowId,profileId:status.selected}));
        if(next){setWorkflowPage({...next.page,workflowId:next.workflowId});setVideoRef('');observe(await desktop.viewerBrowserState());}
      }}/>}
      {status.workflow?.media && <span>Video {status.workflow.media.completeness}; audio {status.workflow.media.audio}; captions {status.workflow.media.captions}.</span>}
    </div>}
    {!supported && <p>Open the desktop app to browse pages. If the app is already open, fully quit and reopen it after this update.</p>}
    {(error || status.error) && <p role="alert">{error || status.error}</p>}
    {status.notice && <p role="status">{status.notice}</p>}
    {status.tabSettingsNotice && <p role="status">{status.tabSettingsNotice}</p>}
    {tabSettings && <section className="browser-tab-settings" aria-label="Tab settings">
      <form onSubmit={async event=>{event.preventDefault();const next=await browserAction(()=>desktop.setViewerBrowserTabSettings({inactiveMinutes:Number(inactiveMinutes)}));if(next){observe(next);setTabSettings(false);}}}>
        <label>Suspend inactive tabs after <input type="number" min="0" max="60" step="1" required aria-label="Inactive tab timeout in minutes" value={inactiveMinutes} onChange={event=>setInactiveMinutes(event.target.value)}/> minutes</label>
        <button disabled={busy || inactiveMinutes===''}>Save tab settings</button>
        <button type="button" onClick={()=>setTabSettings(false)}>Close settings</button>
      </form>
      <p>Default: 2 minutes. Choose 1–60 minutes, or 0 to disable suspension. The timer starts when you select another Browser tab; the selected tab stays loaded.</p>
      <p>Suspension closes the inactive page and its login windows, stopping its video, audio and page requests. Selecting it reloads its address with your profile’s login session. Unsaved form entries, page history and playback position can be lost.</p>
      <p>Ctrl+T opens a tab, Ctrl+W closes it, and Ctrl+Tab / Ctrl+Shift+Tab switches tabs. New window / Ctrl+N opens a separate Browser with its own tabs. Windows using the same account profile share website login data and bookmarks. Changing profiles closes tabs in this window. Tab settings are saved between launches.</p>
    </section>}
    {bookmarks && <BrowserBookmarks desktop={desktop} page={bookmarkPage} onOpen={target=>navigate(null,target)} onClose={()=>setBookmarks(false)}/>}
    {privacy && <section className="browser-privacy" aria-label="Browser privacy">
      <h2>Browser privacy</h2>

      <p>Profile location: <code>{status.profilePath || 'Open Browser to initialize its profile.'}</code></p>

      {desktop?.clearViewerBrowserData ? <><label>Clear browser data <select value={clearKind} onChange={event=>setClearKind(event.target.value)}>
        <option value="cookies">Cookies / site login data</option><option value="cache">Cache</option>
        <option value="site">LocalStorage / site data</option><option value="all">All browser data</option>
      </select></label>
      <button disabled={busy || status.clearing} onClick={async()=>{setBusy(true);setError('');try{const next=await desktop.clearViewerBrowserData(clearKind);if(next.error)throw Error(next.error);observe(next);}catch(failure){setError(failure.message);}finally{setBusy(false);}}}>Clear selected data…</button></>
      : <p>Use Browser privacy in the main workspace to clear profile data. Clearing it closes extra Browser windows using that profile.</p>}
      {desktop?.clearBrowserWorkflowMedia && <p><button disabled={busy} onClick={async()=>{
        await browserAction(()=>desktop.clearBrowserWorkflowMedia());observe(await desktop.viewerBrowserState());setWorkflowPage(null);
      }}>Clear workflow media and extracted files</button> Login sessions and workflow records are preserved.</p>}
      {desktop?.browserWorkflowState && <button disabled={busy} onClick={async()=>{const next=await browserAction(()=>desktop.browserWorkflowState());if(next)setWorkflowHistory(next.history);}}>Show workflow checkpoints</button>}
      {workflowHistory.slice(0,5).map(row=><p key={row.id}>{row.source?.origin}{row.source?.path} · {row.status}{row.reason?` · ${row.reason}`:''}
        {['interrupted','paused'].includes(row.status) && <button disabled={busy||row.profileId!==status.selected} onClick={async()=>{
          const next=await browserAction(()=>desktop.resumeBrowserWorkflow({workflowId:row.id,profileId:status.selected,restorePage:true}));
          if(next){setWorkflowPage({...next.page,workflowId:next.workflowId});setWorkflowHistory(next.history);observe(await desktop.viewerBrowserState());setPrivacy(false);}
        }}>Open saved page and resume</button>}</p>)}


    </section>}
    {status.popup && <p>A page requested another window. <button onClick={()=>navigate(null,status.popup)}>Open linked page here</button></p>}
    {active && supported && !ownsSurface && <p role="status">The shared browser page is displayed in another visible workspace. Use that pane’s browser controls.</p>}
    <div ref={surface} id={surfaceId} role="tabpanel" className="browser-surface" hidden={inspecting || privacy || bookmarks || tabSettings || active && supported && !ownsSurface}>
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
