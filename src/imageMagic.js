import * as workflows from './imageWorkflowApi';

export const REFERENCE_ROLES = ['Background detail and art style', 'Character skin tone', 'Color palette', 'Lighting', 'Character appearance'];
export const MAGIC_MODES = [
  {id:'refine',label:'Gentle edit / refine',provider:'local-sdxl',help:'Make a small prompted change to the whole image or a painted area.'},
  {id:'structure',label:'Preserve structure · ControlNet',provider:'local-sdxl-controlnet',help:'Use source edges to guide a modest edit. Facial likeness is not locked.'},
  {id:'references',label:'Use reference images · IP-Adapter',provider:'local-sdxl-ip-adapter',help:'Pool selected references as visual guidance. Roles below apply only to the optional vision description.'},
  {id:'outpaint',label:'Extend canvas · outpaint',provider:'local-sdxl-outpaint',help:'Generate small new borders. The original source pixels are restored in the expanded candidate.'},
  {id:'upscale',label:'Enlarge · trained AI upscale',provider:'local-realesrgan',help:'Enlarge with Real-ESRGAN. Result amount blends inferred detail with ordinary resizing.'},
];
export const MAGIC_DEFAULTS = {strength:.2,amount:.5,control_scale:.5,reference_scale:.35,steps:24,guidance:4,upscale_factor:2};
export const magicProvider = mode => MAGIC_MODES.find(item=>item.id===mode)?.provider;
export function preferredMagicModel(models=[],current='') {
  return models.find(m=>m.id===current)?.id || models.find(m=>m.id==='dreamshaper-xl-1-0')?.id || models[0]?.id || '';
}
export function preferredMagicVisionModel(models=[],current='') {
  return models.find(m=>m.id===current)?.id || models.find(m=>m.id==='qwen3.5:9b')?.id || models.find(m=>m.id==='qwen3-vl:8b')?.id || models[0]?.id || '';
}

// Fit the source to the available canvas while keeping padding under eight pixels.
// This avoids turning a modest border into a large extension on panoramic images.
export function magicOutpaintLayout(width,height,target,borders) {
  magicLayout(width,height,target);
  const values=['left','right','top','bottom'].map(k=>borders[k]);
  if(values.some(v=>!Number.isInteger(v)||v<0||v>256||v%8)||!values.some(Boolean))throw new Error('Choose at least one border, in multiples of 8 from 0 to 256.');
  const available={width:target.width-borders.left-borders.right,height:target.height-borders.top-borders.bottom};
  const scale=Math.min(available.width/width,available.height/height);
  const interior={width:Math.floor(width*scale/8)*8,height:Math.floor(height*scale/8)*8};
  if(Math.min(interior.width,interior.height)<256)throw new Error('This source is too narrow for the selected canvas and borders. Increase the working canvas or reduce the borders.');
  const layout=magicLayout(width,height,interior);
  return {layout,stageSize:{width:interior.width+borders.left+borders.right,height:interior.height+borders.top+borders.bottom,allow_long_wait:!!target.allow_long_wait},borders};
}

export function magicEditStage(source,model,size,{mode='refine',mask=null,references=[],borders={},...settings}={}) {
  const provider=magicProvider(mode);
  if(!provider)throw new Error('Choose a supported Magic Edit mode.');
  const stage={...magicStage(source,model,size,mode==='refine'?mask:null),...MAGIC_DEFAULTS,...settings,provider_slot:provider};
  delete stage.amount;delete stage.steps;delete stage.guidance;
  if(mode==='structure')Object.assign(stage,{operation:'controlnet',control_input:'source',control_kind:'edges',canny_low:100,canny_high:200});
  if(mode==='references'){
    const ids=[...new Set(references)];
    if(!ids.length)throw new Error('Add at least one reference image for visual conditioning.');
    Object.assign(stage,{operation:'multi_reference',reference_asset_ids:ids});
  }
  if(mode==='outpaint')Object.assign(stage,{operation:'outpaint',...Object.fromEntries(['left','right','top','bottom'].map(k=>['outpaint_'+k,borders[k]]))});
  if(mode==='upscale')Object.assign(stage,{operation:'upscale',model_id:''});
  return stage;
}
// SDXL must not denoise a small source at thumbnail resolution. Work near its
// native size, padding narrow images instead of stretching their proportions.
export function magicLayout(width, height, target = null) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The image dimensions are invalid. Reopen the source image.');
  }
  if (target && [target.width, target.height].some(value => !Number.isInteger(value) || value < 256 || value > 2048 || value % 8)) {
    throw new Error('Choose working dimensions from 256 to 2048 in multiples of 8.');
  }
  const scale = target ? Math.min(target.width / width, target.height / height) : 1024 / Math.max(width, height);
  const contentWidth = Math.max(1, Math.round(width * scale));
  const contentHeight = Math.max(1, Math.round(height * scale));
  const workingWidth = target?.width ?? Math.max(768, Math.ceil(contentWidth / 8) * 8);
  const workingHeight = target?.height ?? Math.max(768, Math.ceil(contentHeight / 8) * 8);
  return {
    width: workingWidth, height: workingHeight,
    content: { x: Math.floor((workingWidth - contentWidth) / 2), y: Math.floor((workingHeight - contentHeight) / 2), width: contentWidth, height: contentHeight },
  };
}
export function magicSize(width,height) {
  const size = magicLayout(width, height);
  return { width: size.width, height: size.height };
}
export async function prepareMagicInput(blob, target = null) {
  const image = await createImageBitmap(blob);
  try {
    const layout = magicLayout(image.width, image.height, target), { content } = layout;
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
export async function combineMagicResult(sourceBlob, resultBlob, strokes=null, layout=null, amount=1) {
  if(!Number.isFinite(amount)||amount<0||amount>1)throw new Error('Result amount must be from 0 to 1.');
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
    for(let i=0;i<edited.data.length;i+=4){const blend=amount*(mask?mask[i]/255:1);for(let c=0;c<3;c++)edited.data[i+c]=original.data[i+c]+(edited.data[i+c]-original.data[i+c])*blend;edited.data[i+3]=original.data[i+3];}
    context.putImageData(edited,0,0);return canvas.convertToBlob({type:'image/png'});
  }finally{source.close();result.close();}
}

export async function combineMagicUpscale(sourceBlob,resultBlob,factor=2,amount=.5) {
  const source=await createImageBitmap(sourceBlob),result=await createImageBitmap(resultBlob);
  try{
    if(![2,3,4].includes(factor)||result.width!==source.width*factor||result.height!==source.height*factor)throw new Error('The enlarged candidate has unexpected dimensions.');
    const canvas=new OffscreenCanvas(result.width,result.height),ctx=canvas.getContext('2d');
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,canvas.width,canvas.height);
    return await combineMagicResult(await canvas.convertToBlob({type:'image/png'}),resultBlob,null,null,amount);
  }finally{source.close();result.close();}
}

export async function combineMagicOutpaint(sourceBlob,resultBlob,geometry) {
  const source=await createImageBitmap(sourceBlob),result=await createImageBitmap(resultBlob);
  try{
    const {layout,stageSize,borders}=geometry,{content}=layout;
    if(result.width!==stageSize.width||result.height!==stageSize.height)throw new Error('The extended candidate has unexpected dimensions.');
    const sx=source.width/content.width,sy=source.height/content.height;
    const left=Math.round((borders.left+content.x)*sx),top=Math.round((borders.top+content.y)*sy);
    const right=Math.round((borders.right+layout.width-content.x-content.width)*sx),bottom=Math.round((borders.bottom+layout.height-content.y-content.height)*sy);
    const canvas=new OffscreenCanvas(source.width+left+right,source.height+top+bottom),ctx=canvas.getContext('2d');
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(result,0,0,canvas.width,canvas.height);
    // Copy RGBA pixels, including transparent source pixels, without alpha blending.
    const original=new OffscreenCanvas(source.width,source.height),originalContext=original.getContext('2d');originalContext.drawImage(source,0,0);
    ctx.putImageData(originalContext.getImageData(0,0,source.width,source.height),left,top);
    return {blob:await canvas.convertToBlob({type:'image/png'}),sourceBox:[left,top,source.width+left,source.height+top]};
  }finally{source.close();result.close();}
}
