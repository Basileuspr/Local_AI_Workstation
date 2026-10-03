import { useRef, useState } from "react";
import {useImageRemoval} from './ImageRemovalControls';
import { apiUrl } from "../api";
import {downloadConvertedImage} from '../convertedImages';
import "./Tools.css";
import ImageThumbnail, { FileImageThumbnail, ThumbnailRetryButton } from "./ImageThumbnail";

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

export function ConvertedAttachment({ artifact }) {
  const [saving,setSaving]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  const lock=useRef(false);
  async function download() {
    if(lock.current)return;lock.current=true;setSaving(true);setNotice('');setError('');
    try {const result=await downloadConvertedImage(artifact);setNotice(result.canceled?'Save cancelled. The converted image is still available.':result.saved?`Saved ${result.name || artifact.name}.`:'Download started. Check your browser downloads.');}
    catch(failure){setError(failure.message || 'The image could not be saved. Try again.');}
    finally{lock.current=false;setSaving(false);}
  }
  return <div className="document-attachment"><span className="file-thumbnail-slot"><ImageThumbnail src={apiUrl(`/workspaces/converted/${artifact.id}`)} alt={artifact.name} /></span><strong>{artifact.name}</strong><span>{artifact.width} × {artifact.height} · {Math.ceil(artifact.size / 1024)} KB</span><button type="button" disabled={saving} onClick={download}>{saving?'Saving…':artifact.format==='ico'?'Download .ico':'Download image'}</button>{notice && <span role="status">{notice}</span>}{error && <span role="alert">{error}</span>}</div>;
}

export default function FileConverter() {
  const input = useRef(null), [files, setFiles] = useState([]), [target, setTarget] = useState("png");
  const [iconSize, setIconSize] = useState(256), [iconFit, setIconFit] = useState('contain');
  const [results, setResults] = useState([]), [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [errors, setErrors] = useState([]);
  const removal=useImageRemoval(files, removed=>setFiles(current=>current.filter(file=>!removed.includes(file))),
    {label:'conversion inputs',disabled:busy,key:file=>`${file.name}:${file.size}:${file.lastModified}`});
  const outputRemoval=useImageRemoval(results, removed=>setResults(current=>current.filter(item=>!removed.includes(item))),{label:'converted images',disabled:busy});
  async function convert() {
    setBusy(true); setResults([]); setErrors([]);
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Converting ${index + 1} of ${files.length}: ${file.name}`);
        try {
          if (file.size > MAX_IMAGE_BYTES) throw new Error("Image exceeds the 100 MB file size limit.");
          const body = new FormData(); body.append("file", file); body.append("target", target);
          if (target === 'ico') { body.append('icon_size', iconSize); body.append('icon_fit', iconFit); }
          const response = await fetch(apiUrl("/workspaces/convert"), { method: "POST", body });
          const result = await response.json(); if (!response.ok) throw new Error(result.detail || "Conversion failed.");
          setResults(current => [...current, result]);
        } catch (error) { setErrors(current => [...current, `${file.name}: ${error.message}`]); }
      }
    } finally { setBusy(false); setProgress("Finished."); }
  }
  return <section className="tools-workspace" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)setFiles(Array.from(e.dataTransfer.files));}}>
    <header className="tools-heading"><h1>File Converter</h1><p>Still images up to 100 MB and 24 megapixels each.</p></header>
    <div className="tools-toolbar"><button disabled={busy} onClick={()=>input.current.click()}>Choose images</button><input ref={input} hidden multiple type="file" accept="image/*" onChange={e=>{setFiles(Array.from(e.target.files));e.target.value="";}} />
      <label>Convert to <select disabled={busy} value={target} onChange={e=>setTarget(e.target.value)}>{["png","jpg","webp","bmp","tiff","ico"].map(format=><option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>
      {target === 'ico' && <><label>Largest icon size<select aria-label="Largest icon size" disabled={busy} value={iconSize} onChange={event => setIconSize(Number(event.target.value))}>{[16,24,32,48,64,128,256].map(size => <option key={size} value={size}>{size} × {size}</option>)}</select></label><label>Icon fit<select aria-label="Icon fit" disabled={busy} value={iconFit} onChange={event => setIconFit(event.target.value)}><option value="contain">Fit · transparent padding</option><option value="cover">Fill · crop edges</option></select></label></>}
      <button disabled={busy||!files.length} onClick={convert}>Convert {files.length || ""} file{files.length===1?"":"s"}</button>
    </div>
    {target === 'ico' && <p>Creates a Windows ICO with smaller icon sizes included. Fit keeps the entire image; Fill makes it occupy the square. Small inputs are enlarged to the selected size.</p>}

    {files.length > 0 && <ThumbnailRetryButton />}
    {removal.toolbar}<ul className="thumbnail-file-list">{files.map((file,i)=><li key={i}><FileImageThumbnail file={file} /><span className="thumbnail-filename">{file.name}</span>{removal.controls(file, `conversion input ${file.name}`)}</li>)}</ul><p role="status">{progress}</p>
    {errors.map((error,i)=><p role="alert" key={i}>{error}</p>)}
    {outputRemoval.toolbar}{results.map(artifact=><div key={artifact.id}><ConvertedAttachment artifact={artifact} />{outputRemoval.controls(artifact, `converted image ${artifact.name}`)}</div>)}
  </section>;
}
