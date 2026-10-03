import {useEffect, useRef, useState} from 'react';
import {apiUrl} from '../api';
import './Tools.css';
import './LinkedApps.css';

async function request(route, options) {
  const response = await fetch(apiUrl('/slicer' + route), options);
  const value = await response.json();
  if (!response.ok) throw Error(typeof value.detail === 'string' ? value.detail : 'Slicing request failed.');
  return value;
}
export default function Slicer({active = true}) {
  const input = useRef(null), [file, setFile] = useState(null), [ready, setReady] = useState(null);
  const [job, setJob] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [options, setOptions] = useState({machine:'fdmprinter', generic_confirmed:false, material:'pla', layer_height:.2, nozzle:.4, infill:20, support:false, heated_bed:true});
  const change = patch => setOptions(current => ({...current, ...patch}));
  async function refresh() { try { setReady(await request('/readiness')); } catch (failure) { setError(failure.message); } }
  useEffect(() => { if (active) refresh(); }, [active]);
  useEffect(() => {
    if (!active) return;
    let alive = true, timer;
    const controller = new AbortController();
    async function poll() {
      try { const value = await request('/status', {signal:controller.signal}); if (alive) setJob(value.job); }
      catch (failure) { if (alive) setError(failure.message); }
      if (alive) timer = setTimeout(poll, 1200);
    }
    poll(); return () => { alive = false; clearTimeout(timer); controller.abort(); };
  }, [active]);
  const running = ['queued','running','stopping'].includes(job?.status);
  async function slice() {
    setBusy(true); setError('');
    try {
      if (file.size > 50*1024**2) throw Error('Choose an STL no larger than 50 MiB.');
      const body = new FormData(); body.append('file', file); body.append('options', JSON.stringify(options));
      setJob(await request('/jobs', {method:'POST',body}));
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="tools-workspace linked-apps" aria-label="3D Slicer">
    <header className="tools-heading"><h1>3D Slicer</h1><button onClick={refresh}>Refresh Cura readiness</button></header>
    <p>Create a G-code file using your installed CuraEngine. Select your printer and check its dimensions, nozzle and material settings before printing.</p>
    {ready && <p role="status">{ready.ready ? `CuraEngine ready: ${ready.engine}` : ready.message}</p>}
    <div className="tools-toolbar"><button disabled={busy || running} onClick={() => input.current.click()}>Choose STL</button><input ref={input} hidden type="file" accept=".stl" onChange={event => {setFile(event.target.files?.[0] || null); event.target.value='';}}/><span>{file?.name || 'No model selected'}</span></div>
    <fieldset disabled={busy || running} className="linked-fields"><legend>Printer and slicing settings</legend>
      <label>Printer profile<select aria-label="Slicer printer profile" value={options.machine} onChange={event => change({machine:event.target.value, generic_confirmed:false})}>{(ready?.machines || [{id:'fdmprinter',name:'Generic printer'}]).map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
      {options.machine === 'fdmprinter' && <label><input type="checkbox" checked={options.generic_confirmed} onChange={event => change({generic_confirmed:event.target.checked})}/>My printer uses a 220 × 220 × 250 mm build volume, one extruder and 1.75 mm filament, with generic G-code.</label>}
      <label>Material<select value={options.material} onChange={event => change({material:event.target.value})}><option value="pla">PLA · 200°C / 60°C</option><option value="petg">PETG · 235°C / 75°C</option><option value="abs">ABS · 245°C / 100°C</option></select></label>
      {options.machine === 'fdmprinter' && <label><input type="checkbox" checked={options.heated_bed} onChange={event => change({heated_bed:event.target.checked})}/>Generic printer has a heated bed</label>}
      <label>Layer height (mm)<input type="number" min=".06" max=".6" step=".02" value={options.layer_height} onChange={event => change({layer_height:Number(event.target.value)})}/></label>
      <label>Nozzle diameter (mm)<input type="number" min=".2" max="1.2" step=".1" value={options.nozzle} onChange={event => change({nozzle:Number(event.target.value)})}/></label>
      <label>Infill (%)<input type="number" min="0" max="100" value={options.infill} onChange={event => change({infill:Number(event.target.value)})}/></label>
      <label><input type="checkbox" checked={options.support} onChange={event => change({support:event.target.checked})}/>Generate supports</label>
    </fieldset>
    <button disabled={busy || running || !file || !ready?.ready || (options.machine === 'fdmprinter' && !options.generic_confirmed)} onClick={slice}>Slice model</button>
    {job && <div className="linked-job" role="status"><strong>{job.phase} · {job.status}</strong><p>{job.name} · {job.elapsed_seconds}s elapsed</p><progress value={job.progress} max="100"/>{running && <button onClick={async () => {try {setJob(await request(`/jobs/${job.id}/stop`,{method:'POST'}));} catch(failure){setError(failure.message);}}}>Stop slicing</button>}{job.message && <p>{job.message}</p>}{job.status === 'complete' && <a href={apiUrl(`/slicer/jobs/${job.id}/file`)} download={job.name}>Download G-code</a>}</div>}
    {error && <p role="alert">{error}</p>}
    <p>STL inputs are preserved. Slicing runs in the background when you change tabs. Printer profiles remain unchanged; this workspace exports G-code and does not send it to a printer.</p>
  </section>;
}
