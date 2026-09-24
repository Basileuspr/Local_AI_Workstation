const gcd=(a,b)=>b?gcd(b,a%b):a;
export function ratioSizes(width,height,{min=512,max=1536}={}) {
  width=Math.round(Number(width));height=Math.round(Number(height));
  if(!(width>0&&height>0))return [];
  const divisor=gcd(width,height),w=width/divisor,h=height/divisor;
  const a=8/gcd(w,8),b=8/gcd(h,8),step=a*b/gcd(a,b);
  const low=Math.ceil(Math.max(min/w,min/h)/step)*step,high=Math.floor(Math.min(max/w,max/h)/step)*step;
  const sizes=[];for(let k=low;k<=high;k+=step)sizes.push({width:w*k,height:h*k});return sizes;
}
export function fitDimensions(width,height,limits={min:256,max:1024}) {
  const sizes=ratioSizes(width,height,limits);
  if(sizes.length)return sizes.reduce((best,size)=>Math.abs(size.width-width)+Math.abs(size.height-height)<Math.abs(best.width-width)+Math.abs(best.height-height)?size:best);
  const scale=Math.min(limits.max/width,limits.max/height,1);
  const result={width:Math.round(width*scale/8)*8,height:Math.round(height*scale/8)*8};
  return result.width>=limits.min&&result.height>=limits.min?result:null;
}
export function resizeDimensions(size,key,value,{locked=true,min=512,max=1536}={}) {
  const target=Number(value);if(!Number.isFinite(target)||target<=0)throw new Error('Enter a positive pixel size.');
  if(!locked)return {...size,[key]:Math.max(min,Math.min(max,Math.round(target/8)*8))};
  const sizes=ratioSizes(size.width,size.height,{min,max});
  if(!sizes.length)throw new Error('This ratio has no supported size. Choose a preset or unlock the ratio.');
  return sizes.reduce((best,item)=>Math.abs(item[key]-target)<Math.abs(best[key]-target)?item:best);
}
export function ratioLabel(width,height){const d=gcd(Number(width),Number(height));return d?`${width/d}:${height/d}`:'Custom';}
