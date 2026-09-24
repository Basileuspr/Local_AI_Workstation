import { useEffect, useMemo, useRef, useState } from "react";
import { fitKnowledgeGraph, layoutKnowledgeGraph } from "../knowledgeGraph";

export default function KnowledgeGraph({ nodes, edges, selectedId, onSelect, onPosition, query = "" }) {
  const initial = useMemo(() => layoutKnowledgeGraph(nodes, edges), [nodes, edges]);
  const [positions, setPositions] = useState(initial);
  const [camera, setCamera] = useState(() => fitKnowledgeGraph(initial));
  const svg = useRef(null), drag = useRef(null), fitted = useRef(false);
  useEffect(() => {
    setPositions(initial);
    if (!fitted.current && nodes.length) { setCamera(fitKnowledgeGraph(initial)); fitted.current = true; }
  }, [initial, nodes.length]);
  const connected = new Set([selectedId]);
  edges.forEach(edge => { if (edge.source === selectedId) connected.add(edge.target); if (edge.target === selectedId) connected.add(edge.source); });
  function point(event) {
    const value = svg.current.createSVGPoint(); value.x = event.clientX; value.y = event.clientY;
    return value.matrixTransform(svg.current.getScreenCTM().inverse());
  }
  function zoomBy(factor) {
    setCamera(current => {
      const zoom = Math.min(5, Math.max(.05, current.zoom * factor));
      return { x: 600 - (600 - current.x) * zoom / current.zoom, y: 400 - (400 - current.y) * zoom / current.zoom, zoom };
    });
  }
  useEffect(() => {
    const element = svg.current;
    const wheel = event => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12); };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  function start(event) {
    if (event.button !== 0) return;
    const id = event.target.closest("[data-node-id]")?.dataset.nodeId;
    drag.current = { id, start: point(event), camera, origin: id ? positions[id] : null, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (id) onSelect(id);
  }
  function move(event) {
    const action = drag.current;
    if (!action) return;
    const current = point(event), dx = current.x - action.start.x, dy = current.y - action.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) action.moved = true;
    if (action.id) {
      action.position = { x: Math.max(-100000, Math.min(100000, action.origin.x + dx / action.camera.zoom)), y: Math.max(-100000, Math.min(100000, action.origin.y + dy / action.camera.zoom)) };
      setPositions(previous => ({ ...previous, [action.id]: action.position }));
    } else setCamera({ ...action.camera, x: action.camera.x + dx, y: action.camera.y + dy });
  }
  function finish(event) {
    const action = drag.current; drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (action?.id && action.moved && action.position) onPosition(action.id, action.position);
  }
  return <div className="vault-graph">
    <div className="vault-graph-tools"><button onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button><button onClick={() => zoomBy(.8)} aria-label="Zoom out">−</button><button onClick={() => setCamera(fitKnowledgeGraph(positions))}>Fit graph</button></div>
    <svg ref={svg} viewBox="0 0 1200 800" aria-label="Knowledge document graph" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
        {edges.map(edge => {
          const source = positions[edge.source], target = positions[edge.target];
          if (!source || !target) return null;
          return <line key={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
            className={`${edge.kinds.includes("manual") ? "manual" : "wikilink"}${selectedId && edge.source !== selectedId && edge.target !== selectedId ? " muted" : ""}`}><title>{edge.kinds.join(" + ")}</title></line>;
        })}
        {nodes.map(node => {
          const position = positions[node.doc_id]; if (!position) return null;
          const dim = query ? !node.filename.toLowerCase().includes(query.toLowerCase()) : selectedId && !connected.has(node.doc_id);
          return <g key={node.doc_id} data-node-id={node.doc_id} role="button" tabIndex={0} aria-label={`Open ${node.filename}`} aria-pressed={selectedId === node.doc_id}
            className={`vault-node${selectedId === node.doc_id ? " selected" : ""}${dim ? " muted" : ""}`} transform={`translate(${position.x} ${position.y})`}
            onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect(node.doc_id); } }}>
            <title>{`${node.filename} · ${node.chunks} indexed chunks`}</title><circle r={12 + Math.min(12, Math.sqrt(node.chunks || 1))} />
            <text y="38" textAnchor="middle">{node.filename.length > 30 ? `${node.filename.slice(0, 27)}…` : node.filename}</text>
          </g>;
        })}
      </g>
    </svg>
    {!nodes.length && <div className="vault-empty"><h2>Your knowledge, connected</h2><p>Add documents to start your vault. Each document becomes a node.</p></div>}
    <div className="vault-legend"><span>● Manual link</span><span>┄ [[Document link]]</span><small>Drag nodes to arrange · drag the background to pan · scroll to zoom</small></div>
  </div>;
}
