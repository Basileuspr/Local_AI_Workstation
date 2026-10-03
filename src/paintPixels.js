export const PAINT_MAX_PIXELS = 16 * 1024 * 1024;
export const PAINT_MAX_LAYER_PIXELS = 64 * 1024 * 1024;
export const PAINT_MAX_LAYERS = 16;

export function paintDimensions(width, height, layers = 1) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > PAINT_MAX_PIXELS)
    throw Error('Use whole pixel dimensions from 1 to 8192, with at most 16 megapixels.');
  if (!Number.isInteger(layers) || layers < 1 || layers > PAINT_MAX_LAYERS || width * height * layers > PAINT_MAX_LAYER_PIXELS)
    throw Error('This document has reached its layer memory limit. Merge layers or use a smaller image.');
  return { width, height };
}

export function paintRect(a, b, width, height) {
  const x = Math.max(0, Math.min(width, Math.floor(Math.min(a.x, b.x))));
  const y = Math.max(0, Math.min(height, Math.floor(Math.min(a.y, b.y))));
  const right = Math.max(x, Math.min(width, Math.ceil(Math.max(a.x, b.x))));
  const bottom = Math.max(y, Math.min(height, Math.ceil(Math.max(a.y, b.y))));
  return { x, y, width: right - x, height: bottom - y };
}

export function hexRGBA(hex, opacity = 100) {
  if (!/^#[a-f0-9]{6}$/i.test(hex)) throw Error('Choose a valid color.');
  return [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16)).concat(Math.round(Math.max(0, Math.min(100, opacity)) * 2.55));
}

// Each pixel is queued once. Alpha is compared too, so transparent and white
// regions remain distinct. This works on one layer, just like the other tools.
export function floodPaint(image, x, y, replacement, tolerance = 0, mask = null) {
  const { width, height, data } = image;
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;
  const start = y * width + x, offset = start * 4, source = [...data.slice(offset, offset + 4)];
  if (source.every((n, i) => n === replacement[i]) || (mask && !mask[offset + 3])) return false;
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height);
  let read = 0, write = 1, changed = false; queue[0] = start; seen[start] = 1;
  while (read < write) {
    const index = queue[read++], p = index * 4;
    if ((mask && !mask[p + 3]) || !source.every((n, i) => Math.abs(data[p + i] - n) <= tolerance)) continue;
    data.set(replacement, p); changed = true;
    const column = index % width;
    const neighbors = [column ? index - 1 : -1, column < width - 1 ? index + 1 : -1, index >= width ? index - width : -1, index < width * (height - 1) ? index + width : -1];
    for (const next of neighbors) if (next >= 0 && !seen[next]) { seen[next] = 1; queue[write++] = next; }
  }
  return changed;
}

export function removePaintColor(image, hex) {
  const color = hexRGBA(hex);
  for (let p = 0; p < image.data.length; p += 4)
    if (color.slice(0, 3).every((n, i) => image.data[p + i] === n)) image.data[p + 3] = 0;
  return image;
}

export function encodePaintBMP(image) {
  const { width, height, data } = image, stride = Math.ceil(width * 3 / 4) * 4;
  const bytes = new Uint8Array(54 + stride * height), view = new DataView(bytes.buffer);
  bytes[0] = 66; bytes[1] = 77;
  view.setUint32(2, bytes.length, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
  view.setInt32(18, width, true); view.setInt32(22, height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true);
  view.setUint32(34, stride * height, true); view.setInt32(38, 3780, true); view.setInt32(42, 3780, true);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (y * width + x) * 4, target = 54 + (height - y - 1) * stride + x * 3, alpha = data[source + 3] / 255;
    for (let c = 0; c < 3; c++) bytes[target + c] = Math.round(data[source + 2 - c] * alpha + 255 * (1 - alpha));
  }
  return bytes;
}
