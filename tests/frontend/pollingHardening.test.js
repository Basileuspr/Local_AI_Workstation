import {afterEach,expect,it,vi} from 'vitest';
import {createPollingObserver} from '../../src/polling';
import {busyRuntime, inventoryDelay} from '../../src/pollingPolicies';
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
it('keeps active clocks updating on unchanged replies and clears a transient connection error',async()=>{
  vi.useFakeTimers();
  const value={jobs:[{status:'running'}]}, data=vi.fn(), error=vi.fn();
  const read=vi.fn().mockResolvedValueOnce({value,etag:'one'}).mockRejectedValueOnce(Error('offline')).mockResolvedValue({unchanged:true});
  const observer=createPollingObserver({read,interval:()=>1000,active:v=>v?.jobs.some(job=>job.status==='running')});
  const detach=observer.subscribe({data,error});await vi.advanceTimersByTimeAsync(2000);
  expect(error).toHaveBeenCalledOnce();expect(data).toHaveBeenCalledTimes(2);expect(data).toHaveBeenLastCalledWith(value);
  detach();expect(vi.getTimerCount()).toBe(0);
});
it('refreshes on focus, reconnect and visibility return and removes every listener when detached',async()=>{
  vi.useFakeTimers();
  const host=new EventTarget(),page=new EventTarget();page.hidden=false;
  const addHost=vi.spyOn(host,'addEventListener'),removeHost=vi.spyOn(host,'removeEventListener');
  const addPage=vi.spyOn(page,'addEventListener'),removePage=vi.spyOn(page,'removeEventListener');
  const read=vi.fn().mockResolvedValue({value:{jobs:[]},etag:'one'});
  const observer=createPollingObserver({read,interval:()=>30000,window:host,document:page});
  const detach=observer.subscribe({data:()=>{}});await vi.advanceTimersByTimeAsync(0);
  for(const event of ['focus','online']) {host.dispatchEvent(new Event(event));await vi.advanceTimersByTimeAsync(0);}
  page.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(4);expect(read.mock.calls.at(-1)[0].etag).toBeUndefined();
  detach();expect(removeHost.mock.calls).toEqual(addHost.mock.calls);expect(removePage.mock.calls).toEqual(addPage.mock.calls);
  host.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(30000);expect(read).toHaveBeenCalledTimes(4);
});
it('keeps video queues and workflow runtime activity polling while work is active',()=>{
  expect(inventoryDelay('queue',{jobs:[{kind:'media-generation',status:'running'}]},{hidden:true})).toBe(750);
  expect(busyRuntime({workflows:{active_runs:[{status:'running'}]}})).toBe(true);
});
