import {afterEach, describe, expect, it, vi} from 'vitest';
import {imageGenerationTasks} from '../../src/api';
import {canReloadGeneratedSession, newerImageTaskSnapshot} from '../../src/imageTaskState';
import {emptyGenerationHistory, generationHistoryReducer as reduce} from '../../src/generationHistory';

afterEach(() => vi.unstubAllGlobals());
describe('generation response ordering and retries', () => {
  it('rejects a delayed POST snapshot after polling has seen completion', () => {
    const completed = {backend_id:'run-a',snapshot_sequence:8,tasks:[{status:'completed'}]};
    expect(newerImageTaskSnapshot(completed,{backend_id:'run-a',snapshot_sequence:3,tasks:[{status:'queued'}]})).toBe(completed);
    expect(newerImageTaskSnapshot(completed,{...completed})).toBe(completed);
    const restarted = {backend_id:'run-b',snapshot_sequence:1,tasks:[]};
    expect(newerImageTaskSnapshot(completed,restarted)).toBe(restarted);
  });
  it('replaying batch acceptance preserves completed, failed and removed positions', () => {
    const start={type:'start-batch',id:'batch',requestIds:['one','two','three']};
    let state=reduce(emptyGenerationHistory,start);
    state=reduce(state,{type:'complete',image:{url:'/one.png',batch_id:'batch',request_id:'one'}});
    state=reduce(state,{type:'batch-failed',batchId:'batch',requestId:'two',error:'failed'});
    state=reduce(state,{type:'batch-failed',batchId:'batch',requestId:'three',cancelled:true});
    expect(reduce(state,start).batch.slots.map(slot=>slot.status)).toEqual(['complete','failed','stopped']);
    state=reduce(state,{type:'remove',urls:['/one.png']});
    expect(reduce(state,start).batch.slots[0].status).toBe('removed');
  });
  it('does not reload over a newer edit, revision, navigation or active chat response', () => {
    const before={currentSessionId:'chat',sessionRevision:'one',conversationHistory:[],isGenerating:false};
    expect(canReloadGeneratedSession(before,{...before})).toBe(true);
    for (const changes of [{currentSessionId:'other'},{sessionRevision:'two'},{conversationHistory:[]},{isGenerating:true}]) {
      expect(canReloadGeneratedSession(before,{...before,...changes})).toBe(false);
    }
  });
  it('retries a lost submission response once with exactly the same identities and settings', async () => {
    const fetch=vi.fn().mockRejectedValueOnce(new TypeError('Connection lost')).mockResolvedValue({ok:true,json:async()=>({tasks:[]})});
    vi.stubGlobal('fetch',fetch);
    const submission={batch_id:'batch',requests:[{request_id:'one',session_id:'chat',prompt:'Neutral fixture'}]};
    await expect(imageGenerationTasks('client',submission)).resolves.toEqual({tasks:[]});
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  });
  it.each([400,409,422])('never retries a submission rejected with HTTP %s', async status => {
    const fetch=vi.fn(async()=>({ok:false,status,json:async()=>({detail:'Rejected'})}));
    vi.stubGlobal('fetch',fetch);
    await expect(imageGenerationTasks('client',{requests:[]})).rejects.toMatchObject({status});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('bounds retries when the server remains unavailable', async () => {
    const fetch=vi.fn(async()=>({ok:false,status:503,json:async()=>({detail:'Unavailable'})}));
    vi.stubGlobal('fetch',fetch);
    await expect(imageGenerationTasks('client',{requests:[]})).rejects.toMatchObject({status:503});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
