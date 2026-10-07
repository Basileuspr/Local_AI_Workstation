import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {openEditorImage} from '../../src/imageEditorSession';

let worker,bitmap;
const file={type:'image/png',size:64,name:'fixture.png'};
beforeEach(()=>{
  vi.useFakeTimers();
  bitmap={width:2,height:2,close:vi.fn()};
  vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));
  vi.stubGlobal('Worker',class {
    constructor(){worker=this;this.terminate=vi.fn();}
    postMessage(data){if(data.action==='load')queueMicrotask(()=>this.onmessage({data:{id:data.id,blob:'pixels',width:2,height:2}}));}
  });
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('rejects all pending edits on worker failure and refuses reuse',async()=>{
  const session=await openEditorImage(file);
  const edit=session.request('preview',{}),exported=session.request('export',{});
  const failures=Promise.all([expect(edit).rejects.toThrow('worker failed'),expect(exported).rejects.toThrow('worker failed')]);
  worker.onerror();await failures;
  await expect(session.request('preview',{})).rejects.toThrow('Reopen');
  session.close();expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it('clears a stuck worker deadline and rejects a response decoding failure',async()=>{
  const session=await openEditorImage(file);
  const pending=session.request('preview',{});
  const failed=expect(pending).rejects.toThrow('could not be read');
  worker.onmessageerror();await failed;
  expect(vi.getTimerCount()).toBe(0);
});
it('times out a hung edit and permits reopening with a fresh worker',async()=>{
  const session=await openEditorImage(file);
  const pending=session.request('preview',{});
  const failed=expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(120000);await failed;
  const old=worker;
  const reopened=await openEditorImage(file);
  expect(worker).not.toBe(old);reopened.close();
});
it('releases decoded pixels if worker construction fails',async()=>{
  vi.stubGlobal('Worker',class {constructor(){throw Error('Worker unavailable');}});
  await expect(openEditorImage(file)).rejects.toThrow('Worker unavailable');
  expect(bitmap.close).toHaveBeenCalledOnce();
});
it('rejects a synchronous postMessage failure instead of leaking a pending promise',async()=>{
  const session=await openEditorImage(file);
  worker.postMessage=()=>{throw Error('Cannot transfer');};
  await expect(session.request('preview',{})).rejects.toThrow('Cannot transfer');
  expect(worker.terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
