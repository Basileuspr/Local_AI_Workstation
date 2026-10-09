import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {createReelsAnalyzer}=require('../../electron/reelsAnalyzer');
const account='a'.repeat(64),sourceUrl='https://www.instagram.com/direct/t/fixture/';
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture() {
  let url=sourceUrl,workflow=0,selected='default',tabId='source-tab',revision=0,accountRef=account,gate=null,recoveryGate=null,recoveryError=null;
  const order=[],saved=new Map(),batches=[];
  const page=()=>({accountRef,source:{origin:new URL(url).origin,path:new URL(url).pathname},pageRef:'page',elements:[{role:'video',name:'',elementRef:'element'}]});
  const browser={state:()=>({selected,activeTabId:tabId,revision,url}),startWorkflow:async()=>({workflowId:String(++workflow),page:page()}),
    cancelWorkflow:async()=>{order.push('cancel')},releaseWorkflowMedia:async()=>{order.push('clean')},
    navigate:async next=>{url=next;order.push('exit');return {}},
    restoreWorkflowPage:async(profile,next)=>{expect(profile).toBe(selected);order.push('recover-source');if(recoveryGate)await recoveryGate;if(recoveryError)throw Error(recoveryError);url=next;revision++;return {};},
    browserTool:async v=>{
      if(v.action==='reels')return {reels:[{id:'one',url:'https://www.instagram.com/reel/one/'},{id:'two',url:'https://www.instagram.com/reel/two/'}]};
      if(v.action==='navigate'){url=v.url;revision++;order.push(url===sourceUrl?'exit':'open');return page();}
      if(v.action==='wait')return page();
      if(v.action==='read')return page();
      if(v.action==='capture'){order.push('capture');return {completeness:'complete',audio:'complete',source:page().source};}
      throw Error('unexpected operation');
    }};
  const request=async(action,v={})=>{
    if(action==='state')return {batches:structuredClone(batches),summaries:[...saved.values()]};
    if(action==='create'){const row={...v,id:'b'.repeat(32),status:'ready',items:v.reels.map(url=>({url,identity:url,status:saved.has(url)?'duplicate':'pending'}))};batches.push(row);return structuredClone(row);}
    if(action==='checkpoint'){const b=batches.find(b=>b.id===v.batchId);if(v.status)b.status=v.status;if(v.index!==undefined)b.items[v.index].status=v.itemStatus;return b;}
    if(action==='analyze'){order.push('analyze');if(gate)await gate;const item=batches[0].items[v.index];saved.set(item.url,{summary:'Saved fixture'});item.status='complete';order.push('save');return {};}
    if(action==='clear'){order.push('clear');return {cleared:true};}
    if(action==='cancel'){order.push('stop-local');return {};}
    if(action==='preflight')return {};
    throw Error('unexpected request');
  };
  return {analyzer:createReelsAnalyzer({browser,request}),order,saved,batches,setGate:v=>gate=v,setRecoveryGate:v=>recoveryGate=v,setRecoveryError:v=>recoveryError=v,
    setAccount:v=>accountRef=v,setProfile:v=>selected=v,setTab:v=>tabId=v,setPage:v=>{url=v;revision++;},setSource:()=>url=sourceUrl};
}
async function settle(f){for(let i=0;i<100;i++){if(!(await f.analyzer.state()).active)return;await tick();}throw Error('did not settle');}
describe('durable sequential Reels control',()=>{
  it('reports an account check without returning a list of page controls or account text',async()=>{
    const f=fixture();const result=await f.analyzer.controls({profileId:'default'});
    expect(result).toMatchObject({status:'identified',profileId:'default',tabId:'source-tab'});
    expect(Array.isArray(result)).toBe(false);expect(result.elements).toBeUndefined();expect(result.accountRef).toBeUndefined();
    f.setProfile('other');await expect(f.analyzer.controls({profileId:'default'})).rejects.toThrow(/profile/);
  });
  it('saves, deletes media, exits and then opens the next reel in the same account',async()=>{
    const f=fixture();await f.analyzer.discover({profileId:'default'});f.order.length=0;
    await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});await settle(f);
    expect(f.order).toEqual(['open','capture','analyze','save','cancel','clean','exit','cancel','open','capture','analyze','save','cancel','clean','exit','cancel']);
    expect(f.saved.size).toBe(2);await f.analyzer.clear();expect(f.saved.size).toBe(2);
  });
  it('pauses at the save/cleanup boundary and resumes without repeating a saved reel',async()=>{
    const f=fixture();let release;f.setGate(new Promise(r=>release=r));
    await f.analyzer.discover({profileId:'default'});await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});
    for(let i=0;i<20&&!f.order.includes('analyze');i++)await tick();
    await f.analyzer.pause();release();await settle(f);expect(f.saved.size).toBe(1);expect(f.batches[0].status).toBe('paused');
    f.setGate(null);f.setSource();await f.analyzer.resume({batchId:f.batches[0].id});await settle(f);
    expect(f.saved.size).toBe(2);expect(f.order.filter(x=>x==='analyze')).toHaveLength(2);
  });
  it('rejects changed accounts and overlapping sequences before acquisition',async()=>{
    const f=fixture();await f.analyzer.discover({profileId:'default'});f.setAccount('c'.repeat(64));
    await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});await settle(f);
    expect(f.order).not.toContain('capture');expect((await f.analyzer.state()).error).toMatch(/account changed/);
    f.setProfile('other');await expect(f.analyzer.resume({batchId:f.batches[0].id})).rejects.toThrow(/profile/);
    await expect(f.analyzer.discover({profileId:'default',script:'cookies'})).rejects.toThrow(/Unsupported/);
  });
  it('resumes from a left-open reel by restoring the conversation, skipping the saved result',async()=>{
    const f=fixture();let release;f.setGate(new Promise(r=>release=r));
    await f.analyzer.discover({profileId:'default'});await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});
    for(let i=0;i<20&&!f.order.includes('analyze');i++)await tick();
    await f.analyzer.pause();release();await settle(f);expect(f.saved.size).toBe(1);
    f.setGate(null);f.setPage('https://www.instagram.com/reel/one/');await f.analyzer.resume({batchId:f.batches[0].id});await settle(f);
    expect(f.order.filter(x=>x==='recover-source')).toHaveLength(1);expect(f.order.filter(x=>x==='capture')).toHaveLength(2);expect(f.saved.size).toBe(2);
  });
  it('holds the recovery lease and remains retryable after a navigation failure',async()=>{
    const f=fixture();await f.analyzer.discover({profileId:'default'});await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});await settle(f);
    let release;f.setPage('https://www.instagram.com/reel/two/');f.setRecoveryGate(new Promise(r=>release=r));f.setRecoveryError('Saved page timed out');
    const pending=f.analyzer.resume({batchId:f.batches[0].id});await tick();expect(f.analyzer.busy()).toBe(true);
    await expect(f.analyzer.resume({batchId:f.batches[0].id})).rejects.toThrow(/recovering/);
    await expect(f.analyzer.clear()).rejects.toThrow(/wait for it to stop/);
    release();await expect(pending).rejects.toThrow(/timed out/);expect(f.analyzer.busy()).toBe(false);
    f.setRecoveryError(null);f.setRecoveryGate(null);await f.analyzer.resume({batchId:f.batches[0].id});await settle(f);
    expect(f.order.filter(x=>x==='capture')).toHaveLength(2);expect(f.saved.size).toBe(2);
  });
  it('refuses a changed account after automatic recovery without acquiring more media',async()=>{
    const f=fixture();await f.analyzer.discover({profileId:'default'});await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});await settle(f);
    f.order.length=0;f.setPage('https://www.instagram.com/reel/two/');f.setAccount('e'.repeat(64));
    await expect(f.analyzer.resume({batchId:f.batches[0].id})).rejects.toThrow(/original account/);
    expect(f.order).toContain('recover-source');expect(f.order).not.toContain('capture');expect(f.saved.size).toBe(2);
  });
  it('rejects a query-defined conversation instead of resuming in a different conversation after stripping secrets',async()=>{
    const f=fixture();f.setPage(sourceUrl+'?thread=OTHER&token=PRIVATE');
    await expect(f.analyzer.discover({profileId:'default'})).rejects.toThrow(/stable source address/);
    expect(f.batches).toHaveLength(0);expect(f.order).not.toContain('capture');
  });
  it.each(['tab','page','account'])('pauses on a changed %s during analysis without navigating it',async kind=>{
    const f=fixture();let release;f.setGate(new Promise(r=>release=r));
    await f.analyzer.discover({profileId:'default'});f.order.length=0;
    await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});
    for(let i=0;i<20&&!f.order.includes('analyze');i++)await tick();
    if(kind==='tab')f.setTab('unrelated-tab');
    if(kind==='page')f.setPage('https://www.instagram.com/unrelated/');
    if(kind==='account')f.setAccount('d'.repeat(64));
    release();await settle(f);
    expect(f.order).not.toContain('exit');expect(f.order.filter(x=>x==='open')).toHaveLength(1);
    expect(f.saved.size).toBe(1);expect(f.batches[0].items[0].status).toBe('complete');
    expect(f.batches[0].status).toBe('paused');expect((await f.analyzer.state()).error).toMatch(/changed/);
  });
  it('signals cancellation on a tab switch while inference is pending and holds its lease until inference exits',async()=>{
    const f=fixture();let release;f.setGate(new Promise(r=>release=r));
    await f.analyzer.discover({profileId:'default'});await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});
    for(let i=0;i<20&&!f.order.includes('analyze');i++)await tick();
    f.setTab('unrelated-tab');await new Promise(r=>setTimeout(r,350));
    expect(f.order).toContain('stop-local');expect((await f.analyzer.state()).active).toBeTruthy();
    await expect(f.analyzer.clear()).rejects.toThrow(/wait for it to stop/);
    release();await settle(f);expect(f.order).not.toContain('exit');
  });
  it('detects an account-marker change without navigation while local inference is pending',async()=>{
    const f=fixture();let release;f.setGate(new Promise(r=>release=r));
    await f.analyzer.discover({profileId:'default'});await f.analyzer.start({visionModel:'fixture',whisperModel:'small'});
    for(let i=0;i<20&&!f.order.includes('analyze');i++)await tick();
    f.setAccount('d'.repeat(64));await new Promise(r=>setTimeout(r,400));
    expect(f.order).toContain('stop-local');expect((await f.analyzer.state()).active).toBeTruthy();
    release();await settle(f);expect(f.order).not.toContain('exit');
  });
});
