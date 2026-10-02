import { describe, expect, it } from 'vitest';
import { validateImageSelection } from '../../src/chatImageGeneration';
import { defaultImageSettings } from '../../src/preferences';

const model = {id:'verboa',dimension_multiple:16,supports_lora_training:false};
const catalog = {models:[model],loras:[],runtime:{ready:true}};
const settings = {...defaultImageSettings,modelId:'verboa',prompt:'A mountain lake',loraId:'',width:512,height:512};

describe('ERNIE image requests', () => {
  it('accepts normal text generation', () => {
    expect(() => validateImageSelection(settings,catalog)).not.toThrow();
  });
  it('rejects SDXL-sized eight-pixel increments before sending', () => {
    expect(() => validateImageSelection({...settings,width:520},catalog)).toThrow('multiples of 16');
    expect(() => validateImageSelection({...settings,width:520},{...catalog,models:[{id:'verboa'}]})).not.toThrow();
  });
  it('rejects a stale SDXL LoRA even if it appears in the adapter catalog', () => {
    expect(() => validateImageSelection({...settings,loraId:'adapter'}, {
      ...catalog,loras:[{id:'adapter',base_model_id:'verboa'}],
    })).toThrow('SDXL LoRAs');
  });
});
