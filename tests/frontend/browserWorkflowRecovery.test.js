import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {beginBrowserWorkflow,workflowCheckpoint} from '../../src/browserWorkflowRecovery';
const require=createRequire(import.meta.url);
const {createBrowserWorkflows,sourceIdentity,checkpointMatches,recoveryAddress}=require('../../electron/browserWorkflows');
const directories=[];
afterEach(()=>{for(const dir of directories.splice(0))fs.rmSync(dir,{recursive:true,force:true});});
function fixture() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'law-recovery-'));directories.push(directory);
  let url='https://example.com/reel/one/',revision=0,account='Owned fixture',selected='default',loading=false,restoreError=null,challenge=false;
  const restored=[],operations=[];
  const wc={getURL:()=>url,isDestroyed:()=>false,isLoading:()=>loading,stop:()=>{loading=false;},
    executeJavaScriptInIsolatedWorld:async(_world,scripts)=>{
      const code=scripts[0].code,request=JSON.parse(code.slice(code.lastIndexOf(')(')+2,-1));operations.push(request.action);
      return {document:'fixture-document-'+revision,account,ready:'complete',challenge,elements:[],text:'Owned fixture'};
    }};
  const options={getContents:()=>wc,getProfileId:()=>selected,getRevision:()=>revision,storagePath:directory,allowRequest:()=>true,
    restorePage:async(profile,next)=>{restored.push({profile,url:next});if(restoreError)throw Error(restoreError);url=next;revision++;}};
  let flows=createBrowserWorkflows(options);
  return {get flows(){return flows;},directory,restored,operations,
    page:next=>{flows.navigation(next);url=next;revision++;},account:next=>account=next,profile:next=>selected=next,
    restoreError:next=>restoreError=next,loading:next=>loading=next,challenge:next=>challenge=next,restart:()=>flows=createBrowserWorkflows(options)};
}
describe('Browser workflow recovery decisions',()=>{
  it('renders safely before the first browser status arrives',()=>{
    expect(workflowCheckpoint({})).toBeNull();expect(workflowCheckpoint(undefined)).toBeNull();
  });
  it.each(['cancelled','completed','failed'])('starts fresh on the current page after a %s workflow',async status=>{
    const desktop={startBrowserWorkflow:vi.fn().mockResolvedValue({workflowId:'new'}),resumeBrowserWorkflow:vi.fn()};
    const current={selected:'default',workflow:{id:'old',profileId:'default',status}};
    await beginBrowserWorkflow(desktop,current);
    expect(desktop.startBrowserWorkflow).toHaveBeenCalledWith({profileId:'default'});
    expect(desktop.resumeBrowserWorkflow).not.toHaveBeenCalled();
  });
  it('never chooses an unrelated interrupted history entry when starting a workflow',async()=>{
    const desktop={startBrowserWorkflow:vi.fn(),resumeBrowserWorkflow:vi.fn()};
    await beginBrowserWorkflow(desktop,{selected:'default',workflowHistory:[{id:'old',profileId:'default',status:'interrupted'}]});
    expect(desktop.startBrowserWorkflow).toHaveBeenCalledOnce();expect(desktop.resumeBrowserWorkflow).not.toHaveBeenCalled();
    expect(workflowCheckpoint({selected:'other',workflow:{profileId:'default',status:'paused'}})).toBeNull();
  });
  it('requests explicit saved-page recovery, or cancels the paused checkpoint before a fresh start',async()=>{
    const calls=[],desktop={resumeBrowserWorkflow:async v=>calls.push(['resume',v]),cancelBrowserWorkflow:async v=>calls.push(['cancel',v]),startBrowserWorkflow:async v=>calls.push(['start',v])};
    const status={selected:'default',workflow:{id:'old',profileId:'default',status:'paused'}};
    await beginBrowserWorkflow(desktop,status);await beginBrowserWorkflow(desktop,status,{fresh:true});
    expect(calls).toEqual([['resume',{workflowId:'old',profileId:'default',restorePage:true}],['cancel',{workflowId:'old'}],['start',{profileId:'default'}]]);
  });
});
describe('Bounded, account-aware checkpoint recovery',()=>{
  it('accepts only the optional trailing slash on the same stable reel ID',()=>{
    const original=sourceIdentity('https://example.com/reel/one/');
    expect(checkpointMatches(original,'https://example.com/reel/one')).toBe(true);
    for(const url of ['https://other.example.com/reel/one/','https://example.com/reel/ONE/','https://example.com/reel/two/'])expect(checkpointMatches(original,url)).toBe(false);
    expect(checkpointMatches(sourceIdentity('https://example.com/page'),'https://example.com/page/')).toBe(false);
    expect(recoveryAddress(sourceIdentity('https://example.com/reel/one/?token=SECRET'))).toBeNull();
    expect(recoveryAddress(sourceIdentity('https://example.com/#/conversation/one'))).toBeNull();
    expect(recoveryAddress({...original,recoverable:undefined})).toBeNull();
  });
  it('restores the saved page and renews references without replaying actions',async()=>{
    const f=fixture(),old=await f.flows.begin({profileId:'default'});f.page('https://example.com/reel/two/');
    await expect(f.flows.resume({workflowId:old.workflowId,profileId:'default'})).rejects.toThrow(/start a new workflow/);
    const resumed=await f.flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true});
    expect(f.restored).toEqual([{profile:'default',url:'https://example.com/reel/one/'}]);
    expect(resumed.workflowId).not.toBe(old.workflowId);expect(resumed.page.pageRef).not.toBe(old.page.pageRef);
    expect(resumed.restoredPage).toBe(true);expect(f.operations.every(action=>action==='read')).toBe(true);
    await expect(f.flows.tool({workflowId:old.workflowId,action:'read'})).rejects.toThrow(/not found/);
  });
  it('uses a manually reopened reel with a trailing slash difference and no recovery navigation',async()=>{
    const f=fixture(),old=await f.flows.begin({profileId:'default'});f.page('https://example.com/reel/one');
    const resumed=await f.flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true});
    expect(resumed.restoredPage).toBe(false);expect(f.restored).toHaveLength(0);
  });
  it('keeps account binding across restart and rejects a different account before tools run',async()=>{
    const f=fixture(),old=await f.flows.begin({profileId:'default'});f.restart();f.account('Different fixture');
    await expect(f.flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true})).rejects.toThrow(/account changed/);
    expect(f.flows.activeState().status).toBe('cancelled'); // Restart has no live original run to restore.
    const json=fs.readFileSync(path.join(f.directory,'checkpoints',old.workflowId+'.json'),'utf8');
    expect(json).toMatch(/"accountRef":"[a-f0-9]{64}"/);expect(json).not.toContain('Owned fixture');expect(json).not.toContain('Different fixture');
  });
  it('releases recovery after a blocked navigation or wrong-profile refusal so it can be retried',async()=>{
    const f=fixture(),old=await f.flows.begin({profileId:'default'});f.page('https://example.com/reel/two/');f.profile('other');
    await expect(f.flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true})).rejects.toThrow(/profile/);
    expect(f.restored).toHaveLength(0);f.profile('default');f.restoreError('blocked_destination');
    await expect(f.flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true})).rejects.toThrow(/blocked_destination/);
    expect(f.flows.busy()).toBe(false);f.restoreError(null);
    expect((await f.flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true})).restoredPage).toBe(true);
  });
  it('retains the original account binding through a login challenge, then permits manual reauthentication',async()=>{
    const f=fixture(),old=await f.flows.begin({profileId:'default'});f.page('https://example.com/reel/two/');f.challenge(true);
    await expect(f.flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true})).rejects.toThrow(/login_challenge/);
    const paused=f.flows.activeState();expect(paused.status).toBe('paused');expect(paused.accountRef).toBe(old.page.accountRef);expect(paused.source).toEqual(old.page.source);
    f.challenge(false);const resumed=await f.flows.resume({workflowId:paused.id,profileId:'default',restorePage:true});
    expect(resumed.page.accountRef).toBe(old.page.accountRef);expect(f.operations.every(action=>action==='read')).toBe(true);
  });
  it('does not reconstruct signed or redacted checkpoint addresses',async()=>{
    const f=fixture();f.page('https://example.com/reel/one/?signature=SECRET');
    const old=await f.flows.begin({profileId:'default'});f.page('https://example.com/reel/two/');
    await expect(f.flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true})).rejects.toThrow(/Open it in this profile/);
    expect(f.restored).toHaveLength(0);expect(JSON.stringify(f.flows.state())).not.toContain('SECRET');
  });
  it('holds exclusive recovery ownership until cancellation settles, without a late restart',async()=>{
    const f=fixture(),old=await f.flows.begin({profileId:'default'});f.page('https://example.com/reel/two/');
    let release;const gate=new Promise(resolve=>release=resolve);
    const options={getContents:()=>({getURL:()=> 'https://example.com/reel/two/',stop:()=>{},isDestroyed:()=>false}),getProfileId:()=> 'default',getRevision:()=>0,storagePath:f.directory,allowRequest:()=>true,
      restorePage:()=>gate};
    const flows=createBrowserWorkflows(options),pending=flows.resume({workflowId:old.workflowId,profileId:'default',restorePage:true});
    await new Promise(resolve=>setTimeout(resolve,0));await flows.cancel();expect(flows.busy()).toBe(true);
    await expect(flows.begin({profileId:'default'})).rejects.toThrow(/recovery/);
    release();await expect(pending).rejects.toThrow(/cancelled/);expect(flows.busy()).toBe(false);
  });
});
