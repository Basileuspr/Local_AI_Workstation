import {afterEach,expect,it,vi} from 'vitest';
import {createPollingObserver} from '../../src/polling';
afterEach(()=>vi.useRealTimers());
it('shares one read, isolates a stale subscriber and fetches fully on reconnect',async()=>{
  vi.useFakeTimers();
  const reads=[],good=vi.fn(),reported=vi.fn();
  const observer=createPollingObserver({read:vi.fn(async options=>{reads.push(options);return {value:{jobs:[]},etag:'one'};}),interval:()=>1000,window:{reportError:reported,addEventListener:()=>{},removeEventListener:()=>{}}});
  const bad=observer.subscribe({data:()=>{throw Error('Stale handler');}});
  const detach=observer.subscribe({data:good});
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toHaveLength(1);expect(good).toHaveBeenCalledOnce();expect(reported).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);expect(reads[1].etag).toBe('one');
  bad();detach();
  const again=observer.subscribe({data:good});
  await vi.advanceTimersByTimeAsync(0);expect(reads.at(-1).etag).toBeUndefined();
  again();expect(vi.getTimerCount()).toBe(0);
});
it('ignores an obsolete failure during invalidation and immediately reads the new state',async()=>{
  vi.useFakeTimers();let reject;
  const read=vi.fn().mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;})).mockResolvedValue({value:{tasks:[]}});
  const error=vi.fn(),data=vi.fn();
  const observer=createPollingObserver({read,interval:()=>1000});
  const detach=observer.subscribe({error,data});await vi.advanceTimersByTimeAsync(0);
  observer.invalidate();reject(Error('Old failure'));await vi.advanceTimersByTimeAsync(0);
  expect(error).not.toHaveBeenCalled();expect(data).toHaveBeenCalledOnce();detach();
});
it('does not publish a response belonging to a detached observer',async()=>{
  vi.useFakeTimers();let resolve;
  const observer=createPollingObserver({read:()=>new Promise(done=>{resolve=done;}),interval:()=>1000});
  const data=vi.fn(),detach=observer.subscribe({data});await vi.advanceTimersByTimeAsync(0);
  detach();resolve({value:{jobs:['stale']}});await vi.advanceTimersByTimeAsync(0);
  expect(data).not.toHaveBeenCalled();expect(observer.getSnapshot()).toBeUndefined();expect(vi.getTimerCount()).toBe(0);
});
