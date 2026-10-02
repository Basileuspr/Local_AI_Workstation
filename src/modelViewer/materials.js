export const MATERIAL_PRESETS={Plastic:{roughness:.6,metalness:0,opacity:1},Matte:{roughness:1,metalness:0,opacity:1},Metal:{roughness:.22,metalness:1,opacity:1},Gold:{color:'#cba54c',roughness:.24,metalness:1,opacity:1},Glass:{roughness:.12,metalness:.05,opacity:.3}};
export const TEXTURES=[['Linen','#d9c395','fabric'],['Canvas','#c5c0a8','fabric'],['Denim','#5376a6','fabric'],['Burlap','#a88b48','fabric'],['Ice','#8ed4e0','stone'],['Leather','#9b784e','stone'],['Sandstone','#cab891','stone'],['Granite','#8f8884','stone'],['Green marble','#286650','marble'],['White marble','#dedee0','marble'],['Brown marble','#60442e','marble'],['Slate','#8e979c','stone'],['White plaster','#e6e6de','stone'],['Sand','#d4cbb7','stone'],['Ivory','#eaddb5','stone'],['Parchment','#d9c28b','stone'],['Blue plaster','#c3dce9','stone'],['Pink plaster','#d5afb3','stone'],['Purple fabric','#6c348b','fabric'],['Frost','#b5d8e8','stone'],['Cork','#b5814f','stone'],['Dark wood','#513a22','wood'],['Oak','#b17a48','wood'],['Walnut','#7c542f','wood']];
export const STAMPS=['Star','Burst','Arrow','Chevron','Cloud','Ring','Wave','Heart','Lightning','Moon','Cross','Prohibited','Circle','Plus','Square','Rounded square','Smile','Triangle','Flag'];
const canvas=()=>{const c=document.createElement('canvas');c.width=256;c.height=256;return c;};
export function proceduralTexture(name){
  const entry=TEXTURES.find(t=>t[0]===name);if(!entry)throw Error('Unknown texture.');const [,hex,kind]=entry,c=canvas(),ctx=c.getContext('2d'),data=ctx.createImageData(256,256),rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));let seed=17;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/4294967296-.5;
    const n=kind==='wood'?Math.sin(y*.26+Math.sin(x*.02)*2)*22+noise*15:kind==='fabric'?((x%4<2?1:-1)+(y%4<2?1:-1))*13+noise*25:kind==='marble'?Math.sin(x*.04+y*.03+Math.sin(y*.05)*3)*16+noise*10:noise*45;
    const index=(y*256+x)*4;for(let i=0;i<3;i++)data.data[index+i]=Math.min(255,Math.max(0,rgb[i]+n));data.data[index+3]=255;
  }
  ctx.putImageData(data,0,0);return c.toDataURL('image/png');
}
export function stampTexture(name,color='#ffffff',transparent=true){
  const c=canvas(),ctx=c.getContext('2d');if(!transparent){ctx.fillStyle='#283442';ctx.fillRect(0,0,256,256);}ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=20;ctx.lineJoin='round';
  const polygon=points=>{ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();};
  if(name==='Star'||name==='Burst'){const points=name==='Star'?8:20;polygon(Array.from({length:points},(_,i)=>{const angle=i/points*Math.PI*2-Math.PI/2,r=i%2?45:100;return [128+Math.cos(angle)*r,128+Math.sin(angle)*r];}));}
  else if(name==='Arrow')polygon([[28,87],[134,87],[134,28],[229,128],[134,228],[134,170],[28,170]]);
  else if(name==='Chevron')polygon([[40,28],[124,28],[223,128],[124,228],[40,228],[139,128]]);
  else if(name==='Triangle')polygon([[128,28],[229,225],[27,225]]);
  else if(name==='Lightning')polygon([[93,24],[184,101],[144,107],[220,232],[90,157],[128,144],[39,53]]);
  else if(name==='Plus'||name==='Cross'){ctx.save();ctx.translate(128,128);if(name==='Cross')ctx.rotate(Math.PI/4);ctx.fillRect(-24,-97,48,194);ctx.fillRect(-97,-24,194,48);ctx.restore();}
  else if(name==='Heart'){ctx.beginPath();ctx.moveTo(128,221);ctx.bezierCurveTo(-20,127,14,0,128,74);ctx.bezierCurveTo(241,0,279,127,128,221);ctx.fill();}
  else if(['Square','Rounded square'].includes(name)){ctx.beginPath();ctx.roundRect(36,36,184,184,name==='Square'?0:25);ctx.fill();}
  else if(['Wave','Flag'].includes(name)){ctx.beginPath();ctx.moveTo(27,70);ctx.bezierCurveTo(89,25,158,111,228,70);ctx.lineTo(228,192);ctx.bezierCurveTo(158,233,89,147,27,192);ctx.closePath();ctx.fill();}
  else if(name==='Cloud'){for(const [x,y,r] of [[75,139,44],[103,96,44],[150,104,50],[183,141,44],[126,155,55]]){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();}}
  else{
    ctx.beginPath();ctx.arc(128,128,92,0,Math.PI*2);['Ring','Prohibited'].includes(name)?ctx.stroke():ctx.fill();
    if(name==='Prohibited'){ctx.beginPath();ctx.moveTo(66,63);ctx.lineTo(191,190);ctx.stroke();}
    if(name==='Moon'||name==='Smile'){
      ctx.globalCompositeOperation='destination-out';
      if(name==='Moon'){ctx.beginPath();ctx.arc(180,95,91,0,Math.PI*2);ctx.fill();}
      else{for(const x of [93,162]){ctx.beginPath();ctx.arc(x,104,10,0,Math.PI*2);ctx.fill();}ctx.lineWidth=9;ctx.beginPath();ctx.arc(128,126,56,.25,Math.PI-.25);ctx.stroke();}
    }
  }
  return c.toDataURL('image/png');
}
export async function qrTexture(url,transparent=true){
  const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||url.length>2048)throw Error('Enter an HTTP or HTTPS URL of at most 2,048 characters.');
  const QRCode=await import('qrcode');return QRCode.toDataURL(url,{width:512,margin:4,errorCorrectionLevel:'M',color:{dark:'#000000ff',light:transparent?'#ffffff00':'#ffffffff'}});
}
export async function imageTexture(file){
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024)throw Error('Choose a PNG, JPEG, or WebP image up to 12 MB.');
  const bitmap=await createImageBitmap(file);
  try{const factor=Math.min(1,2048/Math.max(bitmap.width,bitmap.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*factor));c.height=Math.max(1,Math.round(bitmap.height*factor));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);return c.toDataURL('image/png');}finally{bitmap.close();}
}
