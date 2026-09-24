import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {buildImageBatch,batchLabel} from '../../src/imageBatch';
import {resizeDimensions,ratioSizes,fitDimensions} from '../../src/imageDimensions';
import {resolveStageSources,sourceDimensions,stageWithProvider} from '../../src/imageWorkflow';
import {defaultImageSettings} from '../../src/preferences';
import LoraHelp from '../../src/components/LoraHelp';

it('captures exact seed sequences and simultaneous increments without mutating current settings',()=>{
 const settings={...defaultImageSettings,seed:1,steps:20,guidanceScale:5};
 const rows=buildImageBatch(settings,4,{seed:1,steps:5,guidanceScale:.1});
 expect(rows.map(r=>r.seed)).toEqual([1,2,3,4]);expect(rows.map(r=>r.steps)).toEqual([20,25,30,35]);
 expect(rows.map(r=>r.guidanceScale)).toEqual([5,5.1,5.2,5.3]);expect(settings.steps).toBe(20);
 expect(batchLabel(rows[3],3,4)).toContain('Seed 4');
});
it('preserves random seeds when disabled, supports decreasing sweeps, and rejects overshoot instead of duplicate clamping',()=>{
 expect(buildImageBatch(defaultImageSettings,3,{}).map(r=>r.seed)).toEqual(['','','']);
 expect(buildImageBatch({...defaultImageSettings,seed:3},3,{seed:-1}).map(r=>r.seed)).toEqual([3,2,1]);
 expect(()=>buildImageBatch({...defaultImageSettings,seed:2147483647},2,{seed:1})).toThrow('Image 2');
 expect(()=>buildImageBatch(defaultImageSettings,33)).toThrow('1–32');
 expect(()=>buildImageBatch(defaultImageSettings,2,{loraScale:.1})).toThrow('Select a LoRA');
 expect(()=>buildImageBatch(defaultImageSettings,2,{seed:.5})).toThrow('whole');
});
it('allows 512 square and scales both dimensions without changing a locked ratio or breaking bounds',()=>{
 expect(resizeDimensions({width:1024,height:1024},'width',512)).toEqual({width:512,height:512});
 const sizes=ratioSizes(1280,720);for(const s of sizes){expect(s.width/s.height).toBe(16/9);expect(s.width%8).toBe(0);expect(s.height%8).toBe(0);expect(Math.min(s.width,s.height)).toBeGreaterThanOrEqual(512);expect(Math.max(s.width,s.height)).toBeLessThanOrEqual(1536);}
 expect(resizeDimensions({width:512,height:512},'width',799,{locked:false})).toEqual({width:800,height:512});
 expect(fitDimensions(640,400)).toEqual({width:640,height:400});expect(fitDimensions(10000,20)).toBeNull();
});
it('keeps previous-image stage connections through edits/reorders while retaining fixed source choices',()=>{
 const a={id:'a',operation:'img2img',width:640,height:400,source:{kind:'asset',id:'asset'}},b={id:'b',operation:'img2img',source_mode:'previous'},text={id:'t',operation:'describe'},c={id:'c',operation:'img2img',source_mode:'previous'};
 expect(resolveStageSources([a,b,text,c]).at(-1).source).toEqual({kind:'stage',id:'b'});
 expect(resolveStageSources([a,c,b]).at(-1).source).toEqual({kind:'stage',id:'c'});
 expect(resolveStageSources([{...b,source_mode:'selected',source:{kind:'asset',id:'asset'}},a])[0].source).toEqual({kind:'asset',id:'asset'});
 expect(resolveStageSources([b])[0].source).toBeNull();
 const flow={assets:[{id:'asset',width:640,height:400}],stages:[a]};
 expect(sourceDimensions(flow,{kind:'stage',id:'a'})).toEqual({width:640,height:400});
 expect(stageWithProvider(flow,'img2img',{providers:[]})).toMatchObject({source_mode:'previous',width:640,height:400,lock_aspect_ratio:true});
});
it('makes learning-rate strength and the guide visible',()=>{
 const html=renderToStaticMarkup(<LoraHelp learningRate={.00005}/>);
 expect(html).toContain('Settings guide');expect(html).toContain('0.5');expect(html).toContain('1e-4');expect(html).toContain('10× default');expect(html).toContain('Learning rate changes training');
});
