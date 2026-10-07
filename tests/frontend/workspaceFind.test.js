import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {findTextMatches} from '../../src/workspaceFind';
const require = createRequire(import.meta.url);
const {createWorkspaceFind} = require('../../electron/workspaceFind');
afterEach(() => vi.useRealTimers());

describe('workspace text matching', () => {
  it('treats punctuation as literal text', () => {
    expect(findTextMatches('a.*[b] aXb a.*[b]', 'a.*[b]').matches).toEqual([{start:0,end:6},{start:11,end:17}]);
  });
  it('matches across formatting whitespace with correct Unicode offsets', () => {
    expect(findTextMatches('😀 Hello\n  world', 'hello world').matches).toEqual([{start:3,end:16}]);
  });
  it('supports case sensitivity and blank queries', () => {
    expect(findTextMatches('Sound sound SOUND', 'sound').matches).toHaveLength(3);
    expect(findTextMatches('Sound sound SOUND', 'sound', true).matches).toHaveLength(1);
    expect(findTextMatches('any text', '  ').matches).toHaveLength(0);
  });
  it('bounds work and reports an incomplete result set', () => {
    expect(findTextMatches('a a a', 'a', false, 2)).toEqual({matches:[{start:0,end:1},{start:2,end:3}],limited:true});
    expect(findTextMatches('a a', 'a', false, 2).limited).toBe(false);
  });
});

function fixture() {
  const contents = new EventEmitter(), host = new EventEmitter(), handlers = new Map();
  let serial = 0, visible = true, destroyed = false;
  Object.assign(contents, {isDestroyed:()=>destroyed, findInPage:vi.fn(()=>++serial), stopFindInPage:vi.fn(), focus:vi.fn()});
  Object.assign(host, {focus:vi.fn(), send:vi.fn()});
  const service = createWorkspaceFind({ipcMain:{handle:(name,handler)=>handlers.set(name,handler)},
    getWindow:()=>({isDestroyed:()=>false,webContents:host}), trustedDesktop:event=>event === 'trusted',
    targets:{browser:()=>visible?contents:null, 'media-manager':()=>visible?contents:null, integrations:()=>visible?contents:null}});
  service.watch(contents,'browser'); service.watchHost(host);
  const result = (requestId, matches=2, current=1, finalUpdate=true) => contents.emit('found-in-page',{}, {requestId,matches,activeMatchOrdinal:current,finalUpdate});
  return {service,contents,host,handlers,result,hide:()=>{visible=false;},destroy:()=>{destroyed=true;contents.emit('destroyed');}};
}
describe('embedded page find lifecycle and desktop boundary', () => {
  it('rejects untrusted senders and invalid targets or queries', async () => {
    const f = fixture(), search=f.handlers.get('workspace-find:search');
    expect(await search('remote',{target:'browser',query:'sound'})).toHaveProperty('error');
    for (const value of [{target:'arbitrary-id',query:'sound'}, {target:'browser',query:'x'.repeat(201)}, {target:'browser',query:'\0'}]) expect(await search('trusted',value)).toHaveProperty('error');
    expect(f.contents.findInPage).not.toHaveBeenCalled();
    expect(f.handlers.get('workspace-find:stop')('remote',{target:'browser'})).toHaveProperty('error');
  });
  it('accepts only the final result of the current request', async () => {
    const f=fixture(), first=f.service.search({target:'browser',query:'old'});
    const second=f.service.search({target:'browser',query:'new'});
    expect(await first).toEqual({cancelled:true});
    f.result(1,99); f.result(2,1,1,false); f.result(2,3,2);
    expect(await second).toEqual({matches:3,current:2});
    expect(f.contents.listenerCount('found-in-page')).toBe(0);
  });
  it('waits for a child-frame count after an early final result', async () => {
    const f=fixture(), pending=f.service.search({target:'browser',query:'sound'});
    f.result(1,0,0); f.result(1,3,1);
    expect(await pending).toEqual({matches:3,current:1});
  });
  it('opens host Find from a sandboxed preview without intercepting the editor frame', () => {
    const f=fixture(), event={preventDefault:vi.fn()}, input={type:'keyDown',key:'f',control:true};
    f.host.mainFrame={}; f.host.focusedFrame=f.host.mainFrame;
    f.host.emit('before-input-event',event,input); expect(event.preventDefault).not.toHaveBeenCalled();
    f.host.focusedFrame={}; f.host.emit('before-input-event',event,input);
    expect(event.preventDefault).toHaveBeenCalledOnce(); expect(f.host.send).toHaveBeenLastCalledWith('workspace-find:open',{});
  });
  it('continues only for the same query, case setting, and view', async () => {
    const f=fixture(); let p=f.service.search({target:'browser',query:'sound'}); f.result(1); await p;
    p=f.service.search({target:'browser',query:'sound',findNext:true,forward:false}); f.result(2); await p;
    expect(f.contents.findInPage.mock.calls[1][1]).toEqual({forward:false,findNext:true,matchCase:false});
    p=f.service.search({target:'browser',query:'sound',findNext:true,matchCase:true}); f.result(3); await p;
    expect(f.contents.findInPage.mock.calls[2][1]).not.toHaveProperty('findNext');
    f.service.stop();
  });
  it('clears highlights and optionally returns focus to the page', async () => {
    const f=fixture(), pending=f.service.search({target:'browser',query:'sound'});
    f.handlers.get('workspace-find:stop')('trusted',{target:'browser',restoreFocus:true});
    expect(await pending).toEqual({cancelled:true});
    expect(f.contents.stopFindInPage).toHaveBeenLastCalledWith('clearSelection');
    expect(f.contents.focus).toHaveBeenCalledOnce();
  });
  it('falls back when the embedded view is hidden', async () => {
    const f=fixture(); f.hide();
    expect(await f.service.search({target:'browser',query:'sound'})).toEqual({unavailable:true});
    expect(f.contents.findInPage).not.toHaveBeenCalled();
  });
  it.each(['navigation','destroy','host reload','host crash'])('cancels pending search after %s', async action => {
    const f=fixture(), pending=f.service.search({target:'browser',query:'sound'});
    if (action==='navigation') f.contents.emit('did-start-navigation',{},'https://example.test',false,true);
    if (action==='destroy') f.destroy();
    if (action==='host reload') f.host.emit('did-start-navigation',{},'app://local',false,true);
    if (action==='host crash') f.host.emit('render-process-gone');
    expect(await pending).toEqual({cancelled:true}); expect(f.contents.listenerCount('found-in-page')).toBe(0);
  });
  it('times out without leaking a listener or retaining a search', async () => {
    vi.useFakeTimers(); const f=fixture(), pending=f.service.search({target:'browser',query:'sound'});
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toHaveProperty('error','Search timed out. Try again.');
    expect(f.contents.listenerCount('found-in-page')).toBe(0);
  });
  it('redirects Ctrl+F and F3 from the visible guest and closes on Escape', async () => {
    const f=fixture(), event={preventDefault:vi.fn()};
    f.contents.emit('before-input-event',event,{type:'keyDown',key:'f',control:true});
    expect(f.host.send).toHaveBeenLastCalledWith('workspace-find:open',{target:'browser'});
    f.contents.emit('before-input-event',event,{type:'keyDown',key:'F3',shift:true});
    expect(f.host.send).toHaveBeenLastCalledWith('workspace-find:open',{target:'browser',direction:-1});
    const pending=f.service.search({target:'browser',query:'sound'});
    f.contents.emit('before-input-event',event,{type:'keyDown',key:'Escape'});
    expect(await pending).toEqual({cancelled:true});
    expect(f.host.send).toHaveBeenLastCalledWith('workspace-find:close');
    f.hide(); f.host.send.mockClear();
    f.contents.emit('before-input-event',event,{type:'keyDown',key:'f',control:true});
    expect(f.host.send).not.toHaveBeenCalled();
  });
});
