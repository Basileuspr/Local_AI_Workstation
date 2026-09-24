import {expect,it} from 'vitest';
import {adjustPixels} from '../../src/imageEditor';
import {currentPass,lockEditStage,newEditState} from '../../src/imageEditorStages';

function pixels(width,height,pixel) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(pixel(x,y),(y*width+x)*4);
  return data;
}
const contrast=data=>{
  const values=Array.from(data).filter((_,i)=>i%4===0),mean=values.reduce((a,b)=>a+b,0)/values.length;
  return values.reduce((sum,v)=>sum+(v-mean)**2,0)/values.length;
};

it('refinement preserves and strengthens fine, low-contrast texture instead of smoothing it away',()=>{
  for(const period of [2,3,4,8])for(const level of [35,40,70,100]){
    const input=pixels(48,24,(x,y)=>{const v=128+Math.round(5*Math.cos(2*Math.PI*x/period));return[v,v,v,255];});
    const output=adjustPixels(input,{refinement:level},48,24);
    expect(contrast(output)).toBeGreaterThan(contrast(input));
  }
});

it('Remove blur increases soft-edge definition without a large halo or changes to flat areas',()=>{
  const values=[50,50,50,50,51,56,72,106,150,184,200,205,206,206,206,206];
  const input=pixels(16,12,(x)=>[values[x],values[x],values[x],255]);
  for(const level of [35,70,100]){
    const output=adjustPixels(input,{deblur:level},16,12),row=Array.from(output.slice(6*16*4,7*16*4)).filter((_,i)=>i%4===0);
    expect(row[8]-row[7]).toBeGreaterThan(values[8]-values[7]);
    expect(row[0]).toBe(50);expect(row[15]).toBe(206);
    expect(Math.max(...row)).toBeLessThanOrEqual(230);expect(Math.min(...row)).toBeGreaterThanOrEqual(26);
  }
});

it('keeps flat translucent colors exact even at very low alpha and ignores hidden RGB',()=>{
  const input=pixels(20,10,(x,y)=>x===0?[255,0,255,0]:[74,123,163,1+(x*17+y*7)%254]);
  for(const settings of [{deblur:100},{refinement:100},{sharpness:100},{clarity:60}]){
    const output=adjustPixels(input,settings,20,10);
    expect(output).toEqual(input);
  }
});

it('retains alpha, source pixels and channel differences while sharpening color edges',()=>{
  const input=pixels(24,16,(x)=>{const v=x<12?70:145;return[v+20,v,v-30,190];}),before=input.slice();
  const output=adjustPixels(input,{deblur:70,refinement:40},24,16);
  expect(input).toEqual(before);expect(output).not.toEqual(input);
  for(let i=0;i<output.length;i+=4){expect(output[i]-output[i+1]).toBe(20);expect(output[i+1]-output[i+2]).toBe(30);expect(output[i+3]).toBe(190);}
});

it('does not create a blur pass when one-way detail sliders move below their locked positions',()=>{
  const locked=lockEditStage(newEditState({deblur:70,refinement:40,sharpness:20}));
  const pass=currentPass({...locked,settings:{...locked.settings,deblur:10,refinement:0,sharpness:0}});
  expect(pass).toMatchObject({deblur:0,refinement:0,sharpness:0});
  const input=pixels(24,12,x=>{const v=x%2?110:145;return[v,v,v,255];});
  expect(adjustPixels(input,pass,24,12)).toEqual(input);
  // Older saved recipes can still carry negative relative values.
  expect(adjustPixels(input,{deblur:-35,refinement:-40,sharpness:-20,relative:true},24,12)).toEqual(input);
});

it('has the same filter result when an image is transposed, including boundaries',()=>{
  const input=pixels(17,11,(x,y)=>{const v=90+(x*9+y*3)%70;return[v,v,v,255];});
  const transpose=(data,w,h)=>pixels(h,w,(x,y)=>Array.from(data.slice((x*w+y)*4,(x*w+y)*4+4)));
  const normal=adjustPixels(input,{deblur:80},17,11);
  const other=transpose(adjustPixels(transpose(input,17,11),{deblur:80},11,17),11,17);
  for(let i=0;i<normal.length;i++)expect(Math.abs(normal[i]-other[i])).toBeLessThanOrEqual(1);
});
