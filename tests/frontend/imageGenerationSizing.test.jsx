import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import ImageGenerationSizing from '../../src/components/ImageGenerationSizing';
import {ASPECT_RATIOS} from '../../src/components/ImageResolutionControls';
import {fitDimensions,ratioSizes} from '../../src/imageDimensions';
import {imageSizeLimits} from '../../src/imageGenerationLimits';
import {imageRequest,validateImageSelection} from '../../src/chatImageGeneration';
import {defaultImageSettings} from '../../src/preferences';

const catalog={models:[{id:'test'}],loras:[],runtime:{ready:true,resolution_limits:{min_side:256,standard_max_side:1536,extended_max_side:2048}}};
describe('shared generation sizes',()=>{
  it('exposes a separate ratio and resolution selector and gates large options',()=>{
    const normal=renderToStaticMarkup(<ImageGenerationSizing width={1024} height={1024} onChange={()=>{}}/>);
    const extended=renderToStaticMarkup(<ImageGenerationSizing width={1024} height={1024} allowLongWait onChange={()=>{}}/>);
    expect(normal).toContain('aria-label="Aspect ratio"');
    expect(normal).toContain('aria-label="Resolution"');
    expect(normal).toContain('value="256x256"');
    expect(normal).not.toContain('value="2048x2048"');
    expect(extended).toContain('value="2048x2048"');
  });
  it.each(ASPECT_RATIOS)('keeps %s:%s precise at both ends of the scale', (w,h)=>{
    for(const allow of [false,true]){
      const bounds=imageSizeLimits(allow),sizes=ratioSizes(w,h,bounds);
      expect(sizes.length).toBeGreaterThan(1);
      for(const size of sizes){
        expect(size.width/size.height).toBeCloseTo(w/h,8);
        for(const side of [size.width,size.height]){expect(side%8).toBe(0);expect(side).toBeGreaterThanOrEqual(bounds.min);expect(side).toBeLessThanOrEqual(bounds.max);}
      }
    }
  });
  it('shrinks a large landscape within normal limits without changing its ratio',()=>{
    const result=fitDimensions(2048,1152,imageSizeLimits(false));
    expect(result).toEqual({width:1536,height:864});
  });
  it('validates and transmits the opt-in and actual selected dimensions',()=>{
    const settings={...defaultImageSettings,modelId:'test',prompt:'A forest',width:2048,height:1152};
    expect(()=>validateImageSelection(settings,catalog)).toThrow('longer waits');
    const extended={...settings,allowLongWait:true};
    expect(()=>validateImageSelection(extended,catalog)).not.toThrow();
    expect(imageRequest(extended,'test')).toMatchObject({width:2048,height:1152,allow_long_wait:true});
    expect(()=>validateImageSelection({...settings,width:256,height:256},catalog)).not.toThrow();
    const smallCard={...catalog,runtime:{...catalog.runtime,resolution_limits:{standard_max_side:1024,extended_max_side:1280}}};
    expect(()=>validateImageSelection(extended,smallCard)).toThrow('1280');
  });
});
