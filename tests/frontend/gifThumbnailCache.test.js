import {describe,expect,it,vi} from 'vitest';
import {createGifThumbnailCache} from '../../src/gifThumbnailCache';
const frame=id=>({id,file:{name:`${id}.png`}});
const options={width:512,height:512,fit:'cover',background:'#fff',maxSide:320};
const result=()=>({blob:new Blob(['png']),width:320,height:320,sourceWidth:2048,sourceHeight:2048});

describe('GIF thumbnail cache',()=>{
  it('shares identical source pixels while preserving separate animation frames',async()=>{
    const render=vi.fn().mockResolvedValue(result()),cache=createGifThumbnailCache({render});
    const first={...frame('one'),hash:'same-content'},second={...frame('two'),hash:'same-content'};
    expect(cache.get(first,options)).toBe(cache.get(second,options));
    await cache.get(second,options);
    cache.retain([second],options);
    expect(cache.peek(second,options)).toMatchObject({width:320});
    expect(render).toHaveBeenCalledOnce();
  });
  it('limits decodes to two and reuses requests and completed previews',async()=>{
    const releases=[];
    const render=vi.fn(()=>new Promise(resolve=>releases.push(()=>resolve(result()))));
    const cache=createGifThumbnailCache({render});
    const one=frame('one'), a=cache.get(one,options), b=cache.get(frame('two'),options), c=cache.get(frame('three'),options);
    expect(cache.get(one,options)).toBe(a);
    await vi.waitFor(()=>expect(render).toHaveBeenCalledTimes(2));
    releases[0](); await a;
    await vi.waitFor(()=>expect(render).toHaveBeenCalledTimes(3));
    releases[1]();releases[2](); await Promise.all([b,c]);
    expect(await cache.get(one,options)).toBe(await a);
    expect(render).toHaveBeenCalledTimes(3);
  });
  it('skips removed queued frames and discards obsolete active results',async()=>{
    let finish;
    const render=vi.fn(()=>new Promise(resolve=>{finish=()=>resolve(result());}));
    const cache=createGifThumbnailCache({render,concurrency:1});
    const a=cache.get(frame('one'),options).catch(error=>error.name);
    const b=cache.get(frame('two'),options).catch(error=>error.name);
    await vi.waitFor(()=>expect(render).toHaveBeenCalledTimes(1));
    cache.clear(); finish();
    expect(await a).toBe('AbortError');expect(await b).toBe('AbortError');
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('retries failures explicitly while leaving healthy frames cached',async()=>{
    const render=vi.fn().mockRejectedValueOnce(new Error('decode failed')).mockResolvedValue(result());
    const cache=createGifThumbnailCache({render}), source=frame('one');
    await expect(cache.get(source,options)).rejects.toThrow('decode failed');
    await expect(cache.get(source,options)).rejects.toThrow('decode failed');
    expect(render).toHaveBeenCalledTimes(1);
    cache.invalidate(source);
    await expect(cache.get(source,options)).resolves.toMatchObject({width:320});
    expect(render).toHaveBeenCalledTimes(2);
  });
  it('regenerates for changed crop or size and bounds retained previews',async()=>{
    const render=vi.fn().mockImplementation(async()=>result());
    const cache=createGifThumbnailCache({render,maxBytes:5}), source=frame('one');
    await cache.get(source,options);
    await cache.get(frame('two'),options);
    expect(cache.peek(source,options)).toBeUndefined();
    await cache.get(source,{...options,fit:'contain'});
    await cache.get(source,{...options,maxSide:640});
    expect(render).toHaveBeenCalledTimes(4);
    cache.retain([source],options);
    expect(cache.peek(source,{...options,maxSide:640})).toBeUndefined();
  });
});
