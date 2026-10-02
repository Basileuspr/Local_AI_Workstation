import { useEffect, useMemo, useRef, useState } from "react";
import { fitKnowledgeGraph3D, layoutKnowledgeGraph3D, moveKnowledgeNode, orbitKnowledgeGraph, projectGraphPoint, rotateGraphPoint, zoomKnowledgeGraph } from "../knowledgeGraph3D";
import { NODE_ICONS, nodeLabel, nodeMatches, nodeOptions, nodePolygon, nodeRadius } from "../knowledgeNodeOptions";

export default function KnowledgeGraph({ nodes, edges, selectedId, onSelect, onPosition, query = "" }) {
  const initial = useMemo(() => layoutKnowledgeGraph3D(nodes, edges), [nodes, edges]);
  const [positions, setPositions] = useState(initial);
  const [camera, setCamera] = useState(() => fitKnowledgeGraph3D(initial));
  const [viewportScale, setViewportScale] = useState(1);
  const svg = useRef(null), drag = useRef(null), fitted = useRef(false);
  useEffect(() => {
    setPositions(initial);
    if (!fitted.current && nodes.length) { setCamera(fitKnowledgeGraph3D(initial)); fitted.current = true; }
  }, [initial, nodes.length]);
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width && height) setViewportScale(Math.min(width / 1200, height / 800));
    });
    observer.observe(svg.current); return () => observer.disconnect();
  }, []);
  const connected = new Set([selectedId]);
  edges.forEach(edge => { if (edge.source === selectedId) connected.add(edge.target); if (edge.target === selectedId) connected.add(edge.source); });
  const projected = Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, projectGraphPoint(position, camera)]));
  const ordered = nodes.filter(node => projected[node.doc_id]?.visible).sort((a, b) => projected[a.doc_id].z - projected[b.doc_id].z);
  const selected = nodes.find(node => node.doc_id === selectedId);

  function point(event) {
    const value = svg.current.createSVGPoint(); value.x = event.clientX; value.y = event.clientY;
    return value.matrixTransform(svg.current.getScreenCTM().inverse());
  }
  function zoomBy(factor) { setCamera(current => zoomKnowledgeGraph(current, factor)); }
  function rotateBy(dx, dy) { setCamera(current => orbitKnowledgeGraph(current, dx, dy)); }
  useEffect(() => {
    const element = svg.current;
    const wheel = event => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12); };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  function start(event) {
    if (drag.current || ![0, 2].includes(event.button)) return;
    event.preventDefault();
    const id = event.button === 0 ? event.target.closest("[data-node-id]")?.dataset.nodeId : null;
    (id ? event.target.closest("[data-node-id]") : svg.current)?.focus({ preventScroll: true });
    const node = nodes.find(item => item.doc_id === id);
    drag.current = { id, pointerId: event.pointerId, start: point(event), camera, origin: id ? positions[id] : null,
      locked: node && nodeOptions(node).locked, mode: id ? (event.altKey ? "depth" : "node") : (event.shiftKey || event.button === 2 ? "pan" : "orbit"), moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (id) onSelect?.(id);
  }
  function move(event) {
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId || action.locked) return;
    const current = point(event), dx = current.x - action.start.x, dy = current.y - action.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) action.moved = true;
    if (action.id) {
      action.position = moveKnowledgeNode(action.origin, action.camera, dx, dy, action.mode === "depth");
      setPositions(previous => ({ ...previous, [action.id]: action.position }));
    } else if (action.mode === "pan") setCamera({ ...action.camera, panX: action.camera.panX + dx, panY: action.camera.panY + dy });
    else setCamera(orbitKnowledgeGraph(action.camera, dx, dy));
  }
  function finish(event) {
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!action?.id || !action.moved || !action.position) return;
    if (event.type === "pointercancel") setPositions(previous => ({ ...previous, [action.id]: action.origin }));
    else onPosition?.(action.id, action.position);
  }
  function moveNode(id, dx, dy, depth = false) {
    const node = nodes.find(item => item.doc_id === id);
    if (!positions[id] || !node || nodeOptions(node).locked) return;
    const position = moveKnowledgeNode(positions[id], camera, dx, dy, depth);
    setPositions(current => ({ ...current, [id]: position })); onPosition?.(id, position);
  }
  function nodeKey(event, id) {
    if (["Enter", " "].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onSelect?.(id); return; }
    const deltas = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20], PageUp: [0, -35, true], PageDown: [0, 35, true] };
    if (deltas[event.key]) { event.preventDefault(); event.stopPropagation(); onSelect?.(id); moveNode(id, ...deltas[event.key]); }
  }
  function cameraKey(event) {
    if (event.target !== event.currentTarget) return;
    const deltas = { ArrowLeft: [-35, 0], ArrowRight: [35, 0], ArrowUp: [0, -35], ArrowDown: [0, 35] };
    if (deltas[event.key]) { event.preventDefault(); rotateBy(...deltas[event.key]); }
    else if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault(); if (event.key === "0") setCamera(fitKnowledgeGraph3D(positions)); else zoomBy(event.key === "-" ? .8 : 1.25);
    }
  }
  const guide = (source, target, key) => {
    const a = projectGraphPoint(source, camera), b = projectGraphPoint(target, camera);
    return a.visible && b.visible ? <line key={key} className="vault-space-grid" x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null;
  };
  const grid = [];
  for (let offset = -400; offset <= 400; offset += 80) {
    const { x, y, z } = camera.target;
    grid.push(guide({ x: x + offset, y: y + 160, z: z - 400 }, { x: x + offset, y: y + 160, z: z + 400 }, `x${offset}`));
    grid.push(guide({ x: x - 400, y: y + 160, z: z + offset }, { x: x + 400, y: y + 160, z: z + offset }, `z${offset}`));
  }

  return <div className="vault-graph vault-graph-3d">
    <div className="vault-graph-tools" aria-label="3D graph controls">
      <span className="vault-3d-badge">3D</span>
      <button onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button><button onClick={() => zoomBy(.8)} aria-label="Zoom out">−</button>
      <button onClick={() => setCamera(fitKnowledgeGraph3D(positions, camera))}>Fit graph</button>
      <button onClick={() => setCamera(fitKnowledgeGraph3D(positions))}>Reset view</button>
      <button disabled={!positions[selectedId]} onClick={() => setCamera(current => ({ ...current, target: positions[selectedId], distance: Math.min(current.distance, 600), panX: 0, panY: 0 }))}>Focus node</button>
      <div className="vault-orbit-buttons"><button aria-label="Rotate left" onClick={() => rotateBy(-35, 0)}>↶</button><button aria-label="Rotate right" onClick={() => rotateBy(35, 0)}>↷</button><button aria-label="Rotate up" onClick={() => rotateBy(0, -35)}>↑</button><button aria-label="Rotate down" onClick={() => rotateBy(0, 35)}>↓</button></div>
      <div className="vault-depth-buttons"><button disabled={!selected || nodeOptions(selected).locked} onClick={() => moveNode(selectedId, 0, 35, true)}>Deeper</button><button disabled={!selected || nodeOptions(selected).locked} onClick={() => moveNode(selectedId, 0, -35, true)}>Closer</button></div>
    </div>
    <svg ref={svg} viewBox="0 0 1200 800" tabIndex={0} role="group" aria-label="Knowledge document graph" aria-roledescription="Rotatable 3D graph"
      data-yaw={camera.yaw} data-pitch={camera.pitch} data-distance={camera.distance}
      onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onDragStart={event => event.preventDefault()} onContextMenu={event => event.preventDefault()} onKeyDown={cameraKey}>
      <g aria-hidden="true" pointerEvents="none">{grid}</g>
      <g>
        {edges.map(edge => {
          const source = projected[edge.source], target = projected[edge.target];
          if (!source?.visible || !target?.visible) return null;
          return <line key={`${edge.source}-${edge.target}`} data-graph-edge={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
            className={`${edge.kinds.includes("manual") ? "manual" : "wikilink"}${selectedId && edge.source !== selectedId && edge.target !== selectedId ? " muted" : ""}`}><title>{edge.kinds.join(" + ")}</title></line>;
        })}
        {ordered.map(node => {
          const position = positions[node.doc_id], screen = projected[node.doc_id];
          const dim = query ? !nodeMatches(node, query) : selectedId && !connected.has(node.doc_id);
          const options = nodeOptions(node), label = nodeLabel(node);
          const radius = Math.max(nodeRadius(node), 9 / (screen.scale * viewportScale));
          const iconSize = Math.max(12, nodeRadius(node)) / Math.min(1, screen.scale * viewportScale);
          const labelSize = options.font_size / Math.min(1, screen.scale * viewportScale);
          const shapeStyle = { fill: options.color, stroke: options.color, strokeDasharray: options.border === "dashed" ? "5 3" : undefined, strokeWidth: options.border === "none" ? 0 : 2 };
          const fade = Math.min(1, Math.max(.5, screen.scale));
          return <g key={node.doc_id} data-node-id={node.doc_id} data-locked={options.locked} data-world-x={position.x} data-world-y={position.y} data-world-z={position.z} data-depth={screen.z}
            role="button" tabIndex={0} aria-label={`Open ${label}${options.locked ? " (position locked)" : ""}`} aria-pressed={selectedId === node.doc_id}
            className={`vault-node${selectedId === node.doc_id ? " selected" : ""}${dim ? " muted" : ""}`} style={{ opacity: dim ? .28 : fade }} transform={`translate(${screen.x} ${screen.y}) scale(${screen.scale})`}
            onKeyDown={event => nodeKey(event, node.doc_id)}>
            <title>{`${label} · ${node.filename} · ${node.chunks} indexed chunks${options.tags.length ? ` · ${options.tags.join(", ")}` : ""}${options.locked ? " · Position locked" : ""}${options.note ? `\n${options.note}` : ""}`}</title>
            {options.shape === "circle" ? <circle className="vault-node-shape" r={radius} style={shapeStyle} /> : options.shape === "square" ? <rect className="vault-node-shape" x={-radius * .8} y={-radius * .8} width={radius * 1.6} height={radius * 1.6} rx={4} style={shapeStyle} /> : <polygon className="vault-node-shape" points={nodePolygon(options.shape, radius)} style={shapeStyle} />}
            {options.icon !== "none" && <text className="vault-node-icon" textAnchor="middle" dominantBaseline="central" style={{ fontSize: iconSize }} aria-hidden="true">{NODE_ICONS[options.icon]}</text>}
            {options.label_mode !== "hidden" && <text y={radius + labelSize * 1.5} textAnchor="middle" style={{ fontSize: labelSize }}>{options.label_mode === "short" && label.length > 30 ? `${label.slice(0, 27)}…` : label}</text>}
          </g>;
        })}
      </g>
      <g className="vault-orientation" aria-label="Camera orientation" transform="translate(1135 690)" pointerEvents="none">
        {[["X", "#ed9393", { x: 38, y: 0, z: 0 }], ["Y", "#8ac77c", { x: 0, y: -38, z: 0 }], ["Z", "#6d9cbc", { x: 0, y: 0, z: 38 }]].map(([label, color, direction]) => {
          const axis = rotateGraphPoint(direction, { ...camera, target: { x: 0, y: 0, z: 0 } });
          return <g key={label}><line x1={0} y1={0} x2={axis.x} y2={axis.y} style={{ stroke: color }} /><text x={axis.x * 1.3} y={axis.y * 1.3} fill={color} textAnchor="middle">{label}</text></g>;
        })}
      </g>
    </svg>
    {!nodes.length && <div className="vault-empty"><h2>Your knowledge, connected</h2><p>Add documents to start your vault. Each document becomes a node in 3D space.</p></div>}
    <div className="vault-legend"><span>● Manual link</span><span>┄ [[Document link]]</span></div>
  </div>;
}
