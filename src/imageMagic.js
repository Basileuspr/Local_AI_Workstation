import * as workflows from './imageWorkflowApi';

export const REFERENCE_ROLES = ['Background detail and art style', 'Character skin tone', 'Color palette', 'Lighting', 'Character appearance'];
// SDXL must not denoise a small source at thumbnail resolution. Work near its
// native size, padding narrow images instead of stretching their proportions.
export function magicLayout(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The image dimensions are invalid. Reopen the source image.');
  }
  const scale = 1024 / Math.max(width, height);
  const contentWidth = Math.max(1, Math.round(width * scale));
  const contentHeight = Math.max(1, Math.round(height * scale));
  const workingWidth = Math.max(768, Math.ceil(contentWidth / 8) * 8);
  const workingHeight = Math.max(768, Math.ceil(contentHeight / 8) * 8);
  return {
    width: workingWidth, height: workingHeight,
    content: { x: Math.floor((workingWidth - contentWidth) / 2), y: Math.floor((workingHeight - contentHeight) / 2), width: contentWidth, height: contentHeight },
  };
}
export function magicSize(width,height) {
  const size = magicLayout(width, height);
  return { width: size.width, height: size.height };
}
export async function prepareMagicInput(blob) {
  const image = await createImageBitmap(blob);
  try {
    const layout = magicLayout(image.width, image.height), { content } = layout;
    const canvas = new OffscreenCanvas(layout.width, layout.height), context = canvas.getContext('2d');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    // Extend only the edge pixels into padding. The actual image is uniformly
    // scaled in the center; the padding is cropped away before acceptance.
    const columns = [[0, 1, 0, content.x], [0, image.width, content.x, content.width], [image.width - 1, 1, content.x + content.width, layout.width - content.x - content.width]];
    const rows = [[0, 1, 0, content.y], [0, image.height, content.y, content.height], [image.height - 1, 1, content.y + content.height, layout.height - content.y - content.height]];
    for (const [sx, sw, dx, dw] of columns) for (const [sy, sh, dy, dh] of rows) {
      if (dw && dh) context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), layout };
  } finally { image.close(); }
}
export function magicStage(source, model, size, mask=null) {
  return {id:crypto.randomUUID().replaceAll('-',''),operation:mask?'inpaint':'img2img',source:{kind:'asset',id:source},
    mask_asset_id:mask,provider_slot:'local-sdxl',model_id:model,...size,strength:.25};
}
export async function uploadMagicAsset(workflow, file) {
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const updated=await workflows.upload(workflow,file);
  const asset=updated.assets.find(a=>a.id===hash);
  if(!asset)throw new Error('Uploaded image could not be identified. Reopen the image and try again.');
  return {workflow:updated,id:asset.id};
}
export function paintMask(canvas, strokes, background='black', foreground='white') {
  const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);
  if(background){context.fillStyle=background;context.fillRect(0,0,canvas.width,canvas.height);}
  context.fillStyle=foreground;context.strokeStyle=foreground;context.lineCap='round';context.lineJoin='round';
  for(const stroke of strokes){
    context.lineWidth=stroke.radius*2*Math.min(canvas.width,canvas.height);
    context.beginPath();stroke.points.forEach((p,i)=>i?context.lineTo(p.x*canvas.width,p.y*canvas.height):context.moveTo(p.x*canvas.width,p.y*canvas.height));context.stroke();
    for(const p of [stroke.points[0],stroke.points.at(-1)].filter(Boolean)){context.beginPath();context.arc(p.x*canvas.width,p.y*canvas.height,context.lineWidth/2,0,Math.PI*2);context.fill();}
  }
}
export async function maskBlob(width,height,strokes,layout=null) {
  const canvas=new OffscreenCanvas(layout?.content.width || width,layout?.content.height || height);paintMask(canvas,strokes);
  if (!layout) return canvas.convertToBlob({type:'image/png'});
  const working = new OffscreenCanvas(layout.width, layout.height), context = working.getContext('2d');
  context.fillStyle = 'black'; context.fillRect(0, 0, working.width, working.height);
  context.drawImage(canvas, layout.content.x, layout.content.y);
  return working.convertToBlob({type:'image/png'});
}
// Restore source dimensions and alpha, and guarantee untouched pixels outside the user's mask.
export async function combineMagicResult(sourceBlob, resultBlob, strokes=null, layout=null) {
  const source=await createImageBitmap(sourceBlob), result=await createImageBitmap(resultBlob);
  try {
    const canvas=new OffscreenCanvas(source.width,source.height), context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(source,0,0);const original=context.getImageData(0,0,canvas.width,canvas.height);
    context.clearRect(0,0,canvas.width,canvas.height);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    if (layout) {
      if (result.width !== layout.width || result.height !== layout.height) throw new Error('The edited candidate has unexpected dimensions. Your source is unchanged.');
      const { x, y, width, height } = layout.content;
      context.drawImage(result, x, y, width, height, 0, 0, canvas.width, canvas.height);
    } else context.drawImage(result,0,0,canvas.width,canvas.height);
    const edited=context.getImageData(0,0,canvas.width,canvas.height);
    let mask;
    if(strokes){const maskCanvas=new OffscreenCanvas(canvas.width,canvas.height);paintMask(maskCanvas,strokes);mask=maskCanvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;}
    for(let i=0;i<edited.data.length;i+=4){const amount=mask?mask[i]/255:1;for(let c=0;c<3;c++)edited.data[i+c]=original.data[i+c]+(edited.data[i+c]-original.data[i+c])*amount;edited.data[i+3]=original.data[i+3];}
    context.putImageData(edited,0,0);return canvas.convertToBlob({type:'image/png'});
  }finally{source.close();result.close();}
}
