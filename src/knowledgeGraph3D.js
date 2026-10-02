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

export function fitKnowledgeGraph3D(positions, orbit = DEFAULT_ORBIT) {
  const points = Object.values(positions);
  if (!points.length) return { ...orbit, target: { x: 0, y: 0, z: 0 }, distance: 900, panX: 0, panY: 0 };
  const bounds = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  for (const point of points) for (const axis of ["x", "y", "z"]) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]); bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
  const target = Object.fromEntries(["x", "y", "z"].map(axis => [axis, (bounds.min[axis] + bounds.max[axis]) / 2]));
  let radius = 0;
  for (const point of points) radius = Math.max(radius, Math.hypot(point.x - target.x, point.y - target.y, point.z - target.z));
  return { ...orbit, target, distance: Math.max(380, radius * 3.2 + 120), panX: 0, panY: 0 };
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
