import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import ImageGenerationForm,{mobileImageSubmission} from '../../web/src/ImageGenerationForm';
import {defaultImageSettings} from '../../../src/preferences';
import {imageRequest} from '../../../src/chatImageGeneration';
const catalog={models:[{id:'sdxl'}],loras:[{id:'adapter',base_model_id:'sdxl',name:'Fixture adapter'}],runtime:{ready:true,resolution_limits:{min_side:256,standard_max_side:1024,extended_max_side:1536}}};
it('uses the desktop serializer for every mobile generation parameter without exposing output folders',()=>{
  const settings={...defaultImageSettings,modelId:'sdxl',prompt:' Scene ',negativePrompt:'Blur',width:768,height:1024,steps:200,guidanceScale:5.6,seed:0,loraId:'adapter',loraScale:.75,longPrompt:false,allowLongWait:true,outputDir:'private-desktop-folder'};
  const {request_id,model_id,output_dir,...expected}=imageRequest(settings);
  expect(mobileImageSubmission(settings,catalog)).toEqual({...expected,model:model_id});
  expect(()=>mobileImageSubmission({...settings,width:2048},catalog)).toThrow('Width and height');
  expect(()=>mobileImageSubmission({...settings,loraId:'missing'},catalog)).toThrow('compatible');
});
it('renders shared defaults, hardware bounds, aspect ratios and the full desktop step range',()=>{
  const html=renderToStaticMarkup(<ImageGenerationForm settings={{...defaultImageSettings,modelId:'sdxl'}} onChange={()=>{}} catalog={catalog}/>);
  expect(defaultImageSettings.width).toBe(1024);
  expect(html).toContain('aria-label="Aspect ratio"');
  expect(html).toContain('value="9:16"');
  expect(html).toContain('aria-label="Width" type="number" min="256" max="1024"');
  expect(html).toContain('aria-label="Steps" type="number" min="1" max="200"');
  expect(html).toContain('aria-label="Guidance" type="number" min="1" max="30" step="0.1"');
  expect(html).toContain('Both prompts and your settings stay in place');
});
