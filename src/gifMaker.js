export const MAX_GIF_FRAMES = 60;
export function validateGifFrames(files) {
  if (files.length > MAX_GIF_FRAMES) throw new Error("A GIF can contain up to 60 frames.");
  if (files.some(file => !/^image\/(png|jpeg|webp)$/.test(file.type))) throw new Error("Choose still PNG, JPEG, or WebP images.");
  if (files.some(file => !file.size || file.size > 40 * 1024 ** 2)) throw new Error("Each image must be between 1 byte and 40 MiB.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 160 * 1024 ** 2) throw new Error("Use at most 160 MiB of images.");
}
export function moveGifFrame(frames, index, direction) {
  const target = index + direction;
  if (index < 0 || index >= frames.length || target < 0 || target >= frames.length) return frames;
  const next = [...frames];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
export function gifFilename(name) {
  return (String(name || "Animation").replace(/\.gif$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100).replace(/[. ]+$/g, "") || "Animation") + ".gif";
}

export function gifThumbnailLayout(sourceWidth, sourceHeight, width, height, fit = 'cover', maxSide = 320) {
  if (![sourceWidth, sourceHeight, width, height].every(value => Number.isFinite(Number(value)) && Number(value) > 0)) throw new Error('Choose valid frame dimensions first.');
  if (!Number.isInteger(maxSide) || maxSide < 64 || maxSide > 1024) throw new Error('Choose a thumbnail size from 64 to 1024 pixels.');
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const outputWidth = Math.max(1, Math.round(width * scale)), outputHeight = Math.max(1, Math.round(height * scale));
  const fitScale = (fit === 'cover' ? Math.max : Math.min)(outputWidth / sourceWidth, outputHeight / sourceHeight);
  const drawWidth = sourceWidth * fitScale, drawHeight = sourceHeight * fitScale;
  return {width:outputWidth, height:outputHeight, x:(outputWidth-drawWidth)/2, y:(outputHeight-drawHeight)/2, drawWidth, drawHeight};
}

export async function renderGifThumbnail(file, {width, height, fit, background, mode = 'framed', maxSide = 320}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, {imageOrientation:'from-image'});
    if (bitmap.width * bitmap.height > 24_000_000) throw new Error('Use a source image up to 24 megapixels.');
    const layout = gifThumbnailLayout(bitmap.width, bitmap.height, mode === 'original' ? bitmap.width : width, mode === 'original' ? bitmap.height : height, mode === 'original' ? 'contain' : fit, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = layout.width; canvas.height = layout.height;
    const context = canvas.getContext('2d');
    context.fillStyle = background; context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, layout.x, layout.y, layout.drawWidth, layout.drawHeight);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not capture this thumbnail.');
    return {blob, width:layout.width, height:layout.height, sourceWidth:bitmap.width, sourceHeight:bitmap.height};
  } catch (failure) {
    throw new Error(failure.message?.includes('megapixels') || failure.message?.includes('dimensions') ? failure.message : `Could not build a thumbnail for ${file.name || 'this image'}. Retry or replace the file.`);
  } finally { bitmap?.close(); }
}

export async function createGifThumbnail(file, settings) {
  return (await renderGifThumbnail(file, settings)).blob;
}

export function gifThumbnailFilename(name, index = null) {
  const stem = gifFilename(String(name || 'Image').replace(/\.[^.]+$/, '')).replace(/\.gif$/i, '');
  return `${index === null ? '' : `${String(index + 1).padStart(3,'0')}-`}${stem}-thumbnail.png`;
}
