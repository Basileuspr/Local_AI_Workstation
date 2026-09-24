import { useState } from "react";
import ImageItemActions from "./ImageItemActions";
import ImageViewer from "./ImageViewer";

export default function MediaCardActions({ image }) {
  const [open, setOpen] = useState(false);
  return <><div className="image-item-actions"><button onClick={() => setOpen(true)}>Enlarge image</button></div><ImageItemActions image={image} />
    {open && <ImageViewer images={[image]} selectedId={image.id} onSelect={() => {}} onClose={() => setOpen(false)} />}</>;
}
