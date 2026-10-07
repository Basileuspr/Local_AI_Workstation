import {expect, it} from 'vitest';
import {imageToolsSize, imageToolsGridSizes, preferredImageGrid, imageToolsOrder} from '../../src/imageToolsSizing';

const options={standardize:true,width:1024,height:1024,layout:'grid',columns:11,gap:3,frame_delay:100};
it('accepts the original 297-image PNG at its requested dimensions, including gaps',()=>{
  const value=imageToolsSize(297,options);
  expect(value.stitched).toMatchObject({width:11294,height:27726});
  expect(value.error).toBe('');
  expect(value.reduced).toBe(false);
  expect(imageToolsGridSizes(297,options).every(grid=>!grid.error)).toBe(true);
});
it('fits the reported grid automatically without altering requested copy dimensions',()=>{
  const result=imageToolsSize(297,{...options,size_mode:'fit'});
  expect(result.error).toBe('');expect(result.reduced).toBe(true);
  expect(result.stitched.pixels).toBeLessThanOrEqual(64000000);
  expect(result.stitched.tile_width).toBeLessThan(1024);
  expect(options.width).toBe(1024);
});
it('supports incomplete final rows and auto sheets beyond the old count cap',()=>{
  const result=imageToolsSize(1001,{...options,columns:0,size_mode:'pages',images_per_sheet:60});
  expect(result.error).toBe('');expect(result.sheetCount).toBeGreaterThan(1);
  expect(result.sheets.reduce((sum,sheet)=>sum+sheet.count,0)).toBe(1001);
  expect(result.sheets.every(sheet=>sheet.pixels<=64000000)).toBe(true);
  expect(imageToolsSize(7,{...options,width:16,height:16,columns:3}).stitched.rows).toBe(3);
});
it('reduces auto sheet columns when large tiles would exceed even one row',()=>{
  const result=imageToolsSize(60,{...options,width:4096,height:4096,columns:0,size_mode:'pages',images_per_sheet:60,gap:0});
  expect(result.error).toBe('');expect(result.sheets.every(sheet=>sheet.tile_width===4096)).toBe(true);
});
it('accounts for WebP edges and full-fill geometry',()=>{
  const records=Array.from({length:7},(_,i)=>({id:String(i),width:i<3?40:20,height:i<3?20:40}));
  const result=imageToolsSize(7,{...options,width:16,height:16,columns:3,gap:0,layout:'balanced',size_mode:'fit'},records);
  expect(result.error).toBe('');expect(result.stitched).toMatchObject({width:48,height:32,rows:2});
  expect(imageToolsSize(20,{...options,width:1000,height:1,gap:0,layout:'horizontal',format:'webp',size_mode:'fit'}).stitched.width).toBeLessThanOrEqual(16383);
});
it('uses a repeatable seeded shuffle without dropping or duplicating sources',()=>{
  const records=Array.from({length:10},(_,i)=>i);
  const shuffled=imageToolsOrder(records,{order:'shuffle',shuffle_seed:42});
  expect(shuffled).toEqual([0,4,6,5,2,8,1,9,7,3]);
  expect([...shuffled].sort((a,b)=>a-b)).toEqual(records);
  expect(imageToolsOrder(records,{order:'shuffle',shuffle_seed:43})).not.toEqual(shuffled);
});
it('enables fitting grids and chooses a fitting initial grid instead of an oversized strip',()=>{
  const grids=imageToolsGridSizes(297,{...options,width:256,height:256});
  expect(grids.find(grid=>grid.columns===1).error).toBe('');
  expect(grids.find(grid=>grid.columns===11).error).toBe('');
  expect(grids.find(grid=>grid.columns===preferredImageGrid(grids)).error).toBe('');
});
it('keeps large PNG sizes exact while enforcing actual JPEG and WebP edges',()=>{
  expect(imageToolsSize(64,{...options,width:1000,height:1000,columns:8,gap:0}).error).toBe('');
  expect(imageToolsSize(64,{...options,width:1000,height:1000,columns:8,gap:1}).error).toBe('');
  const strip={...options,layout:'horizontal',width:6553,height:1,gap:0};
  expect(imageToolsSize(10,strip).error).toBe('');
  expect(imageToolsSize(10,{...strip,gap:1}).error).toBe('');
  expect(imageToolsSize(10,{...strip,format:'jpg'}).error).toContain('65,500');
  expect(imageToolsSize(10,{...strip,format:'webp'}).error).toContain('16,383');
});
it('bounds dimensions and GIF frame memory before submission',()=>{
  expect(imageToolsSize(2,{...options,width:NaN}).error).toContain('whole-number');
  expect(imageToolsSize(2,{...options,width:1.5}).error).toContain('whole-number');
  expect(imageToolsSize(2,{...options,width:6000,height:4001,columns:2}).error).toBe('');
  expect(imageToolsSize(32,{...options,layout:'gif'}).error).toBe('');
  expect(imageToolsSize(33,{...options,layout:'gif'}).error).toContain('128 MiB');
  expect(imageToolsSize(2,{...options,layout:'gif',frame_delay:10}).error).toContain('frame delay');
});
