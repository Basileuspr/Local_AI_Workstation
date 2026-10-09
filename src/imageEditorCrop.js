// Normalized edges refer to the current edited image, after earlier stages.
export function cropPixelRect(box, width, height) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)
    || box[0] >= box[2] || box[1] >= box[3]) return null;
  const edge = (value, size) => Math.max(0, Math.min(size, Math.round(value * size)));
  const x = edge(box[0], width), y = edge(box[1], height);
  const right = edge(box[2], width), bottom = edge(box[3], height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function editorOutputSize(width, height, recipe) {
  for (const pass of [...(recipe?.stages || []), recipe || {}]) {
    if (Math.abs(Math.round((pass.rotation || 0) / 90)) % 2) [width, height] = [height, width];
    if (pass.crop) {
      const rect = cropPixelRect(pass.crop, width, height);
      if (rect) ({ width, height } = rect);
    }
  }
  return { width, height };
}
