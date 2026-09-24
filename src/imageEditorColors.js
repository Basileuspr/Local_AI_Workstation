export function updateColorSample(edit, id, changes) {
  const color=changes.color?.slice(1).match(/../g)?.map(c=>parseInt(c,16));
  return {...edit,colorSamples:edit.colorSamples.map(sample=>sample.id===id?{...sample,...changes}:sample),
    colorEdits:color?edit.colorEdits.map(area=>area.sampleId===id?{...area,color}:area):edit.colorEdits};
}
export function removeColorSample(edit,id) {
  return {...edit,colorSamples:edit.colorSamples.filter(sample=>sample.id!==id),colorEdits:edit.colorEdits.filter(area=>area.sampleId!==id)};
}
// Reference-color fills and brush marks retain source alpha and dark linework.
export function colorRegion(source, width, height, edit, areaSource = source) {
  const result = new Uint8ClampedArray(source);
  const x = Math.min(width - 1, Math.max(0, Math.floor(edit.x * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor(edit.y * height)));
  const seed = (y * width + x) * 4, color = edit.color;
  if (!Array.isArray(color) || color.length !== 3 || !color.every(Number.isFinite)) return result;
  const strength = Math.min(1, Math.max(0, (edit.strength ?? 100) / 100));
  const threshold = Math.min(100, Math.max(0, edit.tolerance ?? 18)) * 4.42;
  const eligible = pixel => {
    const i = pixel * 4;
    return areaSource[i + 3] > 0 && (!edit.protectLines || Math.max(areaSource[i], areaSource[i+1], areaSource[i+2]) > 75)
      && Math.hypot(areaSource[i]-areaSource[seed], areaSource[i+1]-areaSource[seed+1], areaSource[i+2]-areaSource[seed+2]) <= threshold;
  };
  const paint = pixel => {
    const i = pixel * 4;
    if (!source[i+3]) return;
    const light = Math.max(areaSource[i], areaSource[i+1], areaSource[i+2]) / 255;
    if (edit.protectLines && light <= 75/255) return;
    for (let c=0;c<3;c++) result[i+c] = source[i+c] * (1-strength) + color[c] * (edit.protectLines ? light : 1) * strength;
  };
  if (edit.mode === 'brush') {
    const radius = Math.max(1, Math.round((edit.radius || .025) * Math.min(width,height)));
    for (let py=Math.max(0,y-radius);py<=Math.min(height-1,y+radius);py++)
      for(let px=Math.max(0,x-radius);px<=Math.min(width-1,x+radius);px++)
        if((px-x)**2+(py-y)**2<=radius**2)paint(py*width+px);
  } else {
    const queue = new Uint32Array(width*height), seen = new Uint8Array(width*height);
    let head=0,tail=0;
    const visit = p => { if(!seen[p]){seen[p]=1;if(eligible(p))queue[tail++]=p;} };
    visit(y*width+x);
    while(head<tail){const p=queue[head++],px=p%width;paint(p);if(px>0)visit(p-1);if(px<width-1)visit(p+1);if(p>=width)visit(p-width);if(p<(height-1)*width)visit(p+width);}
  }
  return result;
}
