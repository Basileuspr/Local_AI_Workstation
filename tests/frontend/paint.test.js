import {expect,it} from 'vitest';
import {floodPaint,hexRGBA,paintDimensions,encodePaintBMP,paintRect} from '../../src/paintPixels';
import {paintFileName} from '../../src/paintFiles';
const pixels=(width,height,data)=>({width,height,data:new Uint8ClampedArray(data)});
it('fill respects alpha boundaries and selection masks',()=>{
  const image=pixels(3,1,[255,255,255,0,255,255,255,255,255,255,255,0]);
  expect(floodPaint(image,0,0,[20,30,40,255])).toBe(true);
  expect([...image.data.slice(4)]).toEqual([255,255,255,255,255,255,255,0]);
  const mask=new Uint8ClampedArray(12); mask[3]=255;
  expect(floodPaint(image,1,0,[0,0,0,255],255,mask)).toBe(false);
});
it('bounds image and layer memory before allocating',()=>{
  expect(()=>paintDimensions(8192,8192)).toThrow();
  expect(()=>paintDimensions(8192,1,17)).toThrow();
  expect(()=>paintDimensions(NaN,800)).toThrow();
  expect(()=>paintDimensions(1200,800,4)).not.toThrow();
});
it('encodes BMP rows, BGR color and padding correctly',()=>{
  const output=encodePaintBMP(pixels(1,2,[255,0,0,255,0,0,255,255]));
  const bytes=new Uint8Array(output),view=new DataView(bytes.buffer);
  expect([...bytes.slice(0,2)]).toEqual([66,77]);
  expect(view.getUint32(18,true)).toBe(1);expect(view.getUint32(22,true)).toBe(2);
  expect([...bytes.slice(54,62)]).toEqual([255,0,0,0,0,0,255,0]);
});
it('normalizes file names and clamps selection to canvas',()=>{
  expect(paintFileName('C:\\temp\\photo.webp','jpeg')).toBe('photo.jpg');
  expect(paintRect({x:-10,y:5},{x:50,y:100},40,30)).toEqual({x:0,y:5,width:40,height:25});
  expect(hexRGBA('#ff0000',50)).toEqual([255,0,0,127]);
});
