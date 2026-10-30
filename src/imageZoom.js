export function fitScale(width, height, box, rotation = 0) {
  if (!width || !height || !box.width || !box.height) return 1;
  return Math.min(1, box.width / (rotation % 180 ? height : width), box.height / (rotation % 180 ? width : height));
}

export function clampPan(pan, width, height, box, scale, rotation = 0) {
  const x = Math.max(0, ((rotation % 180 ? height : width) * scale - box.width) / 2);
  const y = Math.max(0, ((rotation % 180 ? width : height) * scale - box.height) / 2);
  return { x: Math.max(-x, Math.min(x, pan.x)) || 0, y: Math.max(-y, Math.min(y, pan.y)) || 0 };
}

export function zoomAt(pan, before, after, point = { x: 0, y: 0 }) {
  const ratio = after / before;
  return { x: point.x - (point.x - pan.x) * ratio, y: point.y - (point.y - pan.y) * ratio };
}
