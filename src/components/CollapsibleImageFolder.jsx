import { useId, useState } from "react";

export default function CollapsibleImageFolder({ name, children }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <section className="collapsible-image-folder" aria-label={`${name} folder`}>
    <button type="button" className="folder-disclosure" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? "▾ Hide" : "▸ Show"} {name}</button>
    <div id={id}>{expanded && children}</div>
  </section>;
}
