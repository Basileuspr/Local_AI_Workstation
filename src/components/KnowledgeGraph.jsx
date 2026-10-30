import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DEFAULT_ORBIT, fitKnowledgeConstellation, fitKnowledgeGraph3D, knowledgeGraphSpace, layoutKnowledgeGraph3D, layoutKnowledgeLabels, moveKnowledgeNode, orbitKnowledgeGraph, projectGraphPoint, projectGraphSegment, rotateGraphPoint, zoomKnowledgeGraph } from "../knowledgeGraph3D";
import { NODE_ICONS, nodeLabel, nodeMatches, nodeOptions, nodePolygon, nodeRadius } from "../knowledgeNodeOptions";
import KnowledgeGraphControls from "./KnowledgeGraphControls";

export default function KnowledgeGraph({ nodes, edges, selectedId, onSelect, onPosition, query = "", expanded = false, onExpand }) {
  const initial = useMemo(() => layoutKnowledgeGraph3D(nodes, edges), [nodes, edges]);
  const [positions, setPositions] = useState(initial);
  const [camera, setCamera] = useState(() => fitKnowledgeConstellation(initial));
  const [viewportScale, setViewportScale] = useState(1);
  const [showGuides, setShowGuides] = useState(false), [mode, setMode] = useState("orbit"), [labelMode, setLabelMode] = useState("auto");
  const [hoveredId, setHoveredId] = useState("");
  const helpId = useId();
  const space = useMemo(() => knowledgeGraphSpace(positions), [positions]);
  const svg = useRef(null), drag = useRef(null), fitted = useRef(false);
  const cameraRef = useRef(camera), animation = useRef(0);
  cameraRef.current = camera;
  useEffect(() => () => cancelAnimationFrame(animation.current), []);
  useEffect(() => {
    setPositions(initial);
    if (!fitted.current && nodes.length) { setCamera(fitKnowledgeConstellation(initial)); fitted.current = true; }
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
  const inView = ordered.filter(node => {
    const point = projected[node.doc_id];
    return point.x >= 20 && point.x <= 1180 && point.y >= 20 && point.y <= 780;
  }).length;
  const matching = query.trim() ? nodes.filter(node => nodeMatches(node, query)).length : null;
  const dense = nodes.length > 24, minimumRadius = dense ? 9 : 15;
  const degree = new Map(nodes.map(node => [node.doc_id, 0]));
  edges.forEach(edge => { degree.set(edge.source, (degree.get(edge.source) || 0) + 1); degree.set(edge.target, (degree.get(edge.target) || 0) + 1); });
  const overviewLabels = new Set([...nodes].sort((a, b) => degree.get(b.doc_id) - degree.get(a.doc_id) || a.doc_id.localeCompare(b.doc_id)).slice(0, 6).map(node => node.doc_id));
  const showLabel = node => nodeOptions(node).label_mode !== "hidden" && (labelMode === "all" || node.doc_id === selectedId || node.doc_id === hoveredId
    || (matching !== null ? nodeMatches(node, query) : labelMode === "auto" && (nodes.length <= 12 || connected.has(node.doc_id) || overviewLabels.has(node.doc_id))));
  const labels = layoutKnowledgeLabels(ordered.flatMap(node => {
    const options = nodeOptions(node), screen = projected[node.doc_id], label = nodeLabel(node);
    if (screen.x < 0 || screen.x > 1200 || screen.y < 0 || screen.y > 800) return [];
    const text = options.label_mode === "short" && label.length > 30 ? `${label.slice(0, 27)}…` : label;
    const fontSize = options.font_size * Math.max(screen.scale, 1 / viewportScale);
    const textUnits = Array.from(text).reduce((width, char) => width + (char.codePointAt(0) > 255 ? 1 : .66), 0);
    return [{ id: node.doc_id, hidden: !showLabel(node), x: screen.x, y: screen.y, radius: Math.max(nodeRadius(node) * screen.scale, minimumRadius / viewportScale) + 4 / viewportScale,
      width: textUnits * fontSize + 10 / viewportScale, height: fontSize * 1.7,
      priority: selectedId === node.doc_id ? 2 : matching !== null && nodeMatches(node, query) ? 1 : 0 }];
  }), 5 / viewportScale);

  function point(event) {
    const value = svg.current.createSVGPoint(); value.x = event.clientX; value.y = event.clientY;
    return value.matrixTransform(svg.current.getScreenCTM().inverse());
  }
  function moveCamera(next, smooth = true) {
    cancelAnimationFrame(animation.current);
    const from = cameraRef.current;
    if (!smooth || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setCamera(next); return; }
    const started = performance.now(), yawDelta = Math.atan2(Math.sin(next.yaw - from.yaw), Math.cos(next.yaw - from.yaw));
    const frame = now => {
      const progress = Math.min(1, (now - started) / 260), t = 1 - (1 - progress) ** 3;
      if (progress === 1) { setCamera(next); animation.current = 0; return; }
      const blend = (a, b) => a + (b - a) * t;
      setCamera({ ...next, yaw: from.yaw + yawDelta * t, pitch: blend(from.pitch, next.pitch), distance: blend(from.distance, next.distance),
        panX: blend(from.panX, next.panX), panY: blend(from.panY, next.panY), target: Object.fromEntries(["x", "y", "z"].map(axis => [axis, blend(from.target[axis], next.target[axis])])) });
      animation.current = requestAnimationFrame(frame);
    };
    animation.current = requestAnimationFrame(frame);
  }
  function fitView(orbit = cameraRef.current) { moveCamera((showGuides ? fitKnowledgeGraph3D : fitKnowledgeConstellation)(positions, orbit)); }
  function focusNode(id = selectedId) { if (positions[id]) moveCamera({ ...cameraRef.current, target: positions[id], distance: 620, panX: 0, panY: 0 }); }
  function zoomBy(factor) { cancelAnimationFrame(animation.current); setCamera(current => zoomKnowledgeGraph(current, factor)); }
  function rotateBy(dx, dy) { moveCamera(orbitKnowledgeGraph(cameraRef.current, dx, dy)); }
  useEffect(() => {
    const element = svg.current;
    const wheel = event => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12); };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  function start(event) {
    if (drag.current || ![0, 2].includes(event.button)) return;
    cancelAnimationFrame(animation.current);
    event.preventDefault();
    const id = event.button === 0 ? event.target.closest("[data-node-id]")?.dataset.nodeId : null;
    (id ? event.target.closest("[data-node-id]") : svg.current)?.focus({ preventScroll: true });
    const node = nodes.find(item => item.doc_id === id);
    drag.current = { id, pointerId: event.pointerId, start: point(event), camera, origin: id ? positions[id] : null,
      locked: node && nodeOptions(node).locked, mode: id ? (event.altKey ? "depth" : "node") : (event.shiftKey || event.button === 2 ? "pan" : mode), moved: false };
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
    else setCamera(orbitKnowledgeGraph(action.camera, dx * viewportScale, dy * viewportScale));
  }
  function finish(event) {
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!action?.id || !action.moved || !action.position) return;
    if (event.type === "pointercancel" || event.type === "lostpointercapture") setPositions(previous => ({ ...previous, [action.id]: action.origin }));
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
      event.preventDefault(); if (event.key === "0") fitView(DEFAULT_ORBIT); else zoomBy(event.key === "-" ? .8 : 1.25);
    }
  }
  const guide = (source, target, key, className) => {
    const segment = projectGraphSegment(source, target, camera);
    if (!segment) return null;
    const [a, b] = segment;
    return <line key={key} className={className} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
  };
  const orbitGuides = showGuides ? [1, .65, .3].map(factor => Array.from({ length: 65 }, (_, index) => {
    const angle = index / 64 * Math.PI * 2;
    return { x: space.center.x + (space.max.x - space.min.x) / 2 * factor * Math.cos(angle), y: space.max.y,
      z: space.center.z + (space.max.z - space.min.z) / 2 * factor * Math.sin(angle) };
  })) : [];

  return <div className="vault-graph vault-graph-3d" data-navigation={mode} data-density={dense ? "dense" : "normal"}>
    <KnowledgeGraphControls inView={inView} count={nodes.length} edgeCount={edges.length} matching={matching} mode={mode} onMode={setMode}
      onZoom={zoomBy} onFit={() => fitView()} onReset={() => fitView(DEFAULT_ORBIT)} onFocus={() => focusNode()} selected={selected}
      showGuides={showGuides} onGuides={() => setShowGuides(current => !current)} labels={labelMode} onLabels={setLabelMode}
      onView={view => fitView(view === "Top" ? { yaw: 0, pitch: Math.PI / 2 } : view === "Front" ? { yaw: 0, pitch: 0 } : DEFAULT_ORBIT)}
      onRotate={rotateBy} onDepth={dy => moveNode(selectedId, 0, dy, true)} locked={selected && nodeOptions(selected).locked} expanded={expanded} onExpand={onExpand} />
    <div className="vault-graph-stage">
    <svg ref={svg} viewBox="0 0 1200 800" tabIndex={0} role="group" aria-label="Knowledge document graph" aria-roledescription="Rotatable 3D graph"
      aria-describedby={helpId}
      data-yaw={camera.yaw} data-pitch={camera.pitch} data-distance={camera.distance}
      onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish} onDragStart={event => event.preventDefault()} onContextMenu={event => event.preventDefault()} onKeyDown={cameraKey}>
      {showGuides && <g aria-hidden="true" pointerEvents="none" className="vault-space-guides">
        {orbitGuides.flatMap((ring, ringIndex) => ring.slice(1).map((point, index) => guide(ring[index], point, `orbit${ringIndex}-${index}`, "vault-space-orbit")))}
        {ordered.filter(node => node.doc_id === selectedId || node.doc_id === hoveredId).map(node => {
          const position = positions[node.doc_id], foot = { ...position, y: space.max.y }, screen = projectGraphPoint(foot, camera);
          return <g key={node.doc_id} className={`vault-space-anchor${selectedId === node.doc_id ? " selected" : ""}`}>
            {guide(position, foot, node.doc_id, "vault-space-stem")}
            {screen.visible && <circle cx={screen.x} cy={screen.y} r={4 / viewportScale} />}
          </g>;
        })}
      </g>}
      <g>
        {edges.map(edge => {
          if (!positions[edge.source] || !positions[edge.target]) return null;
          const segment = projectGraphSegment(positions[edge.source], positions[edge.target], camera);
          if (!segment) return null;
          const [source, target] = segment;
          const active = [selectedId, hoveredId].some(id => id && (edge.source === id || edge.target === id));
          return <g key={`${edge.source}-${edge.target}`} className={`vault-edge${active ? " selected" : selectedId ? " muted" : ""}`}>
            <line className="vault-edge-underlay" x1={source.x} y1={source.y} x2={target.x} y2={target.y} aria-hidden="true" />
            <line data-graph-edge={`${edge.source}-${edge.target}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
              className={edge.kinds.includes("manual") ? "manual" : "wikilink"}><title>{edge.kinds.join(" + ")}</title></line>
          </g>;
        })}
        {ordered.map(node => {
          const position = positions[node.doc_id], screen = projected[node.doc_id];
          const dim = query.trim() ? !nodeMatches(node, query) : selectedId && !connected.has(node.doc_id);
          const options = nodeOptions(node), label = nodeLabel(node);
          const radius = Math.max(nodeRadius(node), minimumRadius / (screen.scale * viewportScale));
          const iconSize = Math.max(dense ? 10 : 12, nodeRadius(node) * (dense ? .7 : 1)) / Math.min(1, screen.scale * viewportScale);
          const labelSize = options.font_size / Math.min(1, screen.scale * viewportScale);
          const shapeStyle = { fill: options.color, stroke: options.color, strokeDasharray: options.border === "dashed" ? "5 3" : undefined, strokeWidth: options.border === "none" ? 0 : 1.4 };
          const labelBox = labels[node.doc_id];
          const lx = labelBox ? (labelBox.x - screen.x) / screen.scale : 0, ly = labelBox ? (labelBox.y - screen.y) / screen.scale : radius + labelSize * 1.5;
          return <g key={node.doc_id} data-node-id={node.doc_id} data-locked={options.locked} data-world-x={position.x} data-world-y={position.y} data-world-z={position.z} data-depth={screen.z}
            role="button" tabIndex={0} aria-label={`Open ${label}${options.locked ? " (position locked)" : ""}`} aria-pressed={selectedId === node.doc_id}
            className={`vault-node${selectedId === node.doc_id ? " selected" : ""}${dim ? " muted" : ""}${hoveredId === node.doc_id ? " hovered" : ""}`} style={{ "--node-color": options.color }} transform={`translate(${screen.x} ${screen.y}) scale(${screen.scale})`}
            onPointerEnter={() => setHoveredId(node.doc_id)} onPointerLeave={() => setHoveredId("")} onFocus={() => setHoveredId(node.doc_id)} onBlur={() => setHoveredId("")}
            onDoubleClick={() => focusNode(node.doc_id)} onKeyDown={event => nodeKey(event, node.doc_id)}>
            <title>{`${label} · ${node.filename} · ${node.chunks} indexed chunks${options.tags.length ? ` · ${options.tags.join(", ")}` : ""}${options.locked ? " · Position locked" : ""}${options.note ? `\n${options.note}` : ""}`}</title>
            {labelBox && <line className="vault-label-leader" x1={0} y1={0} x2={lx} y2={ly} aria-hidden="true" />}
            <circle className="vault-node-aura" r={radius + 12 / (screen.scale * viewportScale)} aria-hidden="true" />
            <circle className="vault-node-halo" r={radius + 4 / (screen.scale * viewportScale)} aria-hidden="true" />
            {options.shape === "circle" ? <circle className="vault-node-shape" r={radius} style={shapeStyle} /> : options.shape === "square" ? <rect className="vault-node-shape" x={-radius * .8} y={-radius * .8} width={radius * 1.6} height={radius * 1.6} rx={4} style={shapeStyle} /> : <polygon className="vault-node-shape" points={nodePolygon(options.shape, radius)} style={shapeStyle} />}
            {options.icon !== "none" && <text className="vault-node-icon" textAnchor="middle" dominantBaseline="central" style={{ fontSize: iconSize }} aria-hidden="true">{NODE_ICONS[options.icon]}</text>}
            {showLabel(node) && <g className="vault-node-label" transform={`translate(${lx} ${ly})`}>
              {labelBox && <rect x={-labelBox.width / screen.scale / 2} y={-labelBox.height / screen.scale / 2} width={labelBox.width / screen.scale} height={labelBox.height / screen.scale} rx={4 / (screen.scale * viewportScale)} />}
              <text textAnchor="middle" dominantBaseline="central" style={{ fontSize: labelSize }}>{options.label_mode === "short" && label.length > 30 ? `${label.slice(0, 27)}…` : label}</text>
            </g>}
          </g>;
        })}
      </g>
    </svg>
    <svg className="vault-orientation" viewBox="-65 -65 130 130" role="img" aria-label="Camera orientation: X, Y and Z axes" pointerEvents="none">
        {[["X", "#ed9393", { x: 38, y: 0, z: 0 }], ["Y", "#8ac77c", { x: 0, y: -38, z: 0 }], ["Z", "#6d9cbc", { x: 0, y: 0, z: 38 }]].map(([label, color, direction]) => {
          const axis = rotateGraphPoint(direction, { ...camera, target: { x: 0, y: 0, z: 0 } });
          return <g key={label}><line x1={0} y1={0} x2={axis.x} y2={axis.y} style={{ stroke: color }} /><text x={axis.x * 1.3} y={axis.y * 1.3} fill={color} textAnchor="middle">{label}</text></g>;
        })}
    </svg>
    {!nodes.length && <div className="vault-empty"><h2>Your knowledge, connected</h2><p>Add documents to start your vault. Each document becomes a node in 3D space.</p></div>}
    </div>
    <div className="vault-graph-footer">
      <div className="vault-legend"><span><i className="vault-legend-manual" />Manual link</span><span><i className="vault-legend-wikilink" />Document link</span>{showGuides && <span><i className="vault-legend-depth" />Height above floor</span>}</div>
      <p id={helpId}>Drag to {mode === "pan" ? "pan" : "orbit"} · Scroll to zoom · Double-click to focus<span className="vault-graph-keyboard-help">. Shift or right-drag pans. With the graph focused, arrow keys rotate, plus and minus zoom, and 0 resets the view. With a node focused, Enter selects, arrows move it, and Page Up or Page Down changes its depth.</span></p>
    </div>
  </div>;
}
