import { afterEach, describe, expect, it, vi } from "vitest";
import { gifFilename, gifThumbnailFilename, gifThumbnailLayout, renderGifThumbnail, moveGifFrame, validateGifFrames } from "../../src/gifMaker";
afterEach(()=>vi.unstubAllGlobals());

describe("GIF draft", () => {
  it('makes a fitted thumbnail with the selected crop and no stretching', () => {
    expect(gifThumbnailLayout(100,50,512,512,'cover')).toEqual({width:320,height:320,x:-160,y:0,drawWidth:640,drawHeight:320});
    expect(gifThumbnailLayout(100,50,512,512,'contain')).toEqual({width:320,height:320,x:0,y:80,drawWidth:320,drawHeight:160});
    expect(gifThumbnailLayout(100,50,1024,576,'cover')).toMatchObject({width:320,height:180});
    expect(gifThumbnailLayout(100,50,64,64,'cover')).toMatchObject({width:64,height:64});
    expect(()=>gifThumbnailLayout(100,50,0,512)).toThrow('dimensions');
    expect(gifThumbnailLayout(100,50,1024,576,'cover',640)).toMatchObject({width:640,height:360});
    expect(()=>gifThumbnailLayout(100,50,512,512,'cover',99999)).toThrow('thumbnail size');
  });
  it('closes oversized images before creating a canvas',async()=>{
    const close=vi.fn();
    vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:6000,height:5000,close}));
    await expect(renderGifThumbnail({name:'huge.png'},{width:512,height:512})).rejects.toThrow('24 megapixels');
    expect(close).toHaveBeenCalledOnce();
  });
  it('preserves orientation, paints transparency and releases decoded pixels after encoding failure',async()=>{
    const close=vi.fn(),drawImage=vi.fn(),fillRect=vi.fn(),context={drawImage,fillRect};
    const decode=vi.fn().mockResolvedValue({width:2048,height:1024,close});
    vi.stubGlobal('createImageBitmap',decode);
    const canvas={getContext:()=>context,toBlob:callback=>callback(null)};
    vi.stubGlobal('document',{createElement:()=>canvas});
    await expect(renderGifThumbnail({name:'image.png'},{width:512,height:512,fit:'cover',background:'#ff0000',mode:'original',maxSide:640})).rejects.toThrow('Retry');
    expect(decode).toHaveBeenCalledWith({name:'image.png'},{imageOrientation:'from-image'});
    expect([canvas.width,canvas.height]).toEqual([640,320]);
    expect(context.fillStyle).toBe('#ff0000');expect(fillRect).toHaveBeenCalled();expect(drawImage).toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();
  });
  it('gives ZIP thumbnails unique names in frame order',()=>{
    expect(gifThumbnailFilename('same.jpg',0)).toBe('001-same-thumbnail.png');
    expect(gifThumbnailFilename('same.jpg',1)).toBe('002-same-thumbnail.png');
    expect(gifThumbnailFilename('../bad:name.png',2)).toBe('003-.._bad_name-thumbnail.png');
  });
  it("reorders frames without changing source entries and leaves boundary moves alone", () => {
    const frames = [{ id: "red" }, { id: "blue" }, { id: "green" }];
    expect(moveGifFrame(frames, 1, -1).map(frame => frame.id)).toEqual(["blue", "red", "green"]);
    expect(moveGifFrame(frames, 1, 1).map(frame => frame.id)).toEqual(["red", "green", "blue"]);
    expect(moveGifFrame(frames, 0, -1)).toBe(frames);
    expect(frames.map(frame => frame.id)).toEqual(["red", "blue", "green"]);
  });
  it("validates cumulative frame counts, types and upload sizes", () => {
    const file = { type: "image/png", size: 1024 };
    expect(() => validateGifFrames([file, file])).not.toThrow();
    expect(() => validateGifFrames(Array(61).fill(file))).toThrow("60");
    expect(() => validateGifFrames([{ ...file, type: "text/plain" }])).toThrow("PNG");
    expect(() => validateGifFrames([{ ...file, size: 41 * 1024 ** 2 }])).toThrow("40 MiB");
    expect(() => validateGifFrames(Array(5).fill({ ...file, size: 40 * 1024 ** 2 }))).toThrow("160 MiB");
  });
  it("normalizes output filenames", () => {
    expect(gifFilename("My animation.gif")).toBe("My animation.gif");
    expect(gifFilename("../bad:name")).toBe(".._bad_name.gif");
    expect(gifFilename("")).toBe("Animation.gif");
  });
});
