import { useEffect, useId, useRef, useState } from "react";

export function GraphIcon({ name }) {
  const paths = {
    orbit: <><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-35 12 12)" /><circle cx="12" cy="12" r="3" /></>,
    pan: <><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>,
    fit: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" /><circle cx="12" cy="12" r="3" /></>,
    focus: <><circle cx="12" cy="12" r="7" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></>,
    plus: <path d="M5 12h14M12 5v14" />,
    minus: <path d="M5 12h14" />,
    view: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
    expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6" />,
  };
  return <svg className="vault-graph-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export default function KnowledgeGraphControls({ inView, count, edgeCount, matching, mode, onMode, onZoom, onFit, onReset, onFocus, selected,
  showGuides, onGuides, labels, onLabels, onView, onRotate, onDepth, locked, expanded, onExpand }) {
  const panel = useRef(null), trigger = useRef(null), id = useId();
  const [open, setOpen] = useState(false);
  function place() {
    const anchor = trigger.current?.getBoundingClientRect(), menu = panel.current;
    if (!anchor || !menu) return;
    menu.style.left = `${Math.max(8, Math.min(anchor.right - 268, window.innerWidth - 276))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - menu.offsetHeight - 8))}px`;
  }
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  const close = () => { panel.current?.hidePopover(); trigger.current?.focus({ preventScroll: true }); };
  return <>
    <div className="vault-graph-heading">
      <div><span className="vault-graph-eyebrow">Your constellation</span><div className="vault-graph-overview">
        <span className="vault-visibility-count">{inView} of {count} nodes in view</span><span aria-hidden="true">·</span><span>{edgeCount} connections</span>
        {matching !== null && <span className="vault-match-count">{matching} {matching === 1 ? "match" : "matches"}</span>}
      </div></div>
      <div className="vault-graph-options">
        <button ref={trigger} aria-expanded={open} aria-controls={id} onClick={() => { if (open) close(); else { panel.current.showPopover(); place(); } }}><GraphIcon name="view" />View</button>
        {onExpand && <button aria-label={expanded ? "Restore graph panels" : "Expand graph"} aria-pressed={expanded} title={expanded ? "Restore document panels" : "Give the map more room"} onClick={onExpand}><GraphIcon name="expand" /></button>}
      </div>
    </div>
    <div ref={panel} id={id} popover="auto" className="vault-view-panel" aria-label="Graph view options" onToggle={event => setOpen(event.currentTarget.matches(":popover-open"))}>
      <div className="vault-view-title">View options<button aria-label="Close graph view options" onClick={close}>×</button></div>
      <span className="vault-view-label">Camera angle</span>
      <div className="vault-view-presets">{["Perspective", "Top", "Front"].map(view => <button key={view} onClick={() => { onView(view); close(); }}>{view}</button>)}</div>
      <label className="vault-view-label">Node labels<select aria-label="Node labels" value={labels} onChange={event => onLabels(event.target.value)}><option value="auto">Smart labels</option><option value="all">All labels</option><option value="focus">On focus</option></select></label>
      <button className="vault-guide-toggle" aria-pressed={showGuides} onClick={onGuides}>Depth guides<span>{showGuides ? "On" : "Off"}</span></button>
      <div className="vault-orbit-buttons" aria-label="Rotate camera"><button aria-label="Rotate left" onClick={() => onRotate(-35, 0)}>←</button><button aria-label="Rotate right" onClick={() => onRotate(35, 0)}>→</button><button aria-label="Rotate up" onClick={() => onRotate(0, -35)}>↑</button><button aria-label="Rotate down" onClick={() => onRotate(0, 35)}>↓</button></div>
      {selected && <div className="vault-depth-buttons"><button disabled={locked} onClick={() => onDepth(35)}>Deeper</button><button disabled={locked} onClick={() => onDepth(-35)}>Closer</button></div>}
      <button className="vault-reset-view" onClick={() => { onReset(); close(); }}>Reset view</button>
    </div>
    <div className="vault-graph-tools" aria-label="3D graph controls">
      <div className="vault-navigation-modes"><button aria-label="Orbit camera" aria-pressed={mode === "orbit"} title="Drag to orbit" onClick={() => onMode("orbit")}><GraphIcon name="orbit" /><span>Orbit</span></button><button aria-label="Pan camera" aria-pressed={mode === "pan"} title="Drag to pan" onClick={() => onMode("pan")}><GraphIcon name="pan" /><span>Pan</span></button></div>
      <div className="vault-zoom-buttons"><button onClick={() => onZoom(.8)} aria-label="Zoom out"><GraphIcon name="minus" /></button><button onClick={() => onZoom(1.25)} aria-label="Zoom in"><GraphIcon name="plus" /></button></div>
      <button onClick={onFit} aria-label="Fit graph" title="Fit all nodes while keeping the viewing angle"><GraphIcon name="fit" /><span>Fit</span></button>
      <button disabled={!selected} onClick={onFocus} aria-label="Focus node" title="Focus selected node (double-click a node)"><GraphIcon name="focus" /><span>Focus</span></button>
    </div>
    {inView < count && <button className="vault-return-map" onClick={onFit}><GraphIcon name="fit" />Show all nodes</button>}
  </>;
}
