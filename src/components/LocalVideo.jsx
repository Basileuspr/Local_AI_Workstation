import {useEffect, useRef, useState} from 'react';
import {localRequest, localAsset, timeLabel, downloadResult} from '../localFiles';

export default function LocalVideo({file, onSaved, run, busy, active}) {
  const player=useRef(null), [preset,setPreset]=useState('quick'), [operation,setOperation]=useState('vision');
  const [interval,setInterval]=useState(10), [keyframes,setKeyframes]=useState(false), [model,setModel]=useState('');
  const [speech,setSpeech]=useState('base'), [capabilities,setCapabilities]=useState(null), [selected,setSelected]=useState(new Set());
  const [capError,setCapError]=useState(''), [playError,setPlayError]=useState('');
  const [focus,setFocus]=useState('');
  useEffect(() => {let alive=true; localRequest('/capabilities').then(value => {if(alive){setCapabilities(value);setModel(previous=>previous || value.vision_models.find(item=>item.id==='qwen3-vl:8b')?.id || value.vision_models[0]?.id || '');}}).catch(error => {if(alive)setCapError(error.message);}); return () => {alive=false;};},[]);
  useEffect(() => {if(!active)player.current?.pause();},[active]);
  useEffect(() => {const element=player.current; return () => {if(element){element.pause(); element.removeAttribute('src'); element.load();}};},[]);
  const info=file.data.metadata, frames=file.data.frames || [], transcript=file.data.transcript;
  function seek(time){if(player.current)player.current.currentTime=time;}
  async function analyze() {
    await run(async () => {
      try {onSaved(await localRequest(`/${file.id}/video`, {operation,preset,interval:Number(interval),keyframes:operation==='frames'&&keyframes,model,speech_model:speech,frame_ids:[...selected],focus})); setSelected(new Set());}
      catch(error) {const latest=await localRequest(`/${file.id}`).catch(()=>null); if(latest)onSaved(latest); throw error;}
    });
  }
  const needsSpeech=['transcript','full'].includes(operation), needsVision=['vision','full'].includes(operation);
  return <div className="local-video"><section className="local-video-controls" aria-label="Video controls">
    <p>{timeLabel(info.duration)} · {info.width} × {info.height} · {info.fps.toFixed(2)} fps · {info.codec} · {info.audio ? `${info.audio_tracks} audio track(s)` : 'No audio'}</p>
    <div className="local-toolbar"><label>Operation <select value={operation} onChange={e=>setOperation(e.target.value)} disabled={busy}>
      {[['vision','Analyze video'],['full','Analyze video + speech'],['metadata','Metadata only'],['frames','Extract frames only (no AI)'],['audio','Extract audio'],['transcript','Transcript only']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Workload <select value={preset} onChange={e=>setPreset(e.target.value)} disabled={busy}>{['quick','balanced','detailed','custom'].map(id=><option key={id} value={id}>{id === 'quick' ? 'Quick Scan' : id[0].toUpperCase()+id.slice(1)}</option>)}</select></label>
      {preset==='custom' && <label>Interval (seconds) <input type="number" min="0.1" max="3600" step="0.1" value={interval} onChange={e=>setInterval(e.target.value)}/></label>}
      {operation==='frames'&&<label><input type="checkbox" checked={keyframes} onChange={e=>setKeyframes(e.target.checked)}/> Keyframes only (compression frames, not scene changes)</label>}</div>
    <div className="local-toolbar">{needsVision && <label>Vision model <select value={model} onChange={e=>setModel(e.target.value)}><option value="">Choose installed model</option>{capabilities?.vision_models.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {needsSpeech && <label>Transcription model <select value={speech} onChange={e=>setSpeech(e.target.value)}>{['base','small','turbo'].map(id=><option key={id} value={id}>{id} {capabilities?.transcription.models?.[id]?.ready ? '· ready' : '· not installed'}</option>)}</select></label>}
      <button disabled={busy || needsVision && !model || operation==='transcript' && (!info.audio || !capabilities?.transcription.models?.[speech]?.ready)} onClick={analyze}>{needsVision ? 'Analyze video' : operation==='frames' ? 'Extract frames' : 'Run operation'}</button>
      {busy && <button onClick={()=>localRequest(`/${file.id}/cancel`,{}).catch(()=>{})}>Stop</button>}
      <button disabled={!frames.length && !transcript} onClick={()=>downloadResult({name:file.name,...file.data},'json')}>Export analysis JSON</button></div>

    {needsVision&&<label className="local-analysis-focus">What should the analysis focus on? (optional)<textarea value={focus} maxLength={2000} rows={2} disabled={busy} placeholder="For example: Explain the activity, identify visible objects, and note what changes." onChange={e=>setFocus(e.target.value)}/></label>}
    {capError && <p>{capError}</p>}
    {needsVision && !capabilities && !capError && <p>Checking installed vision models…</p>}
    {needsVision && capabilities && !capabilities.vision_models.length && <p>No installed vision model is currently available. Start Ollama with a vision-capable model, then reopen this file. Frame extraction alone does not analyze content.</p>}
    {needsVision && <p role="status">{selected.size ? `${selected.size} frame(s) selected` : 'Automatic frame sampling'}</p>}
    </section>
    <video ref={player} src={localAsset(file.id,'source')} controls preload="metadata" poster={frames[0] ? localAsset(file.id,frames[0].id) : undefined} onError={() => setPlayError('The desktop player cannot play this codec/container. Metadata and frame decoding can still work.')} />
    {playError && <p>{playError}</p>}

    {file.data.audio_id && <p><a href={localAsset(file.id,file.data.audio_id)} download="extracted-audio.m4a">Save extracted audio</a></p>}
    {file.data.note && <p>{file.data.note} Effective interval: {Number(file.data.interval).toFixed(2)} s.</p>}
    {['thumbnail_warning','transcript_warning','vision_warning'].map(key=>file.data[key]&&<p role="alert" key={key}>{file.data[key]}</p>)}
    {file.data.analysis ? <section className="local-analysis" aria-label="Video analysis"><h2>Video analysis</h2>
      <p>{file.data.analysis.status==='complete'?'Analysis complete':`Analysis ${file.data.analysis.status || 'pending'} · partial results`} · {file.data.analysis.model}</p>
      {file.data.analysis.summary&&<div className="local-analysis-summary">{file.data.analysis.summary}</div>}
      <h3>Observed timeline</h3>{file.data.analysis.observations?.map(observation=><article key={observation.id}><button onClick={()=>seek(observation.time)}>{timeLabel(observation.time)}</button><p>{observation.text}</p></article>)}
      <p>{file.data.analysis.note}</p></section> : <p>No content analysis yet. Choose an installed vision model and click Analyze video to get a summary and timestamped observations.</p>}
    <div className="local-frames">{frames.map(frame=><article key={frame.id}><img loading="lazy" src={localAsset(file.id,frame.id)} alt={`Frame at ${timeLabel(frame.time)}`}/>
      <div><button onClick={()=>seek(frame.time)}>{timeLabel(frame.time)}</button><label><input type="checkbox" checked={selected.has(frame.id)} onChange={()=>setSelected(old=>{const next=new Set(old); next.has(frame.id)?next.delete(frame.id):next.add(frame.id); return next;})}/> Analyze frame</label></div>
      <p>{frame.keyframe?'Keyframe · ':''}{frame.observation || 'Sampled frame; not analyzed.'}</p></article>)}</div>
    {transcript && <div><h2>Transcript timeline</h2>{transcript.segments.map((segment,index)=><p key={index}><button onClick={()=>seek(segment.start)}>{timeLabel(segment.start)}</button> {segment.text}</p>)}</div>}
  </div>;
}
