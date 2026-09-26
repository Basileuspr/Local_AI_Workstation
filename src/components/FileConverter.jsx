import { useRef, useState } from "react";
import { apiUrl } from "../api";
import "./Tools.css";

export function ConvertedAttachment({ artifact }) {
  return <div className="document-attachment"><strong>{artifact.name}</strong><span>{artifact.width} × {artifact.height} · {Math.ceil(artifact.size / 1024)} KB</span><a href={apiUrl(`/workspaces/converted/${artifact.id}`)} download={artifact.name}>Download image</a></div>;
}

export default function FileConverter() {
  const input = useRef(null), [files, setFiles] = useState([]), [target, setTarget] = useState("png");
  const [results, setResults] = useState([]), [busy, setBusy] = useState(false), [progress, setProgress] = useState(""), [errors, setErrors] = useState([]);
  async function convert() {
    setBusy(true); setResults([]); setErrors([]);
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`Converting ${index + 1} of ${files.length}: ${file.name}`);
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error("Image exceeds 20 MB.");
          const body = new FormData(); body.append("file", file); body.append("target", target);
          const response = await fetch(apiUrl("/workspaces/convert"), { method: "POST", body });
          const result = await response.json(); if (!response.ok) throw new Error(result.detail || "Conversion failed.");
          setResults(current => [...current, result]);
        } catch (error) { setErrors(current => [...current, `${file.name}: ${error.message}`]); }
      }
    } finally { setBusy(false); setProgress("Finished."); }
  }
  return <section className="tools-workspace" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)setFiles(Array.from(e.dataTransfer.files));}}>
    <header className="tools-heading"><h1>File Converter</h1><p>Drop images or choose files. Originals are preserved.</p></header>
    <div className="tools-toolbar"><button disabled={busy} onClick={()=>input.current.click()}>Choose images</button><input ref={input} hidden multiple type="file" accept="image/*" onChange={e=>{setFiles(Array.from(e.target.files));e.target.value="";}} />
      <label>Convert to <select disabled={busy} value={target} onChange={e=>setTarget(e.target.value)}>{["png","jpg","webp","bmp","tiff"].map(format=><option key={format} value={format}>{format.toUpperCase()}</option>)}</select></label>
      <button disabled={busy||!files.length} onClick={convert}>Convert {files.length || ""} file{files.length===1?"":"s"}</button>
    </div>
    <p className="tools-note">Still images up to 20 MB and 24 megapixels. JPG and BMP use a white background for transparency. Chat can also convert an attached image: “Convert this to PNG.”</p>
    <ul>{files.map((file,i)=><li key={i}>{file.name}</li>)}</ul><p role="status">{progress}</p>
    {errors.map((error,i)=><p role="alert" key={i}>{error}</p>)}
    {results.map(artifact=><ConvertedAttachment key={artifact.id} artifact={artifact} />)}
  </section>;
}
