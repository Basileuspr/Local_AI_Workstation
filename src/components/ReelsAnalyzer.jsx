import {useEffect,useState} from 'react';
import ViewerBrowser from './ViewerBrowser';
import BrowserAccountStatus from './BrowserAccountStatus';
import './ReelsAnalyzer.css';

export default function ReelsAnalyzer({active,models=[],defaultModel=''}) {
  const desktop=window.workstationDesktop;
  const [state,setState]=useState({batches:[],summaries:[]}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [browserOpen,setBrowserOpen]=useState(true),[source,setSource]=useState(null),[profile,setProfile]=useState('default');
  const [vision,setVision]=useState(''),[whisper,setWhisper]=useState('small'),[videoName,setVideoName]=useState('');
  const [accountCheck,setAccountCheck]=useState(null);
  const [summaryModel,setSummaryModel]=useState('');
  const visionModels=models.filter(m=>m.supports_vision || m.vision || m.capabilities?.includes('vision'));
  useEffect(()=>{if(!vision&&visionModels.length)setVision(visionModels[0].name);},[vision,visionModels]);
  useEffect(()=>{if(!summaryModel&&models.length)setSummaryModel(models.find(m=>m.name===defaultModel)?.name||models.find(m=>m.name==='qwen3.5:9b')?.name||models[0].name);},[summaryModel,models,defaultModel]);
  useEffect(()=>{
    if(!active || !desktop?.reelsState)return;
    let stopped=false,timer;
    const poll=async()=>{try {
      const next=await desktop.reelsState();if(next.error && !next.batches)throw Error(next.error);
      const browser=await desktop.viewerBrowserState();
      if(!stopped){setState(next);setProfile(browser.selected);setAccountCheck(current=>current && current.profileId===browser.selected && current.revision===browser.revision && current.tabId===browser.activeTabId && !browser.loading && browser.ready?current:null);}
    }catch(e){if(!stopped)setError(e.message);}finally{if(!stopped)timer=setTimeout(poll,1000);}};
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[active,desktop]);
  async function perform(work){setBusy(true);setError('');try{const next=await work();if(next?.error)throw Error(next.error);return next;}catch(e){setError(e.message);return null;}finally{setBusy(false);}}
  const processing=!!state.active||!!state.recovering;
  return <section className="reels-analyzer" aria-label="Reels Analyzer">
    <div className="reels-controls">
      <strong>Reels Analyzer</strong>
      <button disabled={processing} onClick={()=>setBrowserOpen(v=>!v)}>{browserOpen?'Hide account browser':'Open account browser'}</button>
      <button disabled={!desktop?.discoverReels||busy||processing} onClick={async()=>{
        const next=await perform(()=>desktop.discoverReels({profileId:profile}));if(next)setSource(next);
      }}>Use this conversation</button>
      <button disabled={busy||processing||!source||!vision||!summaryModel} onClick={async()=>{
        const next=await perform(()=>desktop.startReels({visionModel:vision,summaryModel,whisperModel:whisper,videoName}));if(next){setBrowserOpen(false);setSource(null);}
      }}>Analyze discovered reels</button>
      <button disabled={busy||!state.active||state.active.pauseRequested} onClick={()=>perform(()=>desktop.pauseReels())}>Pause after this reel</button>
      <button disabled={busy||!state.active} onClick={()=>perform(()=>desktop.cancelReels())}>Cancel</button>
      <button disabled={busy||processing||!desktop?.clearReelsCache} onClick={()=>perform(()=>desktop.clearReelsCache())}>Clear cache</button>
    </div>
    <div className="reels-controls">
      <label>Local vision <select aria-label="Reels vision model" value={vision} disabled={processing} onChange={e=>setVision(e.target.value)}>
        <option value="">Choose an installed vision model</option>{visionModels.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}
      </select></label>
      <label>Local summary <select aria-label="Reels summary model" value={summaryModel} disabled={processing} onChange={e=>setSummaryModel(e.target.value)}><option value="">Choose a local text model</option>{models.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}</select></label>
      <label>Transcription <select value={whisper} disabled={processing} onChange={e=>setWhisper(e.target.value)}><option value="turbo">Whisper Turbo</option><option value="small">Whisper Small</option><option value="base">Whisper Base</option></select></label>
      <BrowserAccountStatus identified={accountCheck?.status==='identified'} message={accountCheck?.message} busy={busy} disabled={processing||!desktop?.reelsAccountControls} onCheck={async()=>{
        const next=await perform(()=>desktop.reelsAccountControls({profileId:profile}));if(next)setAccountCheck(next);
      }}/>
      <details><summary>Page controls</summary>
        <label>Video label <input value={videoName} maxLength={200} placeholder="Leave blank for an unnamed player" onChange={e=>setVideoName(e.target.value)}/></label>
      </details>
    </div>
    {!desktop?.reelsState&&<p>Open the updated desktop app to acquire reels through your account.</p>}
    {(error||state.error)&&<p role="alert">{error||state.error}</p>}
    {state.recovering?<p role="status">Opening the saved conversation and verifying its account…</p>:state.active&&<p role="status">Reel {(state.active.index??0)+1} · {state.active.stage}{state.active.pauseRequested?' · Pausing after saved result and cleanup':''}</p>}
    {source&&<p role="status">{source.reels.length} discovered reel(s) from {source.sourceUrl}. This is the visible conversation snapshot; scroll to older messages and select the source again to include them.</p>}
    {browserOpen&&!processing&&<><p>Choose an isolated account profile, sign in normally, and open the conversation containing shared reels. Acquisition must pass before analysis; streaming media may require a site adapter.</p>
      <ViewerBrowser accountOnly active={active&&browserOpen&&!processing} onOpenSource={()=>{}}/></>}
    {!processing&&state.batches.filter(b=>['paused','interrupted','cancelled'].includes(b.status)).slice(0,5).map(b=><div className="reels-controls" key={b.id}>
      <span>{b.status} · {b.items.filter(i=>['complete','duplicate'].includes(i.status)).length}/{b.items.length} saved or already saved</span>
      <button disabled={busy} onClick={()=>perform(async()=>{setBrowserOpen(true);return desktop.navigateViewerBrowser(b.sourceUrl);})}>Open source conversation</button>
      <button disabled={busy} title="Opens the saved conversation in its selected account profile and skips saved reels" onClick={async()=>{const next=await perform(()=>desktop.resumeReels({batchId:b.id,videoName}));if(next)setBrowserOpen(false);}}>Resume remaining reels</button>
    </div>)}
    {state.batches.flatMap(b=>b.items.filter(i=>['unsupported','failed','interrupted'].includes(i.status))).slice(0,10).map(i=><p key={i.identity} className="reels-unavailable">{i.status==='unsupported'?'Acquisition unsupported or incomplete':'Analysis incomplete'} · <a href={i.url} target="_blank" rel="noreferrer">Original reel</a></p>)}
    <div className="reels-results" aria-label="Saved reel summaries">{state.summaries.map(row=><article key={row.identity}>
      <p>{row.summary}</p>
      <p>{row.repository?<a href={row.repository} target="_blank" rel="noreferrer">{row.repository}</a>:<span>Repository link not identified.</span>} · <a href={row.reelUrl} target="_blank" rel="noreferrer">Original reel</a></p>
    </article>)}</div>
  </section>;
}
