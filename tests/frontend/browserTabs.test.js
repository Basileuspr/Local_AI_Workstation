import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {describe,it,expect,vi,afterEach} from 'vitest';
const require=createRequire(import.meta.url),{createBrowserTabs,MAX_TABS}=require('../../electron/browserTabs');
const controllers=[];
function create(options) {const controller=createBrowserTabs(options);controllers.push(controller);return controller;}
afterEach(()=>{for(const controller of controllers.splice(0))controller.clear();vi.useRealTimers();});
describe('browser tab inactivity',()=>{
  it('unloads only unselected tabs at the exact default two-minute deadline, independently of page traffic',()=>{
    vi.useFakeTimers();vi.setSystemTime(0);const suspend=vi.fn(),tabs=create({onSuspend:suspend});
    const first=tabs.create('https://example.com/video'),second=tabs.create();
    expect(tabs.list().tabSettings).toEqual({inactiveMinutes:2});
    vi.advanceTimersByTime(119999);tabs.update(first.id,{title:'Playing',url:'https://example.com/playing'});
    expect(suspend).not.toHaveBeenCalled();vi.advanceTimersByTime(1);
    expect(suspend).toHaveBeenCalledOnce();expect(suspend.mock.calls[0][0].id).toBe(first.id);
    expect(tabs.get(first.id)).toMatchObject({suspended:true,url:'https://example.com/playing',title:'Playing'});
    expect(tabs.active().id).toBe(second.id);expect(tabs.active().suspended).toBe(false);
    vi.advanceTimersByTime(600000);expect(suspend).toHaveBeenCalledOnce();
  });
  it('reselection cancels the old deadline; background navigation and reselecting the current tab do not extend deadlines',()=>{
    vi.useFakeTimers();vi.setSystemTime(0);const suspend=vi.fn(),tabs=create({onSuspend:suspend});
    const first=tabs.create(),second=tabs.create();vi.advanceTimersByTime(90000);tabs.select(first.id);
    vi.advanceTimersByTime(90000);tabs.select(first.id);expect(suspend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30000);expect(suspend).toHaveBeenCalledOnce();expect(tabs.get(second.id).suspended).toBe(true);
    tabs.select(second.id);expect(tabs.active().suspended).toBe(false);
    vi.advanceTimersByTime(120000);expect(tabs.get(first.id).suspended).toBe(true);
  });
  it('reschedules settings against elapsed inactivity, and never restores a suspended tab just by disabling the timer',()=>{
    vi.useFakeTimers();vi.setSystemTime(0);const suspend=vi.fn(),tabs=create({onSuspend:suspend});
    const first=tabs.create();tabs.create();vi.advanceTimersByTime(90000);
    tabs.setSettings({inactiveMinutes:5});vi.advanceTimersByTime(150000);expect(suspend).not.toHaveBeenCalled();
    tabs.setSettings({inactiveMinutes:1});vi.advanceTimersByTime(0);expect(tabs.get(first.id).suspended).toBe(true);
    tabs.setSettings({inactiveMinutes:0});expect(tabs.get(first.id).suspended).toBe(true);
    tabs.select(first.id);vi.advanceTimersByTime(600000);expect(suspend).toHaveBeenCalledOnce();
  });
  it('closing chooses an adjacent tab and removes deadlines; shutdown removes every timer',()=>{
    vi.useFakeTimers();const suspend=vi.fn(),tabs=create({onSuspend:suspend});
    const first=tabs.create(),second=tabs.create(),third=tabs.create();
    tabs.close(second.id);expect(tabs.active().id).toBe(third.id);tabs.close(third.id);expect(tabs.active().id).toBe(first.id);
    expect(tabs.active().inactiveSince).toBe(null);tabs.clear();vi.advanceTimersByTime(600000);
    expect(suspend).not.toHaveBeenCalled();expect(tabs.list().tabs).toEqual([]);expect(vi.getTimerCount()).toBe(0);
  });
});
describe('bounded tab settings and identifiers',()=>{
  it('persists only the setting across launches, without URLs, titles or login data',()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'law-tab-settings-'));
    const tabs=create({directory});tabs.create('https://example.com/private?token=secret');tabs.update(tabs.active().id,{title:'Private title'});
    tabs.setSettings({inactiveMinutes:7});
    expect(fs.readFileSync(path.join(directory,'browser-tab-settings.json'),'utf8')).toBe('{"inactiveMinutes":7}');
    const fresh=create({directory});expect(fresh.list()).toMatchObject({tabs:[],activeTabId:null,tabSettings:{inactiveMinutes:7}});
  });
  it('bounds settings, tab counts and page schemes; rejects forged IDs and returns detached snapshots',()=>{
    const tabs=create();
    for(const value of [{inactiveMinutes:-1},{inactiveMinutes:61},{inactiveMinutes:1.5},{inactiveMinutes:'2'},null,[],{inactiveMinutes:2,code:'x'}])expect(()=>tabs.setSettings(value)).toThrow();
    for(const url of ['file:///C:/secret','javascript:alert(1)','http://127.0.0.1','https://192.168.1.1'])expect(()=>tabs.create(url)).toThrow();
    expect(()=>tabs.select('forged')).toThrow();expect(()=>tabs.close('forged')).toThrow();
    for(let i=0;i<MAX_TABS;i++)tabs.create();expect(()=>tabs.create()).toThrow();
    const snapshot=tabs.list();snapshot.tabs[0].url='javascript:x';snapshot.tabSettings.inactiveMinutes=0;
    expect(tabs.list().tabs[0].url).toBe('about:blank');expect(tabs.list().tabSettings.inactiveMinutes).toBe(2);
  });
  it('preserves unreadable settings and falls back to the default until the user saves a replacement',()=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'law-tab-settings-invalid-')),file=path.join(directory,'browser-tab-settings.json');
    fs.writeFileSync(file,'broken');const tabs=create({directory});expect(tabs.list().tabSettings.inactiveMinutes).toBe(2);
    expect(tabs.list().tabSettingsNotice).toContain('could not be read');expect(fs.readFileSync(file,'utf8')).toBe('broken');
    tabs.setSettings({inactiveMinutes:0});expect(tabs.list().tabSettingsNotice).toBe('');
  });
});
