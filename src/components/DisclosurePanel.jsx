import { useId, useRef, useState } from "react";
import { useDismissiblePopup } from '../useDismissiblePopup';
import "./DisclosurePanel.css";

// A non-modal panel: primary controls remain usable, with outside-click and
// Escape dismissal. Children stay mounted so drafts and expanded sections survive.
export default function DisclosurePanel({ label, title, children, className = "", indicator }) {
  const [open, setOpen] = useState(false);
  const id = useId(), wrapper = useRef(null), trigger = useRef(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useDismissiblePopup({ open, container: wrapper, onDismiss: () => setOpen(false), returnFocus: trigger });
  return <div className={`disclosure-control ${className}`} ref={wrapper}>
    <button ref={trigger} type="button" className="disclosure-trigger" aria-label={label} title={title || label}
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      {label}{indicator && <span className="disclosure-indicator" aria-hidden="true">{indicator}</span>} <span aria-hidden="true">⌄</span>
    </button>
    <section id={id} className="disclosure-panel" aria-label={label} hidden={!open}>
      {typeof children === "function" ? children(close) : children}
    </section>
  </div>;
}
