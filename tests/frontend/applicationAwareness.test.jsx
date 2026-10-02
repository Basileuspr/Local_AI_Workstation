import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getContextUsage } from '../../src/contextMemory';
import { buildResponseStylePrompt } from '../../src/responseStyle';
import { chatInfluences } from '../../src/chatInfluences';
import { loadStartupNavigation, saveNavigation } from '../../src/navigation';
import { dependencyAction, checkAppUpdates } from '../../src/applicationAwareness';
import ApplicationMaintenance from '../../src/components/ApplicationMaintenance';
const { createDependencyMaintenance } = createRequire(import.meta.url)('../../electron/dependencyMaintenance');
afterEach(() => vi.unstubAllGlobals());

it('Default injects no style prompt or inferred preferences', () => {
  expect(buildResponseStylePrompt('default')).toBe('');
  expect(buildResponseStylePrompt('invalid')).toBe('');
  const plan = chatInfluences({ responseStyle:'default', systemPrompt:'', roleplay:{enabled:false} });
  expect(plan.parts).toEqual([]); expect(plan.systemPrompt).toBe('');
  expect(buildResponseStylePrompt('structured')).toContain('Markdown');
});

it('context reports estimates, reserves, summary and selected model', () => {
  const usage = getContextUsage({ model:'local', messages:[{role:'user',content:'hello'}],memorySummary:'summary', summarizedMessageCount:0,
    contextWindow:4096,responseLength:1024,systemPrompt:'instructions',useKnowledgeBase:false,useDurableMemory:false });
  expect(usage.countKind).toBe('estimate'); expect(usage.model).toBe('local');
  expect(usage.configuredContextLimit).toBe(4096); expect(usage.summaryTokens).toBeGreaterThan(10);
  expect(usage.summarizationOccurred).toBe(true);
  expect(usage.inputBudgetRemaining).toBe(4096-usage.fixedReserve-usage.promptTokens);
  const small = getContextUsage({messages:[],contextWindow:1024,responseLength:4096});
  expect(small.windowTokens).toBe(1024); expect(small.inputBudgetRemaining).toBe(0);
});

it('fresh startup and resume preference preserve history selection without creating chats', () => {
  const values = new Map();
  vi.stubGlobal('localStorage',{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)});
  vi.stubGlobal('sessionStorage',{getItem:()=>null});
  saveNavigation('generate','old-chat');
  expect(loadStartupNavigation('new')).toEqual({tab:'chats',sessionId:null});
  expect(loadStartupNavigation('resume')).toEqual({tab:'chats',sessionId:'old-chat'});
  values.clear(); expect(loadStartupNavigation('resume')).toEqual({tab:'chats',sessionId:null});
});

it('maintenance checks and dependency approvals use authenticated API / fixed desktop IPC', async () => {
  expect(renderToStaticMarkup(<ApplicationMaintenance/>)).toContain('Check Dependency Compatibility');
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'unable_to_check'})})));
  expect((await checkAppUpdates()).status).toBe('unable_to_check');
  vi.stubGlobal('window',{});
  await expect(dependencyAction('approve','ticket')).rejects.toThrow('owning desktop');
});

function host(overrides={}) {
  return {run:vi.fn(async request=>request.action==='prepare'?{status:'approval_required',name:'psutil',current:'old',target:'new',expires_at:Date.now()/1000+600,wheel:{path:'private'}}:{status:'success'}),
    ownsBackend:()=>true,lockBackend:vi.fn(),unlockBackend:vi.fn(),stopBackend:vi.fn(),startBackend:vi.fn(),onRestartFailure:vi.fn(),...overrides};
}

describe('scoped desktop dependency maintenance', () => {
  it('keeps wheel paths private, refuses unapproved updates and pauses/restarts backend', async () => {
    const deps = host(), control = createDependencyMaintenance(deps);
    const proposal = await control.prepare('psutil','requirements.txt');
    expect(proposal.wheel).toBeUndefined(); expect(proposal.ticket).toBeTruthy();
    expect((await control.apply(proposal.ticket,false)).error).toContain('Approve');
    expect(deps.stopBackend).not.toHaveBeenCalled();
    expect((await control.apply(proposal.ticket,true)).status).toBe('success');
    expect(deps.lockBackend).toHaveBeenCalledOnce(); expect(deps.stopBackend).toHaveBeenCalledOnce(); expect(deps.startBackend).toHaveBeenCalledOnce();
    expect((await control.apply(proposal.ticket,true)).error).toBeTruthy();
  });
  it('does not install while work is active and restarts after a failed worker', async () => {
    const deps = host({lockBackend:vi.fn(async()=>{throw new Error('Active work');})}), control = createDependencyMaintenance(deps);
    const proposal = await control.prepare('psutil');
    expect((await control.apply(proposal.ticket,true)).error).toBe('Active work');
    expect(deps.stopBackend).not.toHaveBeenCalled();
    const failed = host(); const run = failed.run;
    failed.run = vi.fn(request=>request.action==='apply'?Promise.reject(new Error('Failed update')):run(request));
    const second = createDependencyMaintenance(failed); const plan = await second.prepare('psutil');
    expect((await second.apply(plan.ticket,true)).error).toBe('Failed update');
    expect(failed.startBackend).toHaveBeenCalledOnce();
  });
});
