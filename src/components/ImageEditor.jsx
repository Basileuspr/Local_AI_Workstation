import { updateColorSample, removeColorSample } from '../imageEditorColors';
import ImageMagic from './ImageMagic';
import { useEffect, useRef, useState } from "react";
import FreshFileInput from "./FreshFileInput";
import { ADJUSTMENT_CONTROLS, editedFilename } from "../imageEditor";
import { currentPass, editRecipe, hasCurrentPass, lockEditStage, newEditState, repeatEditStage, unlockEditStage } from "../imageEditorStages";
import { openEditorImage } from "../imageEditorSession";
import { downloadBlob } from "../downloadBlob";
import "./ImageEditor.css";
import { useImageDestinations } from "../ImageDestinations";

export default function ImageEditor({ inlineInput, onSave, onCancel }) {
  const destinations = useImageDestinations();
  const pendingInput = inlineInput || destinations?.editorInput;
  const [session, setSession] = useState(null), sessionRef = useRef(null);
  const [edit, setEdit] = useState(() => newEditState());
  const settings = edit.settings, pass = currentPass(edit);
  const [reference, setReference] = useState(null), [referenceBusy, setReferenceBusy] = useState(false);
  const [activeColorId, setActiveColorId] = useState("sample-1"), [colorMode, setColorMode] = useState("fill"), [colorArmed, setColorArmed] = useState(false);
  const activeSample=edit.colorSamples.find(sample=>sample.id===activeColorId) || edit.colorSamples[0];
  const sampleColor=activeSample?.color || "#e2b899";
  const [editComment,setEditComment]=useState("");
  const [magicRequest,setMagicRequest]=useState(null);
  const [colorStrength, setColorStrength] = useState(100), [colorTolerance, setColorTolerance] = useState(18), [brushSize, setBrushSize] = useState(3), [protectLines, setProtectLines] = useState(true);
  const [history, setHistory] = useState([]), [future, setFuture] = useState([]);
  const [original, setOriginal] = useState(""), [preview, setPreview] = useState("");
  const [nativeOriginal, setNativeOriginal] = useState(""), [previewSize, setPreviewSize] = useState(null);
  const [compare, setCompare] = useState(false), [zoom, setZoom] = useState("fit");
  const [loading, setLoading] = useState(false), [exporting, setExporting] = useState(false), [rendering, setRendering] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const lock = useRef(false), mounted = useRef(true), editorRoot=useRef(null);
  useEffect(() => {
    if (!pendingInput || lock.current) return;
    void open(pendingInput.file).finally(() => { if (!inlineInput) destinations.consumed(pendingInput.id); });
  }, [pendingInput, inlineInput ? false : loading, inlineInput ? false : exporting]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sessionRef.current?.close(); }; }, []);
  useEffect(() => () => { if (original) URL.revokeObjectURL(original); }, [original]);
  useEffect(() => () => { if (nativeOriginal) URL.revokeObjectURL(nativeOriginal); }, [nativeOriginal]);
  useEffect(() => () => { if (reference?.url) URL.revokeObjectURL(reference.url); }, [reference]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setRendering(true);
    const timer = setTimeout(() => session.request(zoom === "fit" ? "preview" : "inspect", editRecipe(edit)).then(({ blob, width, height }) => {
      if (!cancelled && sessionRef.current === session) { setPreview(URL.createObjectURL(blob)); setPreviewSize({width,height}); setRendering(false); }
    }).catch(failure => { if (!cancelled && sessionRef.current === session) { setError(failure.message); setRendering(false); } }), 100);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session, edit, zoom === "fit"]);

  useEffect(() => {
    if (!session || zoom === "fit" || nativeOriginal) return;
    let cancelled = false;
    session.request("original").then(({blob}) => {
      if (!cancelled && sessionRef.current === session) setNativeOriginal(URL.createObjectURL(blob));
    }).catch(failure => { if (!cancelled && sessionRef.current === session) setError(failure.message); });
    return () => { cancelled = true; };
  }, [session, zoom === "fit"]);

  async function open(file) {
    if (!file || lock.current) return;
    lock.current = true; setLoading(true); setError(""); setNotice("");
    try {
      const next = await openEditorImage(file);
      if (!mounted.current) { next.close(); return; }
      sessionRef.current?.close(); sessionRef.current = next; setSession(next);
      setOriginal(URL.createObjectURL(next.blob)); setPreview(URL.createObjectURL(next.blob));
      setNativeOriginal(""); setPreviewSize({width:next.width,height:next.height});
      setEdit(newEditState(inlineInput?.settings)); setActiveColorId("sample-1"); setColorArmed(false); setMagicRequest(null); setHistory([]); setFuture([]); setCompare(false); setZoom("fit");
      setNotice("Image ready. Edits apply to a copy; your original stays unchanged.");
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { lock.current = false; if (mounted.current) setLoading(false); }
  }
  function change(value) {
    setHistory(items => [...items.slice(-39), edit]); setFuture([]);
    setEdit(value); setCompare(false); setNotice("");
  }
  function setSampleColor(color) {
    if(activeSample)change(updateColorSample(edit,activeSample.id,{color}));
  }
  function addColorSample(){const sample={id:crypto.randomUUID(),name:`Sample ${edit.colorSamples.length+1}`,color:sampleColor};change({...edit,colorSamples:[...edit.colorSamples,sample]});setActiveColorId(sample.id);}
  function requestColorCorrection(){
    if(!editComment.trim())return;
    setMagicRequest({id:crypto.randomUUID(),prompt:editComment.trim(),useReference:Boolean(reference)});
    const panel=editorRoot.current?.querySelector('.ie-magic');if(panel){panel.open=true;panel.scrollIntoView({block:'start',behavior:'smooth'});}
  }
  function adjust(value) { change({ ...edit, settings: value }); }
  function undo() { if (history.length) { setFuture(items => [edit, ...items]); setEdit(history.at(-1)); setHistory(items => items.slice(0, -1)); setCompare(false); } }
  function redo() { if (future.length) { setHistory(items => [...items, edit]); setEdit(future[0]); setFuture(items => items.slice(1)); setCompare(false); } }
  async function openReference(file) {
    if (!file || referenceBusy) return;
    setReferenceBusy(true); setError("");
    try { const loaded = await openEditorImage(file); loaded.close(); if(mounted.current){setReference({url:URL.createObjectURL(loaded.blob),name:loaded.name,file:new File([loaded.blob],loaded.name,{type:"image/png"})});setNotice("Reference ready. Click its image to sample a color, then choose an area in the edited image.");} }
    catch(failure){if(mounted.current)setError(failure.message);}
    finally{if(mounted.current)setReferenceBusy(false);}
  }
  function imagePoint(event) {
    const img=event.currentTarget, box=img.getBoundingClientRect(), scale=Math.min(box.width/img.naturalWidth,box.height/img.naturalHeight);
    const w=img.naturalWidth*scale,h=img.naturalHeight*scale,x=(event.clientX-box.left-(box.width-w)/2)/w,y=(event.clientY-box.top-(box.height-h)/2)/h;
    return x>=0 && x<=1 && y>=0 && y<=1 ? {x,y} : null;
  }
  function sampleReference(event) {
    if(!activeSample || busy)return;
    const point=imagePoint(event); if(!point)return;
    const img=event.currentTarget, canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(img,0,0);
    const pixel=context.getImageData(Math.min(canvas.width-1,Math.floor(point.x*canvas.width)),Math.min(canvas.height-1,Math.floor(point.y*canvas.height)),1,1).data;
    if(!pixel[3]){setNotice('Choose a visible reference pixel to sample its color.');return;}
    setSampleColor('#'+[...pixel.slice(0,3)].map(c=>c.toString(16).padStart(2,'0')).join(''));
    setNotice('Reference color sampled. Choose Apply color to image, then click the area to correct.');
  }
  function recolor(event) {
    if(!colorArmed || !activeSample || busy || rendering || compare)return;
    const point=imagePoint(event);if(!point)return;
    if(edit.colorEdits.length>=100){setError('Lock this color pass before adding more areas.');return;}
    const color=sampleColor.slice(1).match(/../g).map(c=>parseInt(c,16));
    change({...edit,colorEdits:[...edit.colorEdits,{...point,color,sampleId:activeSample.id,mode:colorMode,strength:colorStrength,tolerance:colorTolerance,radius:brushSize/100,protectLines}]});
  }
  async function save() {
    if (!session || lock.current) return;
    lock.current = true; setExporting(true); setError("");
    try { const { blob, width, height } = await session.request("export", editRecipe(edit)); if (onSave) await onSave(blob, editedFilename(session.name), editRecipe(edit)); else downloadBlob(blob, editedFilename(session.name)); setNotice(`Edited PNG prepared at ${width} × ${height}. Original unchanged.`); }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setExporting(false); }
  }

  const busy = loading || exporting || referenceBusy || magicBusy;
  return <section ref={editorRoot} className={`image-editor ${inlineInput ? "chat-inline-editor" : ""}`} aria-label={inlineInput ? "Edit image in chat" : "Image Editor"} onKeyDown={event=>{if(busy||event.target.closest('input,textarea,select,[contenteditable=true]')||!(event.ctrlKey||event.metaKey))return;const key=event.key.toLowerCase();if(key==='z'||key==='y'){event.preventDefault();if(key==='y'||event.shiftKey)redo();else undo();}}}>
    <header className="ie-header"><div><span className="ie-eyebrow">Color &amp; tone</span><h1>Image Editor</h1><p>One image in focus. Adjust its colors while preserving its composition and detail.</p></div>
      {inlineInput ? <button disabled={busy} onClick={onCancel}>Cancel edit</button> : <label className="ie-import">{loading ? "Opening…" : session ? "Open another image" : "Open image"}<FreshFileInput aria-label="Open image for editing" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; open(file); }} /></label>}
    </header>
    {error && <p className="ie-error" role="alert">{error}</p>}{notice && <p className="ie-notice" role="status">{notice}</p>}
    <div className="ie-history ie-main-history" role="toolbar" aria-label="Image editing tools"><button disabled={!history.length || busy} onClick={undo}>Undo</button><button disabled={!future.length || busy} onClick={redo}>Redo</button><button disabled={!session || busy || !hasCurrentPass(edit)} onClick={() => change({ ...edit, settings: { ...edit.anchor }, colorEdits: [] })}>Reset</button>
      <div className="ie-rotation-controls" role="group" aria-label="Image rotation">
        <button disabled={!session || busy} title="Rotate 90° counterclockwise" onClick={() => adjust({ ...settings, rotation: ((settings.rotation || 0) + 270) % 360 })}>Rotate left</button>
        <button disabled={!session || busy} title="Rotate 90° clockwise" onClick={() => adjust({ ...settings, rotation: ((settings.rotation || 0) + 90) % 360 })}>Rotate right</button>
      </div>
    </div>
    <div className="ie-workspace">
      <div className="ie-viewer"><div className="ie-toolbar">
        <button disabled={!session} aria-pressed={compare} onClick={() => setCompare(value => !value)}>{compare ? "Show edited" : "Show original"}</button>
        <label>Preview size<select aria-label="Preview size" value={zoom} disabled={!session} onChange={event => setZoom(event.target.value)}><option value="fit">Fit image</option><option value="100">100% · actual pixels</option><option value="200">200% · inspect pixels</option></select></label>
        <button disabled={!session || busy} onClick={event=>{const panel=event.currentTarget.closest(".image-editor").querySelector(".ie-magic");panel.open=true;panel.scrollIntoView({block:"start",behavior:"smooth"});}}>Magic Edit</button>
        <span aria-live="polite">{session ? `${compare ? "Original" : "Edited"}${rendering && !compare ? " · Updating…" : ""}` : "No image loaded"}</span>
      </div>
      <div className={`ie-stage ${zoom === "fit" ? "fit" : "zoomed"}`} onDragOver={event => { event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!busy) open(event.dataTransfer.files?.[0]); }}>
        {session ? <img onClick={recolor} className={colorArmed && !compare ? "ie-color-target" : ""} src={compare ? (zoom !== "fit" && nativeOriginal || original) : preview} alt={`${compare ? "Original" : "Edited"} preview of ${session.name}`} style={zoom !== "fit" ? { width: `${Math.round((compare ? session.width : previewSize?.width || session.width) * Number(zoom) / 100)}px`, imageRendering: zoom === "200" ? "pixelated" : "auto" } : undefined} />
          : <div className="ie-empty"><span aria-hidden="true">◈</span><h2>Bring an image into focus</h2><p>Open or drop a PNG, JPEG, or WebP here.</p><p>Reduce a red cast, fine-tune contrast, or adjust exposure.</p></div>}
      </div>
      {session && <p className="ie-file">{session.name} · {session.width} × {session.height}<br />Fit view uses a reduced preview. Choose 100% to judge detail at actual image pixels. Export keeps the full resolution.</p>}
      <ImageMagic key={original || 'empty'} session={session} preview={preview} reference={reference} requestedEdit={magicRequest} disabled={loading||exporting||referenceBusy} getSource={()=>session.request("export",editRecipe(edit))} onAccept={open} onBusy={value=>{lock.current=value;setMagicBusy(value);}}/>
      </div>
      <aside className="ie-controls" aria-label="Image adjustments"><h2>Adjustments</h2><p>{edit.stages.length ? `Working from ${edit.stages.length} locked stage(s). Current changes apply once to that result.` : "Current changes apply once to the source. Lock a pass to use its result as the next source."}</p>
        <div className="ie-lock-controls"><button disabled={!session || busy || !hasCurrentPass(edit) || edit.stages.length>=16} onClick={()=>{change(lockEditStage(edit));setNotice("Change locked. The markers stay at these positions; further slider movement edits the locked result.");}}>Lock current change</button>
        <button disabled={!edit.stages.length || busy || hasCurrentPass(edit) || edit.stages.length>=16} onClick={()=>change(repeatEditStage(edit))}>Repeat locked change</button>
        <button disabled={!edit.stages.length || busy || hasCurrentPass(edit)} onClick={()=>change(unlockEditStage(edit))}>{edit.stages.at(-1)?.repeated ? "Remove repeated stage" : "Unlock last stage"}</button></div>
        {edit.stages.length>0 && <details className="ie-locked-stages"><summary>{edit.stages.length} locked change(s)</summary><ol>{edit.stages.map((stage,index)=><li key={index}><strong>Stage {index+1}{stage.repeated ? " · repeated" : ""}</strong><span>{ADJUSTMENT_CONTROLS.filter(c=>stage.pass[c.key]).map(c=>`${c.label}: ${stage.pass[c.key]>0?"+":""}${stage.pass[c.key]}${c.unit}`).join(" · ")}{stage.pass.rotation ? ` · Rotation ${stage.pass.rotation}°` : ""}{stage.pass.colorEdits?.length ? ` · ${stage.pass.colorEdits.length} color areas` : ""}</span></li>)}</ol><p>Unlock to revise a previous pass. Reset clears only the current pass. Up to 16 locked stages.</p></details>}
        <details className="ie-reference"><summary>Reference source image{reference ? " · loaded" : ""}</summary><p>Sample a reference color and apply it to an enclosed area or brush spot. This uses local color editing, not automatic character recognition.</p>
          <label className="ie-import">{referenceBusy ? "Opening reference…" : "Open reference image"}<FreshFileInput aria-label="Open reference source image" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";openReference(file);}} /></label>
          {reference && <><img src={reference.url} alt={`Reference source: ${reference.name}. Click to sample a color.`} onClick={sampleReference}/><span className="ie-file">{reference.name}</span><button disabled={busy} onClick={()=>{setReference(null);setColorArmed(false);}}>Remove reference</button></>}
          <div className="ie-color-samples" role="group" aria-label="Saved color samples">{edit.colorSamples.map(sample=><button key={sample.id} disabled={busy} aria-pressed={activeSample?.id===sample.id} onClick={()=>setActiveColorId(sample.id)}><i style={{background:sample.color}} aria-hidden="true"/>{sample.name}<small>{edit.colorEdits.filter(area=>area.sampleId===sample.id).length} {edit.colorEdits.filter(area=>area.sampleId===sample.id).length===1?'area':'areas'}</small></button>)}</div>
          <button disabled={busy||edit.colorSamples.length>=16} onClick={addColorSample}>Add color sample</button>
          {activeSample&&<><label>Sample name<input aria-label="Color sample name" maxLength="60" value={activeSample.name} disabled={busy} onChange={e=>change(updateColorSample(edit,activeSample.id,{name:e.target.value}))}/></label>
          <button disabled={busy} onClick={()=>{change(removeColorSample(edit,activeSample.id));setColorArmed(false);}}>Remove selected sample</button><button disabled={busy||!edit.colorEdits.some(area=>area.sampleId===activeSample.id)} onClick={()=>change({...edit,colorEdits:edit.colorEdits.filter(area=>area.sampleId!==activeSample.id)})}>Clear this sample’s areas</button></>}
          <p>Choose a sample, then click the reference to set its color or apply it to areas below. Each sample keeps separate areas. Changing or removing a sample updates its current-pass areas; locked passes stay unchanged. Undo restores a removed sample.</p>
          <label>Sampled / chosen color<input aria-label="Reference color" type="color" disabled={busy||!activeSample} value={sampleColor} onChange={e=>setSampleColor(e.target.value)}/><output>{sampleColor}</output></label>
          <label>Apply with<select aria-label="Reference color application" value={colorMode} onChange={e=>setColorMode(e.target.value)}><option value="fill">Connected area fill</option><option value="brush">Brush spot</option></select></label>
          <label>{colorMode==='fill'?'Area tolerance':'Brush radius'}<input aria-label={colorMode==='fill'?'Area tolerance':'Brush radius'} type="range" min="1" max={colorMode==='fill'?100:20} value={colorMode==='fill'?colorTolerance:brushSize} onChange={e=>(colorMode==='fill'?setColorTolerance:setBrushSize)(Number(e.target.value))}/></label>
          <label>Color strength <output>{colorStrength}%</output><input aria-label="Reference color strength" type="range" min="0" max="100" value={colorStrength} onChange={e=>setColorStrength(Number(e.target.value))}/></label>
          <label className="ie-line-protection"><input type="checkbox" checked={protectLines} onChange={e=>setProtectLines(e.target.checked)}/> Preserve dark outlines &amp; shading</label>
          <button disabled={!session || busy || !activeSample} aria-pressed={colorArmed} onClick={()=>{setColorArmed(v=>!v);setCompare(false);}}>{colorArmed?"Finish applying color":"Apply color to image"}</button><p>{colorArmed ? "Click the edited image to apply. Undo removes the last area. If outlines have gaps, use a brush spot or lower tolerance." : "Fill follows connected similar colors. Brush spots give direct control over the area. Controls affect the next application."}</p>
          <label>Describe a reference correction<textarea aria-label="Reference correction request" rows="4" maxLength="6000" disabled={busy} value={editComment} onChange={e=>setEditComment(e.target.value)} placeholder="The image is all a singular color tone. Adjust the character skin tone to match the source reference image."/></label>
          <button disabled={!session||busy} onClick={()=>setEditComment('The image is all a singular color tone. Adjust the character skin tone to match the source reference image. Preserve the background, pose, outlines and all unrelated details.')}>Use skin-tone correction example</button>
          <button disabled={!session||busy||!editComment.trim()} onClick={requestColorCorrection}>Prepare this reference edit</button><p>This opens Magic Edit with your request and the current reference assigned to skin tone. Read the reference guidance, paint the character area, then generate and review a candidate.</p>
        </details>
        <details className="ie-quick"><summary>Quick adjustments</summary><fieldset disabled={!session || busy}><legend className="ie-sr-only">Quick adjustments</legend><div className="ie-presets">
          <button onClick={() => adjust({ ...settings, red: 60 })}>Reduce red hue</button><button onClick={() => adjust({ ...settings, contrast: Math.min(100, settings.contrast + 20) })}>Increase contrast</button><button onClick={() => adjust({ ...settings, exposure: Math.max(-3, settings.exposure - .5) })}>Decrease exposure</button>
        <button onClick={()=>adjust({...settings,deblur:Math.min(100,settings.deblur+35)})}>Reduce image blur</button><button onClick={()=>adjust({...settings,refinement:Math.min(100,settings.refinement+40)})}>Refine low-resolution image</button></div></fieldset></details>
        <div className="ie-adjustment-groups">{[...new Set(ADJUSTMENT_CONTROLS.map(c=>c.group))].map(group=><details key={group} className="ie-adjustment-group" open={group === "Light" || undefined}><summary>{group}</summary><fieldset disabled={!session || busy}><legend className="ie-sr-only">{group} adjustments</legend>{ADJUSTMENT_CONTROLS.filter(c=>c.group===group).map(control => <div className="ie-slider" key={control.key}><span>{control.label}<input className="ie-value" aria-label={`${control.label} value`} type="number" min={control.min} max={control.max} step={control.step} value={settings[control.key]} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))adjust({...settings,[control.key]:Math.max(control.min,Math.min(control.max,value))});}}/></span><div className={`ie-slider-track ie-${control.key}`}>{edit.stages.length>0 && <span className="ie-locked-marker" aria-hidden="true" style={{left:`calc(8px + (100% - 16px) * ${(edit.anchor[control.key]-control.min)/(control.max-control.min)})`}}/>}<input aria-label={control.label} aria-describedby={`ie-delta-${control.key}`} type="range" min={control.min} max={control.max} step={control.step} value={settings[control.key]} onChange={event => adjust({ ...settings, [control.key]: Number(event.target.value) })} /></div><small id={`ie-delta-${control.key}`}>{edit.stages.length ? `Locked ${edit.anchor[control.key]}${control.unit} · current pass ${pass[control.key]>0?"+":""}${pass[control.key]}${control.unit}` : control.unit === " EV" ? "Stops of light" : "Neutral: 0"}</small></div>)}</fieldset></details>)}</div>
        <p className="ie-hint">Remove blur and refinement sharpen existing detail without smoothing the image or resizing it. They cannot reconstruct missing detail or reverse heavy blur. Compare at 100% before exporting. To reduce sharpening already locked into a pass, use Unlock or Undo.</p>

        <button className="ie-start-over" disabled={!session || busy || (!edit.stages.length && !hasCurrentPass(edit))} onClick={()=>change(newEditState())}>Start from original</button>
        <button className="ie-export" disabled={!session || busy} onClick={save}>{exporting ? "Preparing full-size PNG…" : onSave ? "Send edited image to chat" : "Export edited PNG"}</button>
        <p className="ie-hint">Full-resolution, 8-bit sRGB PNG copy. Original file stays untouched. Animation and original file metadata are not retained.</p>
      </aside>
    </div>
  </section>;
}
