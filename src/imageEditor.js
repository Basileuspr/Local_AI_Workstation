export const MAX_EDITOR_PIXELS = 24_000_000;
const slider = (key, label, group, min = -100, max = 100, step = 1, unit = "%") => ({ key, label, group, min, max, step, unit });
export const ADJUSTMENT_CONTROLS = [
  slider("temperature", "Temperature", "White balance"), slider("tint", "Tint", "White balance"),
  slider("brightness", "Brightness", "Light"), slider("exposure", "Exposure", "Light", -3, 3, .1, " EV"),
  slider("contrast", "Contrast", "Light"), slider("highlights", "Highlights", "Light"), slider("shadows", "Shadows", "Light"),
  slider("whites", "Whites", "Light"), slider("blacks", "Blacks", "Light"),
  slider("red", "Reduce red hue / cast", "Color", 0), slider("vibrance", "Vibrance", "Color"), slider("saturation", "Saturation", "Color"),
  slider("sharpness", "Sharpness", "Texture", 0), slider("clarity", "Clarity", "Texture"),
  slider("deblur", "Remove blur", "Texture", 0), slider("refinement", "Low-resolution refinement", "Texture", 0),
  slider("vignette", "Vignette", "Effects"),
];
export const DEFAULT_ADJUSTMENTS = Object.freeze({ ...Object.fromEntries(ADJUSTMENT_CONTROLS.map(c=>[c.key,0])), rotation:0 });

export function normalizeAdjustments(value = {}) {
  return Object.fromEntries(ADJUSTMENT_CONTROLS.map(({ key, min, max }) =>
    [key, Math.min(max, Math.max(min, Number.isFinite(value[key]) ? value[key] : 0))]));
}

// Direct per-pixel edits: positions, size and alpha never change; source is immutable.
export function adjustPixels(source, settings = {}, width = source.length / 4, height = 1) {
  const values = normalizeAdjustments(settings);
  if (settings?.relative) {
    for (const {key} of ADJUSTMENT_CONTROLS) {
      const value = Number(settings[key]) || 0;
      values[key] = key === 'exposure' ? Math.max(-6, Math.min(6, value)) : Math.max(-200, Math.min(200, value));
    }
  }
  const { red, exposure, contrast, saturation } = values;
  const result = new Uint8ClampedArray(source);
  if (!Object.values(values).some(Boolean)) return result;
  const gain = 2 ** exposure, factor = 1 + contrast / 100, sat = 1 + saturation / 100;
  const lookup = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    const linear = (v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4) * gain;
    lookup[i] = (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055) * 255;
  }
  for (let i = 0; i < result.length; i += 4) {
    let r = source[i], g = source[i + 1], b = source[i + 2];
    r = Math.min(255, Math.max(0, r - Math.max(0, r - (g + b) / 2) * red / 100));
    // Fractional red values interpolate the exposure LUT without premature rounding.
    const lo = Math.floor(r), hi = Math.min(255, lo + 1);
    r = lookup[lo] + (lookup[hi] - lookup[lo]) * (r - lo);
    g = lookup[g]; b = lookup[b];
    r += values.temperature * .3 + values.tint * .15;
    g -= values.tint * .2;
    b -= values.temperature * .3 - values.tint * .15;
    const luminance = Math.max(0, Math.min(1, (.2126*r+.7152*g+.0722*b)/255));
    const tone = values.brightness*.64 + values.highlights*.8*luminance**2
      + values.shadows*.8*(1-luminance)**2 + values.whites*1.1*luminance**6 + values.blacks*1.1*(1-luminance)**6;
    r += tone; g += tone; b += tone;
    r = (r - 127.5) * factor + 127.5;
    g = (g - 127.5) * factor + 127.5;
    b = (b - 127.5) * factor + 127.5;
    const gray = .2126 * r + .7152 * g + .0722 * b;
    const chroma = Math.min(1,(Math.max(r,g,b)-Math.min(r,g,b))/255);
    const colorGain = sat * (1+values.vibrance/100*(1-chroma));
    const x=(i/4)%width, y=Math.floor(i/4/width);
    const edge = Math.min(1, ((x-(width-1)/2)/Math.max(1,width/2))**2 + ((y-(height-1)/2)/Math.max(1,height/2))**2);
    const vignette = values.vignette/100*edge**2;
    const finish = c => vignette>=0 ? c*(1-vignette*.85) : c+(255-c)*(-vignette)*.65;
    result[i] = finish(gray + (r - gray) * colorGain);
    result[i + 1] = finish(gray + (g - gray) * colorGain);
    result[i + 2] = finish(gray + (b - gray) * colorGain);
  }
  return texturePixels(result, width, height, values);
}

// Separable alpha-weighted box filter: O(pixels), with transparent RGB excluded.
export function blurPixels(source, width, height, radius) {
  // Keep premultiplied values fractional until alpha is divided out. Rounding
  // this intermediate to bytes invented edges in translucent, flat-colored areas.
  const horizontal=new Float32Array(source.length), output=new Uint8ClampedArray(source.length);
  for (let y=0;y<height;y++) {
    let sums=[0,0,0,0], count=0;
    const add=(x,sign)=>{if(x<0||x>=width)return;const i=(y*width+x)*4,a=source[i+3]/255;for(let c=0;c<3;c++)sums[c]+=sign*source[i+c]*a;sums[3]+=sign*source[i+3];count+=sign;};
    for(let x=0;x<=Math.min(radius,width-1);x++)add(x,1);
    for(let x=0;x<width;x++){const i=(y*width+x)*4;for(let c=0;c<4;c++)horizontal[i+c]=sums[c]/count;add(x-radius,-1);add(x+radius+1,1);}
  }
  for(let x=0;x<width;x++) {
    let sums=[0,0,0,0],count=0;
    const add=(y,sign)=>{if(y<0||y>=height)return;const i=(y*width+x)*4;for(let c=0;c<4;c++)sums[c]+=sign*horizontal[i+c];count+=sign;};
    for(let y=0;y<=Math.min(radius,height-1);y++)add(y,1);
    for(let y=0;y<height;y++){const i=(y*width+x)*4;for(let c=0;c<3;c++)output[i+c]=sums[3]>0?sums[c]*255/sums[3]:source[i+c];output[i+3]=source[i+3];add(y-radius,-1);add(y+radius+1,1);}
  }
  return output;
}

// Gaussian luminance sharpening with a small row cache, rather than smoothing
// the source or allocating several full-size floating-point images. Transparent
// RGB never contributes, and a shared RGB offset preserves channel differences.
function sharpenDetail(source, width, height, amount, radius) {
  if (!(amount > 0)) return source;
  const kernel = radius === 1 ? [1, 2, 1] : [1, 4, 6, 4, 1];
  const rows = Array.from({length: kernel.length}, () => new Float32Array(width * 2));
  const rowIds = new Int32Array(kernel.length).fill(-1);
  const luminance = i => .2126 * source[i] + .7152 * source[i + 1] + .0722 * source[i + 2];
  const row = y => {
    const slot = y % rows.length, result = rows[slot];
    if (rowIds[slot] === y) return result;
    for (let x = 0; x < width; x++) {
      let light = 0, weight = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= width) continue;
        const i = (y * width + xx) * 4, alphaWeight = source[i + 3] * kernel[dx + radius];
        light += luminance(i) * alphaWeight; weight += alphaWeight;
      }
      result[x * 2] = light; result[x * 2 + 1] = weight;
    }
    rowIds[slot] = y;
    return result;
  };
  const result = new Uint8ClampedArray(source);
  for (let y = 0; y < height; y++) {
    const neighbors = [];
    for (let dy = -radius; dy <= radius; dy++) {
      if (y + dy >= 0 && y + dy < height) neighbors.push([row(y + dy), kernel[dy + radius]]);
    }
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!source[i + 3]) continue;
      let light = 0, weight = 0;
      for (const [values, k] of neighbors) { light += values[x * 2] * k; weight += values[x * 2 + 1] * k; }
      const detail = luminance(i) - light / weight;
      // A gradual threshold avoids a sudden blur/sharpen boundary in fine
      // texture; cap the correction and avoid clipping individual RGB channels.
      const delta = detail * Math.min(1, Math.abs(detail) / 1.25) * amount;
      const minimum = Math.min(source[i], source[i + 1], source[i + 2]);
      const maximum = Math.max(source[i], source[i + 1], source[i + 2]);
      const correction = Math.max(-Math.min(24, minimum), Math.min(Math.min(24, 255 - maximum), delta));
      for (let c = 0; c < 3; c++) result[i + c] = source[i + c] + correction;
    }
  }
  return result;
}

function texturePixels(source,width,height,{sharpness,clarity,deblur,refinement}) {
  // These controls only add detail. In particular, a slider below a locked
  // marker must not turn Remove blur into a negative sharpening (blur) pass.
  let result=sharpenDetail(source,width,height,Math.max(0,sharpness)/100*1.4 + Math.max(0,refinement)/100*1.2,1);
  result=sharpenDetail(result,width,height,Math.max(0,deblur)/100*1.6,2);
  const unsharp=(radius,amount,threshold=0)=>{
    if(!amount)return;
    const blurred=blurPixels(result,width,height,radius), next=new Uint8ClampedArray(result);
    for(let i=0;i<next.length;i+=4)if(result[i+3])for(let c=0;c<3;c++){
      const detail=result[i+c]-blurred[i+c];
      if(Math.abs(detail)>=threshold)next[i+c]=result[i+c]+Math.max(-48,Math.min(48,detail*amount));
    }
    result=next;
  };
  unsharp(Math.max(2,Math.min(32,Math.round(Math.min(width,height)*.012))),clarity/100*.8,2);
  return result;
}

export function editedFilename(name) {
  return `${String(name || "image").replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "image"}-edited.png`;
}
