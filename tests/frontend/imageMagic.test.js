import { describe, it, expect } from 'vitest';
import { magicLayout, magicSize, magicOutpaintLayout, magicEditStage, preferredMagicModel, preferredMagicVisionModel, MAGIC_DEFAULTS } from '../../src/imageMagic';

describe('Magic Edit working dimensions', () => {
  it.each([[2048, 1152], [256, 256], [768, 1024]])('fits content inside a selected %s × %s canvas without stretching', (width, height) => {
    const layout = magicLayout(400, 200, {width, height});
    expect(layout).toMatchObject({width,height});
    expect(layout.content.width / layout.content.height).toBeCloseTo(2, 1);
    expect(layout.content.x * 2 + layout.content.width).toBeCloseTo(width, 0);
    expect(layout.content.y * 2 + layout.content.height).toBeCloseTo(height, 0);
  });
  it('raises the reproduced thumbnail failure to SDXL working resolution', () => {
    expect(magicSize(355, 374)).toEqual({ width: 976, height: 1024 });
    expect(magicLayout(355, 374).content).toEqual({ x: 2, y: 0, width: 972, height: 1024 });
  });

  it.each([[512, 512], [355, 374], [640, 400], [16000, 500], [12, 7200], [1, 1]])(
    'fits %s × %s without stretching the content to fill the working canvas', (width, height) => {
      const layout = magicLayout(width, height), content = layout.content;
      for (const value of [layout.width, layout.height]) {
        expect(value).toBeGreaterThanOrEqual(768);
        expect(value).toBeLessThanOrEqual(1024);
        expect(value % 8).toBe(0);
      }
      const scale = 1024 / Math.max(width, height);
      expect(Math.abs(content.width - width * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(content.height - height * scale)).toBeLessThanOrEqual(1);
      expect(content.x).toBeGreaterThanOrEqual(0);
      expect(content.y).toBeGreaterThanOrEqual(0);
      expect(content.x + content.width).toBeLessThanOrEqual(layout.width);
      expect(content.y + content.height).toBeLessThanOrEqual(layout.height);
    },
  );

  it('pads wide sources and uses the same geometry for portrait sources', () => {
    expect(magicLayout(400, 100)).toEqual({ width: 1024, height: 768, content: { x: 0, y: 256, width: 1024, height: 256 } });
    expect(magicLayout(100, 400)).toEqual({ width: 768, height: 1024, content: { x: 256, y: 0, width: 256, height: 1024 } });
  });

  it.each([[0, 512], [-1, 512], [NaN, 512], [Infinity, 512], [512, 0]])(
    'rejects invalid dimensions %s × %s', (width, height) => expect(() => magicSize(width, height)).toThrow('dimensions'),
  );
});

describe('Magic Edit modes and modest defaults',()=>{
  it('keeps generation and post-processing gentle without using the selected Generate adapter',()=>{
    expect(MAGIC_DEFAULTS).toMatchObject({strength:.2,amount:.5,guidance:4,control_scale:.5,reference_scale:.35,upscale_factor:2});
    const size={width:768,height:1024};
    expect(magicEditStage('a','m',size)).toMatchObject({operation:'img2img',provider_slot:'local-sdxl',strength:.2});
    expect(magicEditStage('a','m',size,{mask:'mask'})).toMatchObject({operation:'inpaint',mask_asset_id:'mask'});
    expect(magicEditStage('a','m',size,{mode:'structure',mask:'mask'})).toMatchObject({operation:'controlnet',provider_slot:'local-sdxl-controlnet',mask_asset_id:null,control_input:'source',control_scale:.5});
    expect(magicEditStage('a','m',size,{mode:'references',references:['a','b','a']})).toMatchObject({operation:'multi_reference',reference_asset_ids:['a','b'],reference_scale:.35});
    expect(magicEditStage('a','m',size,{mode:'upscale'})).toMatchObject({operation:'upscale',provider_slot:'local-realesrgan',upscale_factor:2,model_id:''});
    expect(()=>magicEditStage('a','m',size,{mode:'references'})).toThrow('reference');
    expect(()=>magicEditStage('a','m',size,{mode:'unknown'})).toThrow('supported');
  });
  it.each([[1080,1440],[1440,1440],[2400,800],[800,2400]])('extends %s x %s without adding a large padded canvas',(width,height)=>{
    const borders={left:32,right:32,top:32,bottom:32};
    const geometry=magicOutpaintLayout(width,height,{width:1024,height:1024},borders);
    expect(geometry.stageSize.width).toBeLessThanOrEqual(1024);expect(geometry.stageSize.height).toBeLessThanOrEqual(1024);
    expect(geometry.layout.width-geometry.layout.content.width).toBeLessThan(8);
    expect(geometry.layout.height-geometry.layout.content.height).toBeLessThan(8);
    expect(magicEditStage('a','m',geometry.stageSize,{mode:'outpaint',borders})).toMatchObject({operation:'outpaint',outpaint_left:32,outpaint_bottom:32});
  });
  it('rejects empty borders and impossible narrow sources before a run is created',()=>{
    expect(()=>magicOutpaintLayout(500,500,{width:1024,height:1024},{left:0,right:0,top:0,bottom:0})).toThrow('border');
    expect(()=>magicOutpaintLayout(5000,10,{width:1024,height:1024},{left:32,right:32,top:32,bottom:32})).toThrow('narrow');
  });
  it('prefers the demonstrated photo base and preserves explicit selection on refresh',()=>{
    const models=[{id:'stylized'},{id:'dreamshaper-xl-1-0'}];
    expect(preferredMagicModel(models)).toBe('dreamshaper-xl-1-0');
    expect(preferredMagicModel(models,'stylized')).toBe('stylized');
    expect(preferredMagicModel([], 'missing')).toBe('');
    const vision=[{id:'custom'},{id:'qwen3.5:9b'}];
    expect(preferredMagicVisionModel(vision)).toBe('qwen3.5:9b');
    expect(preferredMagicVisionModel(vision,'custom')).toBe('custom');
  });
});
