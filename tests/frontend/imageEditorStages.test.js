import { describe, expect, it } from 'vitest';
import { adjustPixels } from '../../src/imageEditor';
import { currentPass, editRecipe, hasCurrentPass, lockEditStage, newEditState, repeatEditStage, unlockEditStage } from '../../src/imageEditorStages';
import { colorRegion, updateColorSample, removeColorSample } from '../../src/imageEditorColors';

describe('locked editor stages', () => {
  it('locks without applying twice, preserves markers, and applies the next pass to the prior result', () => {
    const source = new Uint8ClampedArray([160,100,70,255]);
    const edit=newEditState({contrast:20,exposure:-.5});
    const locked=lockEditStage(edit);
    expect(hasCurrentPass(locked)).toBe(false);
    expect(locked.anchor.contrast).toBe(20);expect(locked.settings.contrast).toBe(20);
    const initial=adjustPixels(source,currentPass(edit));
    const neutral=adjustPixels(adjustPixels(source,locked.stages[0].pass),currentPass(locked));
    expect([...neutral]).toEqual([...initial]);
    const next={...locked,settings:{...locked.settings,contrast:40}};
    expect(currentPass(next).contrast).toBe(20);
    const result=adjustPixels(initial,currentPass(next));
    expect([...result]).not.toEqual([...initial]);
    expect([...source]).toEqual([160,100,70,255]);
    expect(unlockEditStage(locked)).toEqual(edit);
    expect(editRecipe(next).stages).toHaveLength(1);
  });
  it('repeats a locked pass and can remove the repetition without corrupting the original pass', () => {
    const locked=lockEditStage(newEditState({exposure:-1}));
    const repeated=repeatEditStage(locked);
    expect(repeated.stages).toHaveLength(2);
    expect(repeated.stages[1].pass.exposure).toBe(-1);
    expect(unlockEditStage(repeated)).toEqual(locked);
    const dirty={...locked,settings:{...locked.settings,exposure:-2}};
    expect(repeatEditStage(dirty)).toBe(dirty);
  });
});

describe('reference color application', () => {
  it('colors only a connected enclosed region and retains dark outlines, background and alpha', () => {
    const width=9,height=9,source=new Uint8ClampedArray(width*height*4).fill(255);
    for(let y=2;y<=6;y++)for(let x=2;x<=6;x++)if(y===2||y===6||x===2||x===6){const i=(y*width+x)*4;source[i]=source[i+1]=source[i+2]=0;}
    const result=colorRegion(source,width,height,{x:.5,y:.5,color:[220,160,110],mode:'fill',strength:100,tolerance:10,protectLines:true});
    expect([...result.slice((4*width+4)*4,(4*width+4)*4+4)]).toEqual([220,160,110,255]);
    expect([...result.slice(0,4)]).toEqual([255,255,255,255]);
    expect([...result.slice((2*width+4)*4,(2*width+4)*4+4)]).toEqual([0,0,0,255]);
    expect([...source.slice((4*width+4)*4,(4*width+4)*4+4)]).toEqual([255,255,255,255]);
  });
  it('limits a brush to its spot and preserves transparent pixels', () => {
    const source=new Uint8ClampedArray(100*4).fill(255);source[4*55+3]=0;
    const result=colorRegion(source,10,10,{x:.5,y:.5,color:[100,80,50],mode:'brush',radius:.2,protectLines:true});
    expect([...result.slice(0,4)]).toEqual([255,255,255,255]);
    expect(result[55*4+3]).toBe(0);expect(result[54*4]).toBe(100);
  });
});


describe('independent named color samples',()=>{
  it('changes and removes only the selected sample areas and leaves locked passes intact',()=>{
    const base=newEditState();
    const edit={...base,colorSamples:[...base.colorSamples,{id:'hair',name:'Hair',color:'#112233'}],
      colorEdits:[{sampleId:'sample-1',color:[226,184,153],x:.2,y:.2},{sampleId:'hair',color:[17,34,51],x:.8,y:.8}],
      stages:[{pass:{colorEdits:[{sampleId:'sample-1',color:[226,184,153]}]}}]};
    const changed=updateColorSample(edit,'sample-1',{name:'Skin',color:'#d69f76'});
    expect(changed.colorEdits[0].color).toEqual([214,159,118]);expect(changed.colorEdits[1]).toEqual(edit.colorEdits[1]);
    expect(changed.stages).toBe(edit.stages);expect(changed.colorSamples[0].name).toBe('Skin');
    const removed=removeColorSample(changed,'hair');
    expect(removed.colorEdits).toHaveLength(1);expect(removed.colorSamples).toHaveLength(1);
    expect(edit.colorEdits).toHaveLength(2);expect(removed.stages).toBe(edit.stages);
  });
});


it('keeps sample fill boundaries stable when another sample recolors the separating area',()=>{
  const source=new Uint8ClampedArray([255,255,255,255,200,200,200,255,255,255,255,255]);
  const divider={x:.5,y:0,color:[255,255,255],mode:'fill',tolerance:0,protectLines:false};
  const right={x:.9,y:0,color:[220,100,80],mode:'fill',tolerance:0,protectLines:false};
  const first=colorRegion(source,3,1,divider,source);
  const both=colorRegion(first,3,1,right,source),removed=colorRegion(source,3,1,right,source);
  expect([...both.slice(0,4)]).toEqual([255,255,255,255]);
  expect([...both.slice(8)]).toEqual([...removed.slice(8)]);
  expect([...both.slice(8)]).toEqual([220,100,80,255]);
  expect([...removed.slice(4,8)]).toEqual([200,200,200,255]);
});
