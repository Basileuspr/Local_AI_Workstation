import { layoutKnowledgeGraph } from "./knowledgeGraph";

const FOCAL_LENGTH = 900;
export const DEFAULT_ORBIT = { yaw: -.45, pitch: .25 };

export function layoutKnowledgeGraph3D(nodes, edges) {
  const flat = layoutKnowledgeGraph(nodes, edges);
  const positions = {};
  for (const node of nodes) {
    // Stable depth keeps refreshes and styling edits from rearranging the scene.
    let hash = 2166136261;
    for (const char of node.doc_id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const z = ((hash >>> 0) % 1024 / 1023 - .5) * 360;
    positions[node.doc_id] = { ...flat[node.doc_id], z: Number.isFinite(node.position?.z) ? node.position.z : z };
  }
  return positions;
}

export function rotateGraphPoint(point, camera) {
  const x = point.x - camera.target.x, y = point.y - camera.target.y, z = point.z - camera.target.z;
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const rx = cy * x - sy * z, rz = sy * x + cy * z;
  return { x: rx, y: cp * y - sp * rz, z: sp * y + cp * rz };
}

export function projectGraphPoint(point, camera) {
  const rotated = rotateGraphPoint(point, camera);
  const distance = camera.distance - rotated.z;
  const scale = FOCAL_LENGTH / Math.max(30, distance);
  return { x: 600 + camera.panX + rotated.x * scale, y: 400 + camera.panY + rotated.y * scale,
    z: rotated.z, scale, visible: distance > 30 };
}

// Clip guides and links at the camera plane so zooming through the room does
// not make an entire line disappear when just one endpoint is behind us.
export function projectGraphSegment(source, target, camera) {
  const a = projectGraphPoint(source, camera), b = projectGraphPoint(target, camera);
  const limit = camera.distance - 31;
  if (a.z > limit && b.z > limit) return null;
  const clip = (point, other, z, otherZ) => {
    const t = (limit - z) / (otherZ - z);
    return projectGraphPoint(Object.fromEntries(["x", "y", "z"].map(axis => [axis, point[axis] + (other[axis] - point[axis]) * t])), camera);
  };
  return [a.z > limit ? clip(source, target, a.z, b.z) : a, b.z > limit ? clip(target, source, b.z, a.z) : b];
}

export function knowledgeGraphSpace(positions) {
  const points = Object.values(positions);
  const bounds = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  for (const point of points.length ? points : [{ x: 0, y: 0, z: 0 }]) for (const axis of ["x", "y", "z"]) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]); bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
  const center = {}, minimum = { x: 360, y: 280, z: 320 };
  for (const axis of ["x", "y", "z"]) {
    center[axis] = (bounds.min[axis] + bounds.max[axis]) / 2;
    const half = Math.max(minimum[axis] / 2, (bounds.max[axis] - bounds.min[axis]) / 2 + 96);
    bounds.min[axis] = center[axis] - half; bounds.max[axis] = center[axis] + half;
  }
  const { min, max } = bounds;
  const corners = [
    { x: min.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: max.z }, { x: min.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z }, { x: max.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: max.z }, { x: min.x, y: max.y, z: max.z },
  ];
  const frame = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
    .map(([a, b]) => [corners[a], corners[b]]);
  const grid = [];
  for (let step = 1; step < 8; step++) {
    const x = min.x + (max.x - min.x) * step / 8, z = min.z + (max.z - min.z) * step / 8;
    grid.push([{ x, y: max.y, z: min.z }, { x, y: max.y, z: max.z }]);
    grid.push([{ x: min.x, y: max.y, z }, { x: max.x, y: max.y, z }]);
  }
  return { ...bounds, center, corners, frame, grid, floor: corners.slice(4) };
}

export function fitKnowledgeGraph3D(positions, orbit = DEFAULT_ORBIT) {
  const space = knowledgeGraphSpace(positions), camera = { ...orbit, target: space.center };
  // Fit the enclosing room to the usable viewport, including its depth, instead
  // of fitting only node centers and leaving the floor out of view.
  let distance = 620;
  for (const corner of space.corners) {
    const point = rotateGraphPoint(corner, camera);
    distance = Math.max(distance, point.z + Math.abs(point.x) * FOCAL_LENGTH / 460, point.z + Math.abs(point.y) * FOCAL_LENGTH / 270);
  }
  return { ...camera, distance, panX: 0, panY: 0 };
}

// Labels move in screen space only. Saved document positions are never changed
// to make room for text, and a leader ties each displaced label to its node.
export function layoutKnowledgeLabels(items, gap = 8) {
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2))
    * Math.max(0, Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2));
  const obstacles = items.map(item => ({ x: item.x, y: item.y, width: (item.radius + gap) * 2, height: (item.radius + gap) * 2 }));
  const placed = {};
  for (const item of [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.id.localeCompare(b.id))) {
    let best = null, bestScore = Infinity;
    const dx = item.radius + item.width / 2 + gap, dy = item.radius + item.height / 2 + gap;
    const candidates = [];
    for (let step = 0; step < 8; step++) {
      const offset = step * (item.height + gap);
      candidates.push([0, dy + offset], [0, -dy - offset], [-dx, offset], [dx, offset], [-dx, -dy - offset], [dx, -dy - offset]);
    }
    for (const [x, y] of candidates) {
      const box = { x: Math.max(item.width / 2 + gap, Math.min(1200 - item.width / 2 - gap, item.x + x)),
        y: Math.max(item.height / 2 + gap, Math.min(800 - item.height / 2 - gap, item.y + y)), width: item.width, height: item.height };
      const collision = obstacles.reduce((area, obstacle) => area + overlap(box, obstacle), 0);
      const score = collision * 1000 + Math.hypot(box.x - item.x, box.y - item.y);
      if (score < bestScore) { best = box; bestScore = score; }
      if (!collision) break;
    }
    placed[item.id] = best;
    obstacles.push({ ...best, width: best.width + gap, height: best.height + gap });
  }
  return placed;
}

export function orbitKnowledgeGraph(camera, dx, dy) {
  const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  return { ...camera, yaw: wrap(camera.yaw + dx * .006), pitch: wrap(camera.pitch - dy * .006) };
}

export function zoomKnowledgeGraph(camera, factor) {
  return { ...camera, distance: Math.max(40, Math.min(2000000, camera.distance / factor)) };
}

export function moveKnowledgeNode(position, camera, dx, dy, depth = false) {
  const scale = projectGraphPoint(position, camera).scale;
  const vx = depth ? 0 : dx / scale, vy = depth ? 0 : dy / scale, vz = depth ? -dy / scale : 0;
  // Inverse camera rotation: a drag follows the visible plane at any orientation.
  const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw), cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
  const y = cp * vy + sp * vz, rz = -sp * vy + cp * vz;
  const delta = { x: cy * vx + sy * rz, y, z: -sy * vx + cy * rz };
  return Object.fromEntries(["x", "y", "z"].map(axis => [axis, Math.max(-100000, Math.min(100000, position[axis] + delta[axis]))]));
}
