import { useEffect, useRef, useState } from "react";
import ProtectedImage, { useImagePrivacy } from "../ImagePrivacy";
import { apiUrl } from "../api";
import { gifFilename, gifThumbnailFilename, moveGifFrame, validateGifFrames } from "../gifMaker";
import { copyImage } from '../imageClipboard';
import {downloadBlob} from '../downloadBlob';
import {useGifThumbnails} from '../useGifThumbnails';
import GifFrameThumbnail from './GifFrameThumbnail';
import "./GifMaker.css";
import ImageResolutionControls from "./ImageResolutionControls";
import GifPlayer from "./GifPlayer";
import ImageViewer from "./ImageViewer";
import GifSaveActions from './GifSaveActions';
import GifOutputFolder from './GifOutputFolder';
import {useImageDestinations} from '../ImageDestinations';
import {QueueRequestStatus, QueueTimeSummary} from './PromptQueue';
import {useImageRemoval} from './ImageRemovalControls';

export function GifMakerWorkspace({active}) {
  const {gifInput, readImage} = useImageDestinations();
  return <GifMaker open={active} input={gifInput} readImage={readImage}/>;
}

export default function GifMaker({ open, input, readImage }) {
  const picker = useRef(null), framesRef = useRef([]), lock = useRef(false), controller = useRef(null), consumed = useRef(null);
  const preview = useRef(null);
  const privacy = useImagePrivacy();
  const privacyRef = useRef(privacy); privacyRef.current = privacy;
  const [frames, setFrames] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState("Animation"), [width, setWidth] = useState(512), [height, setHeight] = useState(512);
  const [duration, setDuration] = useState(200), [loop, setLoop] = useState(true), [background, setBackground] = useState("#ffffff");
  const [fit, setFit] = useState('cover'), [thumbnail, setThumbnail] = useState(null), [viewThumbnail, setViewThumbnail] = useState(false);
  const [result, setResult] = useState(null), [status, setStatus] = useState("");
  const [progress, setProgress] = useState(null), [selectedFrame, setSelectedFrame] = useState(null);
  const [queueRequestId, setQueueRequestId] = useState(null);
  const [outputFolder, setOutputFolder] = useState(null);
  const removal = useImageRemoval(frames, removed => {
    const ids = new Set(removed.map(frame => frame.id));
    removed.forEach(frame => URL.revokeObjectURL(frame.url));
    if (ids.has(selectedFrame)) setSelectedFrame(null);
    replaceFrames(framesRef.current.filter(frame => !ids.has(frame.id)));
  }, {label:'GIF frames', disabled:busy});
  const [thumbnailNotice, setThumbnailNotice] = useState('');
  const [thumbnailMode,setThumbnailMode] = useState('framed'), [thumbnailEdge,setThumbnailEdge] = useState(320), [tileSize,setTileSize] = useState('medium');
  const blocked = !privacy.ready || frames.some(frame => privacy.hashes.includes(frame.hash)) || !!(result && privacy.hashes.includes(result.hash)) || !!(thumbnail && [thumbnail.hash,...thumbnail.sourceHashes].some(hash=>privacy.hashes.includes(hash)));
  const thumbnailOptions = {width:Number(width),height:Number(height),fit,background,mode:thumbnailMode,maxSide:320};
  const {items:thumbnails,cache:thumbnailCache,retry:retryThumbnail} = useGifThumbnails(frames,thumbnailOptions,open && !blocked);
  const readyThumbnails = frames.filter(frame=>thumbnails[frame.id]?.status==='ready').length;
  const failedThumbnails = frames.filter(frame=>thumbnails[frame.id]?.status==='error').length;
  const thumbnailsReady = readyThumbnails === frames.length;
  useEffect(() => () => { controller.current?.abort(); framesRef.current.forEach(frame => URL.revokeObjectURL(frame.url)); }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => { setThumbnail(null); setViewThumbnail(false); }, [result]);
  useEffect(() => { if (result && open) preview.current?.scrollIntoView({block:'start'}); }, [result, open]);
  useEffect(() => () => { if (thumbnail) URL.revokeObjectURL(thumbnail.url); }, [thumbnail]);

  function replaceFrames(next) { framesRef.current = next; setFrames(next); setResult(null); setThumbnail(null); setViewThumbnail(false); }
  async function showThumbnail(blob, filename, sourceHashes) {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if (!privacyRef.current.ready || [hash,...sourceHashes].some(value=>privacyRef.current.hashes.includes(value))) throw new Error('Unlock this image before capturing its thumbnail.');
    setThumbnail({id:crypto.randomUUID(), url:URL.createObjectURL(blob), name:filename, hash, sourceHashes});
    setThumbnailNotice('');
    setSelectedFrame(null); setViewThumbnail(true);
  }
  async function exportThumbnail(frame, action) {
    if (lock.current || blocked || !frame) return;
    lock.current = true; setBusy(true); setError(''); setThumbnailNotice(''); setProgress({phase:'Preparing thumbnail'});
    let url;
    try {
      const {blob} = await thumbnailCache.get(frame,{...thumbnailOptions,maxSide:thumbnailEdge});
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      if (!privacyRef.current.ready || [hash,frame.hash].some(value=>privacyRef.current.hashes.includes(value))) throw new Error('Unlock this image before exporting its thumbnail.');
      if (action === 'copy') {
        url=URL.createObjectURL(blob); await copyImage(url);
        setThumbnailNotice(`Thumbnail copied for ${frame.file.name}.`);
      } else {
        downloadBlob(blob,gifThumbnailFilename(frame.file.name));
        setThumbnailNotice(`Thumbnail PNG prepared for ${frame.file.name}.`);
      }
    } catch (failure) { setError(failure.message); setThumbnailNotice(failure.message); }
    finally { if(url)URL.revokeObjectURL(url); lock.current=false; setBusy(false); setProgress(null); }
  }
  async function copyThumbnail() {
    if (!thumbnail || blocked) return;
    try { await copyImage(thumbnail.url); setThumbnailNotice('Thumbnail copied.'); }
    catch (failure) { setThumbnailNotice(failure.message); }
  }
  async function saveThumbnailZip() {
    if (lock.current || blocked || !frames.length || !thumbnailsReady) return;
    lock.current=true; setBusy(true); setError(''); setProgress({phase:'Preparing thumbnail ZIP',completed:0,total:frames.length});
    const request = new AbortController(); controller.current=request;
    const sourceHashes=frames.map(frame=>frame.hash), derivedHashes=[];
    function checkPrivacy() {
      if (request.signal.aborted) throw new DOMException('Cancelled','AbortError');
      if (!privacyRef.current.ready || [...sourceHashes,...derivedHashes].some(hash=>privacyRef.current.hashes.includes(hash))) throw new Error('Unlock the source images before exporting their thumbnails.');
    }
    try {
      const body=new FormData(), entries=[];
      for (const [index,frame] of frames.entries()) {
        checkPrivacy();
        const {blob}=await thumbnailCache.get(frame,{...thumbnailOptions,maxSide:thumbnailEdge});
        derivedHashes.push([...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join(''));
        const filename=gifThumbnailFilename(frame.file.name,index);
        body.append('files',blob,filename); entries.push({path:filename,directory:false});
        setProgress({phase:'Preparing thumbnail ZIP',completed:index+1,total:frames.length});
      }
      checkPrivacy();
      const filename=gifFilename(name).replace(/\.gif$/i,'-thumbnails.zip');
      body.append('entries',JSON.stringify(entries)); body.append('name',filename); body.append('compression','stored');
      setProgress({phase:'Packaging thumbnails'});
      const response=await fetch(apiUrl('/workspaces/package'),{method:'POST',body,signal:request.signal});
      if (!response.ok) {const data=await response.json().catch(()=>({}));throw new Error(typeof data.detail==='string'?data.detail:'Could not package the thumbnails.');}
      const blob=await response.blob(); checkPrivacy(); downloadBlob(blob,filename); setStatus(`${frames.length} thumbnails prepared as a ZIP.`);
    } catch (failure) {if (failure.name==='AbortError')setStatus('Thumbnail export cancelled.');else setError(failure.message);}
    finally {controller.current=null;lock.current=false;setBusy(false);setProgress(null);}
  }
  async function add(source) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setStatus("Adding frames…");
    setProgress({phase:'Loading images'});
    const additions = [];
    try {
      const files = await source();
      validateGifFrames([...framesRef.current.map(frame => frame.file), ...files]);
      setProgress({phase:'Importing images', completed:0, total:files.length});
      for (const file of files) {
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        additions.push({ id: crypto.randomUUID(), file, hash, url: URL.createObjectURL(file) });
        setProgress({phase:'Importing images', completed:additions.length, total:files.length});
      }
      replaceFrames([...framesRef.current, ...additions]); setStatus(`${files.length} frame(s) added.`);
    } catch (failure) { additions.forEach(frame => URL.revokeObjectURL(frame.url)); setError(failure.message); setStatus(""); }
    finally { lock.current = false; setBusy(false); setProgress(null); }
  }
  useEffect(() => {
    if (!input || busy || consumed.current === input.id) return;
    consumed.current = input.id;
    void add(async () => {
      if (framesRef.current.length + input.images.length + input.files.length > 60) throw new Error("A GIF can contain up to 60 frames. Clear or remove frames first.");
      const files = [...input.files];
      for (const image of input.images) {
        setProgress({phase:'Loading images',completed:files.length,total:input.files.length+input.images.length});
        files.push(await readImage(image));
        validateGifFrames([...framesRef.current.map(frame => frame.file), ...files]);
      }
      return files;
    });
  }, [input, busy]);

  async function create(event) {
    event.preventDefault();
    if (lock.current || blocked || frames.length < 2 || !thumbnailsReady) return;
    lock.current = true; setBusy(true); setError(""); setResult(null); setStatus("Creating GIF…");
    setProgress({phase:'Uploading images'});
    const request = new AbortController(); controller.current = request;
    const requestId = crypto.randomUUID(), pollController = new AbortController();
    setQueueRequestId(requestId);
    let timer, polling = false, pollingStopped = false;
    async function poll() {
      if (polling || pollingStopped || request.signal.aborted) return;
      polling = true;
      try {
        const response = await fetch(apiUrl(`/workspaces/gif/progress/${requestId}`), {signal:pollController.signal});
        if (response.ok) {
          const data = await response.json();
          if (!pollingStopped && !request.signal.aborted && data.progress) setProgress(data.progress);
        }
      } catch { /* The main request remains authoritative if a progress poll fails. */ }
      finally { polling = false; }
    }
    try {
      const body = new FormData();
      body.append('request_id',requestId);
      body.append('name',name);
      frames.forEach(frame => body.append("files", frame.file, frame.file.name));
      for (const [key, value] of Object.entries({ width, height, duration, loop, background, fit })) body.append(key, String(value));
      timer = setInterval(poll, 250);
      const response = await fetch(apiUrl("/workspaces/gif"), { method: "POST", body, signal: request.signal });
      pollingStopped = true; clearInterval(timer); pollController.abort();
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.detail === "string" ? data.detail : "Could not create the GIF. Check its settings and try again.");
      }
      setProgress({phase:'Loading preview'});
      const blob = await response.blob();
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (!request.signal.aborted) {
        let saved = null;
        if (outputFolder) {
          controller.current = null; setQueueRequestId(null); setProgress({phase:'Saving GIF to output folder'});
          try {
            if (!privacyRef.current.ready || [hash,...frames.map(frame=>frame.hash)].some(value=>privacyRef.current.hashes.includes(value))) throw new Error('Unlock the source images before saving this GIF.');
            const exported = await window.workstationDesktop.saveGif({bytes:await blob.arrayBuffer(),name:gifFilename(name),folderId:outputFolder.id});
            if (exported.error || exported.canceled) throw new Error(exported.error || 'The output save was cancelled.');
            saved = exported;
          } catch (failure) {setError(`GIF created, but automatic saving failed: ${failure.message} Use Save GIF to choose another location.`);}
        }
        setResult({blob, hash, url:URL.createObjectURL(blob), loop, saved});
        setStatus(saved ? 'GIF ready and saved to the selected folder.' : 'GIF ready. Play, pause, or capture a thumbnail in the preview.');
      }
    } catch (failure) { if (failure.name === "AbortError") setStatus("Cancelled. Your frames are still here."); else { setError(failure.message); setStatus(""); } }
    finally { pollingStopped = true; clearInterval(timer); pollController.abort(); controller.current = null; lock.current = false; setBusy(false); setProgress(null); setQueueRequestId(null); }
  }
  function setting(setter, value) { setter(value); setResult(null); }
  return <><section className="gif-maker gif-maker-workspace" aria-labelledby="gif-maker-title"
    onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const files = Array.from(event.dataTransfer.files); void add(async () => files); }}>
    <header><div><h2 id="gif-maker-title">GIF Maker</h2>
      {busy && progress && <div className="gif-maker-progress"><span role="status">{progress.phase}{progress.total ? ` · ${progress.completed} / ${progress.total}` : '…'}{Number.isFinite(progress.elapsed_seconds) ? ` · ${Math.floor(progress.elapsed_seconds)}s elapsed` : ''}</span><progress aria-label="GIF Maker progress" {...(progress.total && progress.completed !== null ? {max:progress.total,value:progress.completed} : {})} /></div>}
    </div>{busy && controller.current && <button type="button" onClick={()=>controller.current?.abort()}>Cancel {queueRequestId ? 'GIF' : 'export'}</button>}</header>
    {queueRequestId && <QueueRequestStatus requestId={queueRequestId} kind="gif"/>}
    <QueueTimeSummary kind="gif"/>

    <GifOutputFolder value={outputFolder} onChange={setOutputFolder} disabled={busy}/>
    <div className="gif-maker-toolbar"><button type="button" disabled={busy} onClick={() => picker.current.click()}>Add images</button>
      <input ref={picker} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => { const files = Array.from(event.target.files); event.target.value = ""; void add(async () => files); }} />
      <button type="button" disabled={busy || !frames.length} onClick={() => { frames.forEach(frame => URL.revokeObjectURL(frame.url)); replaceFrames([]); setError(""); setStatus(""); }}>Clear frames</button><span>{frames.length} / 60 frames</span></div>
    <div ref={preview} className="gif-maker-result">
      <h3>Animation preview</h3>
      {result && !blocked ? <>
        {open && <GifPlayer blob={result.blob} loop={result.loop} onCapture={(blob, frame) => showThumbnail(blob,gifFilename(name).replace(/\.gif$/i, `-frame-${frame}.png`),frames.map(item=>item.hash)).catch(failure=>setError(failure.message))} />}
        <GifSaveActions key={result.url} blob={result.blob} url={result.url} name={name} initialSaved={result.saved}/>
        {thumbnail && <button type="button" className="gif-thumbnail" onClick={() => setViewThumbnail(true)} aria-label="Open captured thumbnail in image viewer"><ProtectedImage src={thumbnail.url} alt="Captured GIF thumbnail" /><span>View captured thumbnail</span></button>}
      </> : <p>{blocked && frames.length ? 'Unlock or remove locked frames to preview.' : 'Add at least two images and select Create GIF to play the animation here.'}</p>}
    </div>
    {frames.length > 0 && <><div className="gif-thumbnail-toolbar">
      <label>Thumbnail framing<select aria-label="Thumbnail framing" disabled={busy} value={thumbnailMode} onChange={event=>setThumbnailMode(event.target.value)}><option value="framed">GIF crop and background</option><option value="original">Whole source image</option></select></label>
      <label>Thumbnail export size<select aria-label="Thumbnail export size" disabled={busy} value={thumbnailEdge} onChange={event=>setThumbnailEdge(Number(event.target.value))}>{[160,320,640,1024].map(value=><option key={value} value={value}>{value}px max edge</option>)}</select></label>
      <label>Grid size<select aria-label="Thumbnail grid size" value={tileSize} onChange={event=>setTileSize(event.target.value)}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <button type="button" disabled={busy || blocked || !thumbnailsReady} onClick={saveThumbnailZip}>Save thumbnails ZIP</button>
    </div>
    {thumbnailNotice && <p role="status">{thumbnailNotice}</p>}
    {!blocked && <div className="gif-thumbnail-summary" role="status">{readyThumbnails} / {frames.length} thumbnails ready{failedThumbnails > 0 && ` · ${failedThumbnails} failed — retry or remove these frames before creating the GIF.`}{!thumbnailsReady && !failedThumbnails && <progress aria-label="Building frame thumbnails" value={readyThumbnails} max={frames.length}/>}</div>}
    </>}
    {removal.toolbar}
    <ol className={`gif-maker-frames gif-grid-${tileSize}`} aria-label="Animation frames">{frames.map((frame, index) => <li key={frame.id}>
      {removal.controls(frame, `frame ${index + 1}`)}
      <GifFrameThumbnail frame={frame} index={index} item={thumbnails[frame.id]} blocked={blocked} onOpen={()=>setSelectedFrame(frame.id)} onRetry={()=>retryThumbnail(frame)} />
      <div className="gif-thumbnail-actions">
        <button type="button" disabled={busy || blocked || thumbnails[frame.id]?.status!=='ready'} aria-label={`Copy thumbnail for frame ${index+1}`} onClick={()=>exportThumbnail(frame,'copy')}>Copy thumbnail</button>
        <button type="button" disabled={busy || blocked || thumbnails[frame.id]?.status!=='ready'} aria-label={`Save thumbnail for frame ${index+1}`} onClick={()=>exportThumbnail(frame,'save')}>Save thumbnail</button>
      </div>
      <span title={frame.file.name}>{index + 1}. {frame.file.name}</span><div>
        <button type="button" disabled={busy || index === 0} aria-label={`Move frame ${index + 1} earlier`} onClick={() => replaceFrames(moveGifFrame(frames, index, -1))}>←</button>
        <button type="button" disabled={busy || index === frames.length - 1} aria-label={`Move frame ${index + 1} later`} onClick={() => replaceFrames(moveGifFrame(frames, index, 1))}>→</button>
      </div></li>)}</ol>
    <form onSubmit={create}><fieldset disabled={busy}><legend>Animation settings</legend>
      <label>Name<input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
      <ImageResolutionControls width={width} height={height} min={64} max={1024} prefix="GIF " onChange={size=>{setWidth(size.width);setHeight(size.height);setResult(null);}} />
      <label>Frame time (ms)<input type="number" required min="50" max="2000" step="10" value={duration} onChange={event => setting(setDuration, event.target.value)} /></label>
      <label>Background<input type="color" value={background} onChange={event => setting(setBackground, event.target.value)} /></label>
      <label>Frame sizing<select aria-label="GIF frame sizing" value={fit} onChange={event => setting(setFit, event.target.value)}><option value="cover">Fill frame · crop edges</option><option value="contain">Fit whole image · keep borders</option></select></label>
      <label className="gif-maker-loop"><input type="checkbox" checked={loop} onChange={event => setting(setLoop, event.target.checked)} />Loop forever</label>
    </fieldset>
      <button type="submit" disabled={busy || blocked || frames.length < 2 || !thumbnailsReady}>Create GIF</button>
      {busy && controller.current && <button type="button" onClick={() => controller.current?.abort()}>Cancel</button>}
    </form>
    {blocked && frames.length > 0 && <p role="alert">Unlock or remove locked frames before creating or viewing this animation.</p>}
    {error && <p role="alert">{error}</p>}<p role="status">{status}</p>
  </section>
  {open && selectedFrame && !blocked && <ImageViewer images={frames.map(frame=>({id:frame.id,url:frame.url,name:frame.file.name}))} selectedId={selectedFrame} onSelect={setSelectedFrame} onClose={()=>setSelectedFrame(null)} actions={image=><><a href={image.url} download={image.name}>Save original</a><button disabled={busy} onClick={()=>exportThumbnail(frames.find(frame=>frame.id===image.id),'copy')}>Copy thumbnail</button><button disabled={busy} onClick={()=>exportThumbnail(frames.find(frame=>frame.id===image.id),'save')}>Save thumbnail</button>{thumbnailNotice && <span role="status">{thumbnailNotice}</span>}</>} />}
  {open && viewThumbnail && thumbnail && !blocked && <ImageViewer images={[thumbnail]} selectedId={thumbnail.id} onSelect={()=>{}} onClose={()=>setViewThumbnail(false)} actions={image=><><button onClick={copyThumbnail}>Copy thumbnail</button><a href={image.url} download={image.name}>Save thumbnail PNG</a>{thumbnailNotice && <span role="status">{thumbnailNotice}</span>}</>} />}
  </>;
}
