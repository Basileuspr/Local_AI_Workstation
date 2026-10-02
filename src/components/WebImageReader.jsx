import { useState } from "react";
import ProtectedImage from "../ImagePrivacy";
import "./WebImageReader.css";
import {useImageRemoval} from './ImageRemovalControls';
import ImageThumbnail from "./ImageThumbnail";

export default function WebImageReader({ images, sourceFor }) {
  const [open, setOpen] = useState(false);
  const [removed,setRemoved]=useState([]);
  const visible=(images || []).map((image,index)=>({...image,selectionId:image.id || `${sourceFor(image)}:${index}`})).filter(image=>!removed.includes(image.selectionId));
  const removal=useImageRemoval(visible, items=>setRemoved(current=>[...current,...items.map(item=>item.selectionId)]),{label:'page images',key:image=>image.selectionId});
  if (!images?.length) return null;
  return <div className="web-image-source"><div className="web-image-thumbnails" aria-label="Saved page image previews">{visible.map((image, index) => <figure key={image.selectionId}><ImageThumbnail src={sourceFor(image)} alt={image.name || `Page image ${index + 1}`} /><figcaption>{index + 1}. {image.name || "Page image"}</figcaption></figure>)}</div><details className="web-image-reader" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Read {visible.length} saved images in page order</summary>
    {open && <>{removal.toolbar}{removed.length>0 && <button type="button" onClick={()=>setRemoved([])}>Restore removed images</button>}<div className="web-image-pages">{visible.map((image, index) => <figure key={image.selectionId}>
      <figcaption>{index + 1}. {image.name || "Page image"}</figcaption>
      {removal.controls(image, image.name || `page image ${index + 1}`)}
      <ProtectedImage src={sourceFor(image)} alt={image.name || `Page image ${index + 1}`} loading="lazy"
        width={image.width || undefined} height={image.height || undefined} />
    </figure>)}</div></>}
  </details></div>;
}
