import { encodePaintBMP } from './paintPixels';

export function paintFileName(name, format) {
  const stem = String(name || 'Untitled').split(/[\\/]/).pop().replace(/\.(png|jpe?g|webp|bmp|lawpaint)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150) || 'Untitled';
  return `${stem}.${format === 'jpeg' ? 'jpg' : format}`;
}
export async function paintBlob(canvas, format = 'png', quality = .92) {
  if (format === 'bmp') return new Blob([encodePaintBMP(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height))], { type: 'image/bmp' });
  const type = ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' })[format];
  if (!type) throw Error('Choose PNG, JPEG, WebP or BMP.');
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, quality));
  if (!blob || blob.type !== type) throw Error(`This browser cannot export ${format.toUpperCase()}. Choose PNG instead.`);
  return blob;
}
export function downloadPaint(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function savePaintFile(blob, format, name, ticket = null) {
  name = paintFileName(name, format);
  if (blob.size > 128 * 1024 * 1024) throw Error('Canvas files must be smaller than 128 MB.');
  if (window.workstationDesktop?.savePaintFile) {
    const result = await window.workstationDesktop.savePaintFile({ bytes: new Uint8Array(await blob.arrayBuffer()), format, name, ticket });
    if (result?.error) throw Error(result.error);
    return result;
  }
  downloadPaint(blob, name); return { saved: true, name, format };
}
