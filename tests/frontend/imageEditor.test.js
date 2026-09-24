import { describe, expect, it } from "vitest";
import { adjustPixels, DEFAULT_ADJUSTMENTS, editedFilename, normalizeAdjustments, blurPixels } from "../../src/imageEditor";

describe("non-destructive image adjustments", () => {
  it("returns identical neutral pixels including transparency without sharing the source buffer", () => {
    const pixels = new Uint8ClampedArray([220, 80, 30, 127, 17, 93, 254, 0]);
    const result = adjustPixels(pixels, DEFAULT_ADJUSTMENTS);
    expect([...result]).toEqual([...pixels]);
    result[0] = 0;
    expect(pixels[0]).toBe(220);
  });
  it("reduces excess red while preserving neutral and blue pixels and alpha", () => {
    const pixels = new Uint8ClampedArray([220, 80, 80, 127, 90, 90, 90, 255, 0, 20, 200, 0]);
    expect([...adjustPixels(pixels, { red: 100 })]).toEqual([80, 80, 80, 127, 90, 90, 90, 255, 0, 20, 200, 0]);
    expect(pixels[0]).toBe(220);
  });
  it("exposure applies a stop in linear light and retains alpha", () => {
    const lower = adjustPixels(new Uint8ClampedArray([188, 188, 188, 97]), { exposure: -1 });
    expect(lower[0]).toBeCloseTo(137, 0);
    expect(lower[3]).toBe(97);
  });
  it("contrast separates dark/light values without moving pixels", () => {
    const pixels = new Uint8ClampedArray([50, 50, 50, 255, 200, 200, 200, 50]);
    const result = adjustPixels(pixels, { contrast: 50 });
    expect(result.length).toBe(pixels.length);
    expect(result[0]).toBeLessThan(50); expect(result[4]).toBeGreaterThan(200);
    expect(result[3]).toBe(255); expect(result[7]).toBe(50);
  });
  it("can remove saturation, bounds invalid settings and names a new copy", () => {
    const result = adjustPixels(new Uint8ClampedArray([255, 0, 0, 255]), { saturation: -100 });
    expect(result[0]).toBe(result[1]); expect(result[1]).toBe(result[2]);
    expect(normalizeAdjustments({ red: 500, exposure: -100, contrast: NaN, saturation: Infinity })).toMatchObject({ red: 100, exposure: -3, contrast: 0, saturation: 0 });
    expect(editedFilename("source.photo.jpg")).toBe("source.photo-edited.png");
  });
});


describe('tone ranges and texture', () => {
  const grays = new Uint8ClampedArray([20,20,20,99, 100,100,100,123, 220,220,220,200]);
  it('whites and blacks primarily affect their respective tonal ends', () => {
    const whites=adjustPixels(grays,{whites:30}),blacks=adjustPixels(grays,{blacks:30});
    expect(whites[8]-220).toBeGreaterThan(whites[0]-20);
    expect(blacks[0]-20).toBeGreaterThan(blacks[8]-220);
    expect([...whites.filter((_,i)=>i%4===3)]).toEqual([99,123,200]);
  });
  it('lifts shadows and reduces highlights with different tonal weighting', () => {
    const shadows=adjustPixels(grays,{shadows:30}),highlights=adjustPixels(grays,{highlights:-30});
    expect(shadows[0]-20).toBeGreaterThan(shadows[8]-220);
    expect(220-highlights[8]).toBeGreaterThan(20-highlights[0]);
  });
  it('warms neutral tones and adds magenta tint', () => {
    const pixels=new Uint8ClampedArray([120,120,120,90]);
    const warm=adjustPixels(pixels,{temperature:70}),tint=adjustPixels(pixels,{tint:70});
    expect(warm[0]).toBeGreaterThan(warm[2]);expect(tint[0]).toBeGreaterThan(tint[1]);expect(warm[3]).toBe(90);
  });
  it('sharpens a soft edge without changing size or transparency', () => {
    const pixels=new Uint8ClampedArray([50,50,50,255,90,90,90,255,150,150,150,255,190,190,190,255]);
    const sharp=adjustPixels(pixels,{deblur:80},4,1);
    expect(sharp.length).toBe(pixels.length);expect(sharp[0]).toBeLessThan(pixels[0]);expect(sharp[12]).toBeGreaterThan(pixels[12]);
    expect([...pixels]).toEqual([50,50,50,255,90,90,90,255,150,150,150,255,190,190,190,255]);
    expect([...sharp.filter((_,i)=>i%4===3)]).toEqual([255,255,255,255]);
  });
  it('ignores invisible RGB in texture filters and preserves flat colors', () => {
    const transparent=new Uint8ClampedArray([255,0,0,0,100,100,100,255,100,100,100,255]);
    const blur=blurPixels(transparent,3,1,1);expect(blur[4]).toBeCloseTo(100,0);expect(blur[5]).toBeCloseTo(100,0);
    const flat=new Uint8ClampedArray(10*10*4).fill(100);for(let i=3;i<flat.length;i+=4)flat[i]=255;
    expect([...adjustPixels(flat,{clarity:70,sharpness:60,refinement:40},10,10)]).toEqual([...flat]);
  });
});
