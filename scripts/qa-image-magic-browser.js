// Runs in a hidden Electron renderer, using real ImageBitmap/Canvas PNG pixels.
import { prepareMagicInput, maskBlob, combineMagicResult } from '../src/imageMagic';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function pixels(blob) {
  const image = await createImageBitmap(blob), canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0); image.close();
  return { width: canvas.width, height: canvas.height, data: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data };
}
const pixel = (image, x, y) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

export async function checkMagicGeometry() {
  for (const [width, height] of [[160, 40], [40, 160], [355, 374], [512, 512]]) {
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d');
    const colors = ['#d02b34', '#23b875', '#3259c4', '#d8b73e'];
    colors.forEach((color, i) => { context.fillStyle = color; context.fillRect((i % 2) * width / 2, Math.floor(i / 2) * height / 2, width / 2, height / 2); });
    // A translucent corner verifies alpha restoration separately from model RGB.
    context.clearRect(0, 0, 2, 2); context.fillStyle = 'rgba(30,60,90,.5)'; context.fillRect(0, 0, 2, 2);
    const source = await canvas.convertToBlob({ type: 'image/png' }), original = await pixels(source);
    const working = await prepareMagicInput(source), { layout } = working, { content } = layout;
    const prepared = await pixels(working.blob);
    assert(prepared.width === layout.width && prepared.height === layout.height, 'Working image dimensions');
    const roundtrip = await pixels(await combineMagicResult(source, working.blob, null, layout));
    assert(roundtrip.width === width && roundtrip.height === height, 'Original dimensions restored');
    for (const fx of [.25, .75]) for (const fy of [.25, .75]) {
      const x = Math.floor(width * fx), y = Math.floor(height * fy), expected = pixel(original, x, y);
      assert(String(pixel(prepared, content.x + Math.floor(content.width * fx), content.y + Math.floor(content.height * fy))) === String(expected), 'Working copy content alignment');
      assert(String(pixel(roundtrip, x, y)) === String(expected), 'Padding cropped from returned image');
    }
    const strokes = [{ radius: .08, points: [{ x: .25, y: .25 }] }];
    const mask = await pixels(await maskBlob(width, height, strokes, layout));
    assert(mask.width === prepared.width && mask.height === prepared.height, 'Source/mask sizes match');
    assert(pixel(mask, content.x + Math.floor(content.width / 4), content.y + Math.floor(content.height / 4))[0] === 255, 'Mask stays over chosen area');
    if (content.x) assert(pixel(mask, 0, Math.floor(layout.height / 4))[0] === 0, 'Side padding is not painted');
    if (content.y) assert(pixel(mask, Math.floor(layout.width / 4), 0)[0] === 0, 'Top padding is not painted');
    const candidate = new OffscreenCanvas(layout.width, layout.height), editedContext = candidate.getContext('2d');
    editedContext.fillStyle = '#6420db'; editedContext.fillRect(0, 0, candidate.width, candidate.height);
    const edited = await pixels(await combineMagicResult(source, await candidate.convertToBlob(), strokes, layout));
    const nativeMask = await pixels(await maskBlob(width, height, strokes));
    for (let i = 0; i < edited.data.length; i += 4) {
      assert(edited.data[i + 3] === original.data[i + 3], 'Source alpha preserved');
      if (!nativeMask.data[i]) for (let c = 0; c < 3; c++) assert(edited.data[i + c] === original.data[i + c], 'Unpainted source pixel preserved');
    }
    assert(String(pixel(edited, Math.floor(width / 4), Math.floor(height / 4))) === '100,32,219,255', 'Selected area receives candidate');
    let rejected = false;
    const wrongSize = new OffscreenCanvas(8, 8); wrongSize.getContext('2d').fillRect(0, 0, 8, 8);
    try { await combineMagicResult(source, await wrongSize.convertToBlob(), null, layout); } catch (e) { rejected = e.message.includes('dimensions'); }
    assert(rejected, 'Unexpected candidate dimensions rejected');
  }
  return 'Magic Edit native canvas: working resolution, aspect/padding/crop alignment, source dimensions/alpha, mask alignment and untouched pixels verified for wide, tall, thumbnail and square sources';
}
