import {useEffect,useState} from 'react';
import {webSystem,sourceDefaults,sourceFields,webTime} from '../webSystem';
import ViewerBrowser from './ViewerBrowser';
import './WebWorkspace.css';

export default function WebWorkspace({active,models=[],defaultModel=''}) {
  const [tab,setTab]=useState('research'),[question,setQuestion]=useState(''),[model,setModel]=useState(''),[urls,setUrls]=useState(''),[job,setJob]=useState(null);
  const [state,setState]=useState({sources:[],jobs:[],events:[],worker:{}}),[form,setForm]=useState({...sourceDefaults}),[editing,setEditing]=useState('');
  const [config,setConfig]=useState({provider:'wikipedia',endpoint:''}),[browser,setBrowser]=useState(false),[pages,setPages]=useState(null);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[limits,setLimits]=useState({max_pages:6,follow_links:true});
  const running=job&&['PENDING','RUNNING'].includes(job.status);
  const desktop=window.workstationDesktop;
  useEffect(()=>{if(!model&&models.length)setModel(models.find(m=>m.name===defaultModel)?.name||models[0].name);},[model,models,defaultModel]);
  useEffect(()=>{if(!active)return;let stopped=false,timer;
    const poll=async()=>{try{const next=await webSystem('/state');if(!stopped)setState(next);}catch(e){if(!stopped)setError(e.message);}finally{if(!stopped)timer=setTimeout(poll,3000);}};
    void poll();webSystem('/search').then(v=>{if(!stopped)setConfig(v);}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;clearTimeout(timer);};
  },[active]);
  useEffect(()=>{if(!active||!running)return;let stopped=false,timer;
    const poll=async()=>{try{const next=await webSystem('/research/'+job.id);if(!stopped){setJob(next);if(['PENDING','RUNNING'].includes(next.status))timer=setTimeout(poll,1000);}}catch(e){if(!stopped){setError(e.message);setJob(null);}}};
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[active,running,job?.id]);
  async function perform(work) {setBusy(true);setError('');setNotice('');try{const result=await work();if(result?.error)throw Error(result.error);return result;}catch(e){setError(e.message);return null;}finally{setBusy(false);}}
  async function refresh(){setState(await webSystem('/state'));}
  async function saveKnowledge(body){const result=await perform(()=>webSystem('/knowledge',body));if(result)setNotice(result.duplicate?'This captured version is already in Knowledge.':'Selected evidence saved to Knowledge.');}
  const field=(key,value)=>setForm(v=>({...v,[key]:value}));
  return <section className="web-workspace" aria-label="Web Research & Sources">
    <div className="web-toolbar"><strong>Web Research & Sources</strong><button aria-pressed={tab==='research'} onClick={()=>setTab('research')}>Live research</button><button aria-pressed={tab==='sources'} onClick={()=>setTab('sources')}>Recurring sources</button></div>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {tab==='research'?<>
      <p>Ask a current question. Retrieved text and answers expire after 30 minutes and are discarded when the backend closes. Save selected evidence to Knowledge only when you want to retain it.</p>
      <label>Research question<textarea aria-label="Research question" value={question} maxLength={2000} onChange={e=>setQuestion(e.target.value)} placeholder="What changed in the latest release?"/></label>
      <div className="web-toolbar"><label>Local model<select aria-label="Research model" value={model} onChange={e=>setModel(e.target.value)}><option value="">Choose a local text model</option>{models.map(m=><option key={m.name} value={m.name}>{m.name}</option>)}</select></label>
        <button disabled={busy||running||!model||question.trim().length<3} onClick={async()=>{const result=await perform(()=>webSystem('/research',{question:question.trim(),model,urls:urls.split(/\s+/).filter(Boolean),...limits}));if(result)setJob(result);}}>Research now</button>
        <button disabled={busy||!running} onClick={async()=>{const result=await perform(()=>webSystem('/research/'+job.id+'/cancel',{}));if(result)setJob(result);}}>Cancel research</button>
        <button disabled={busy||!job} onClick={async()=>{const result=await perform(()=>webSystem('/research/'+job.id+'/discard',{}));if(result)setJob(null);}}>Discard research</button>
      </div>
      <details><summary>Search and retrieval settings</summary>
        <label>Source URLs (optional, one per line)<textarea value={urls} onChange={e=>setUrls(e.target.value)} placeholder="https://example.com/releases"/></label>
        <div className="web-toolbar"><label>Page limit<input type="number" min="1" max="6" value={limits.max_pages} onChange={e=>setLimits(v=>({...v,max_pages:Number(e.target.value)}))}/></label>
          <label><input type="checkbox" checked={limits.follow_links} onChange={e=>setLimits(v=>({...v,follow_links:e.target.checked}))}/>Follow useful links</label>
          <label>Search provider<select value={config.provider} onChange={e=>setConfig({provider:e.target.value,endpoint:''})}><option value="wikipedia">Wikipedia (limited scope)</option><option value="searxng">SearXNG (general web)</option></select></label>
          {config.provider==='searxng'&&<label>Public JSON search endpoint<input value={config.endpoint} onChange={e=>setConfig(v=>({...v,endpoint:e.target.value}))} placeholder="https://search.example.com/search"/></label>}
          <button disabled={busy||running} onClick={async()=>{const result=await perform(()=>webSystem('/search',config,'PUT'));if(result){setConfig(result);setNotice('Search provider saved.');}}}>Save search provider</button>
        </div><p>Wikipedia searches its encyclopedia. For broad current web research, configure a public SearXNG endpoint with JSON enabled. Public HTTP/HTTPS retrieval respects robots, at least 10 seconds between requests, and 30 requests per hour.</p>
      </details>
      {job&&<article className="web-research-result"><p role="status">{job.status} · {job.stage}</p>{job.error&&<p>{job.error}</p>}
        {job.queries?.length>0&&<p>Searches: {job.queries.join(' · ')}</p>}
        {job.answer?.map((p,i)=><p key={i}>{p.text}{' '}{p.citations.map(id=>{const source=job.sources.find(s=>s.id===id);return source&&<a key={id} href={source.url} target="_blank" rel="noreferrer">[{id}] </a>;})}</p>)}
        {job.sources?.map(s=><div className="web-source-row" key={s.id}><span>[{s.id}] <a href={s.url} target="_blank" rel="noreferrer">{s.title||s.url}</a> · Retrieved {webTime(s.retrieved_at)}{s.kind==='rendered_browser'?' · User-selected browser excerpt':''}</span>
          <button disabled={busy||running} onClick={()=>saveKnowledge({research_id:job.id,source_ref:s.id})}>Save to Knowledge</button></div>)}
        {!!job.failures?.length&&<details><summary>Coverage: {job.failures.length} retrieval/search issue(s)</summary>{job.failures.map((f,i)=><p key={i}>{f.url?<a href={f.url} target="_blank" rel="noreferrer">{f.url}</a>:f.stage} · {f.reason}{f.url&&<button disabled={busy||running||!desktop?.navigateViewerBrowser} onClick={()=>perform(async()=>{await desktop.navigateViewerBrowser(f.url);setBrowser(true);})}>Open in Browser</button>}</p>)}</details>}
      </article>}
      <div className="web-toolbar"><button onClick={()=>setBrowser(v=>!v)}>{browser?'Hide browser fallback':'Browser fallback'}</button><button disabled={busy||running||!job||!desktop?.readWebResearchBrowser} onClick={async()=>{const result=await perform(()=>desktop.readWebResearchBrowser(job.id));if(result)setJob(result);}}>Use current Browser page</button></div>
      {browser&&<><p>Open a public page, complete any login manually, then explicitly capture its rendered text. Password fields and session secrets are excluded. Only this selected page is read; the monitor remains an HTTP crawler.</p><ViewerBrowser accountOnly active={active&&browser} onOpenSource={()=>{}}/></>}
    </>:<>
      <div className="web-toolbar"><span>Background: {state.background_enabled?(state.worker?.status==='running'&&Date.now()/1000-(state.worker.heartbeat||0)<15?'running':'starting / waiting for worker'):'disabled'} · {state.sources.filter(s=>s.enabled).length} enabled source(s)</span>
        <button disabled={busy||!desktop?.webBackground} onClick={async()=>{const result=await perform(()=>desktop.webBackground(!state.background_enabled));if(result)setState(result);}}>{state.background_enabled?'Disable background monitoring':'Enable background monitoring'}</button></div>
      <p>Sources run in a separate worker through a per-user Windows task, including when the workstation window is closed. Checks stay queued while background monitoring is disabled. Disabling it also pauses maintenance conflicts.</p>
      <form onSubmit={async e=>{e.preventDefault();const result=await perform(()=>webSystem('/sources'+(editing?'/'+editing:''),form,editing?'PUT':'POST'));if(result){setForm({...sourceDefaults});setEditing('');await refresh();}}}>
        <div className="web-toolbar"><label>Name<input aria-label="Source name" required maxLength={100} value={form.name} onChange={e=>field('name',e.target.value)}/></label><label>Seed URL<input aria-label="Source seed URL" required type="url" value={form.seed_url} onChange={e=>field('seed_url',e.target.value)}/></label>
          <label>Check every (minutes)<input type="number" min="5" max="525600" value={form.interval_minutes} onChange={e=>field('interval_minutes',Number(e.target.value))}/></label>
          <label>Retention<select aria-label="Source retention" value={form.policy} onChange={e=>field('policy',e.target.value)}><option value="monitor_only">Monitor only</option><option value="keep_latest">Keep latest content</option><option value="notify_changes">Notify on changes in this pane</option></select></label>
          <label><input type="checkbox" checked={form.enabled} onChange={e=>field('enabled',e.target.checked)}/>Enabled</label>
        </div>
        <details><summary>Crawl boundaries and limits</summary><div className="web-toolbar">
          <label>Allowed domains (comma separated)<input value={form.allowed_domains.join(', ')} onChange={e=>field('allowed_domains',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="Defaults to the seed host"/></label>
          {['include_patterns','exclude_patterns'].map(k=><label key={k}>{k==='include_patterns'?'Include URL/path globs':'Exclude URL/path globs'}<input value={form[k].join(', ')} onChange={e=>field(k,e.target.value.split(',').map(s=>s.trim()).filter(Boolean))}/></label>)}
          <label>Depth<input type="number" min="0" max="8" value={form.max_depth} onChange={e=>field('max_depth',Number(e.target.value))}/></label>
          <label>Pages per run<input type="number" min="1" max="500" value={form.max_pages} onChange={e=>field('max_pages',Number(e.target.value))}/></label>
          <label>Seconds between requests<input type="number" min="10" max="3600" value={form.request_interval_seconds} onChange={e=>field('request_interval_seconds',Number(e.target.value))}/></label>
          <label><input type="checkbox" checked={form.discover_feeds} onChange={e=>field('discover_feeds',e.target.checked)}/>RSS/Atom discovery</label>
          <label><input type="checkbox" checked={form.discover_sitemaps} onChange={e=>field('discover_sitemaps',e.target.checked)}/>Sitemap discovery</label>
        </div></details>
        <div className="web-toolbar"><button disabled={busy} type="submit">{editing?'Save source changes':'Add source'}</button>{editing&&<button type="button" onClick={()=>{setEditing('');setForm({...sourceDefaults});}}>Cancel edit</button>}</div>
      </form>
      {state.sources.map(s=><article className="web-monitor-source" key={s.id}><div className="web-toolbar"><strong>{s.name}</strong><span>{s.enabled?'Enabled':'Paused'} · {s.policy.replaceAll('_',' ')}</span>
        <button disabled={busy} onClick={()=>{setEditing(s.id);setForm(sourceFields(s));}}>Edit</button>
        <button disabled={busy} onClick={()=>perform(async()=>{await webSystem('/sources/'+s.id,{...sourceFields(s),enabled:!s.enabled},'PUT');await refresh();})}>{s.enabled?'Pause source':'Enable source'}</button>
        <button disabled={busy||!s.enabled} onClick={()=>perform(async()=>{await webSystem('/sources/'+s.id+'/check',{});await refresh();})}>Check now</button>
        <button disabled={busy} onClick={async()=>{const result=await perform(()=>webSystem('/sources/'+s.id+'/pages'));if(result)setPages({source:s,rows:result});}}>Page status</button>
        <button disabled={busy} onClick={()=>perform(async()=>{await webSystem('/sources/'+s.id+'/clear-content',{});setNotice('Retained content cleared. Crawl state and Knowledge are preserved.');})}>Clear retained content</button>
      </div><p><a href={s.seed_url} target="_blank" rel="noreferrer">{s.seed_url}</a> · Last check {webTime(s.last_checked)} · Last successful run {webTime(s.last_success)} · Next {s.enabled?webTime(s.next_run):'paused'}</p></article>)}
      {pages&&<details open><summary>Page status: {pages.source.name}</summary>{pages.rows.map(p=><div className="web-source-row" key={p.url}><span><a href={p.url} target="_blank" rel="noreferrer">{p.title||p.url}</a> · HTTP {p.http_status??'—'} · {p.error||'checked'} · Changed {webTime(p.last_changed)}{p.next_retry?' · Retry '+webTime(p.next_retry):''}</span>{pages.source.policy==='keep_latest'&&<button disabled={busy||!!p.error} onClick={()=>saveKnowledge({source_id:pages.source.id,url:p.url})}>Save latest to Knowledge</button>}</div>)}</details>}
      <details open><summary>Recent runs</summary>{state.jobs.slice(0,20).map(j=><div className="web-source-row" key={j.id}><span>{state.sources.find(s=>s.id===j.source_id)?.name} · {j.state} · {j.checked} checked · {j.changed} changed · {j.failures} failed{j.state==='RETRY'?' · Retry '+webTime(j.available):''}</span>{['PENDING','RUNNING','RETRY'].includes(j.state)&&<button disabled={busy} onClick={()=>perform(async()=>{await webSystem('/jobs/'+j.id+'/cancel',{});await refresh();})}>Cancel run</button>}</div>)}</details>
      {!!state.events.length&&<details open><summary>Change notifications</summary>{state.events.map(e=><p key={e.id}>{webTime(e.created)} · <a href={e.url} target="_blank" rel="noreferrer">{e.title||e.url}</a> changed</p>)}</details>}
      {!state.sources.length&&<p>No recurring sources configured. Add a source deliberately, then enable background monitoring.</p>}
    </>}
  </section>;
}
