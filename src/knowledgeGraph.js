// Deterministic clusters give unpositioned documents a stable starting layout.
export function layoutKnowledgeGraph(nodes, edges) {
  const neighbors = new Map(nodes.map(node => [node.doc_id, []]));
  for (const edge of edges) {
    neighbors.get(edge.source)?.push(edge.target);
    neighbors.get(edge.target)?.push(edge.source);
  }
  const visited = new Set(), groups = [];
  for (const node of nodes) {
    if (visited.has(node.doc_id)) continue;
    const group = [], queue = [node.doc_id];
    visited.add(node.doc_id);
    for (let index = 0; index < queue.length; index++) {
      const id = queue[index]; group.push(id);
      for (const next of neighbors.get(id) || []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
    groups.push(group);
  }
  const positions = {};
  const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
  groups.forEach((group, index) => {
    const center = { x: (index % columns) * 420, y: Math.floor(index / columns) * 360 };
    group.forEach((id, item) => {
      const angle = item * 2.39996323;
      const radius = group.length === 1 ? 0 : 55 * Math.sqrt(item + 1);
      positions[id] = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    });
  });
  for (const node of nodes) if (node.position && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)) positions[node.doc_id] = node.position;
  return positions;
}

export function fitKnowledgeGraph(positions) {
  const points = Object.values(positions);
  if (!points.length) return { x: 600, y: 400, zoom: 1 };
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const zoom = Math.min(1.6, 1000 / (maxX - minX + 180), 600 / (maxY - minY + 160));
  return { x: 600 - (minX + maxX) / 2 * zoom, y: 400 - (minY + maxY) / 2 * zoom, zoom };
}
