import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url),{createBrowserWindows,MAX_BROWSER_WINDOWS}=require('../../electron/browserWindows');
const {createBrowserProfiles}=require('../../electron/browserProfiles');

function setup() {
  const created=[],controllers=[];let id=100;
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;this.destroyed=false;
      this.webContents=new EventEmitter();Object.assign(this.webContents,{id:++id,isDestroyed:()=>this.destroyed,
        mainFrame:{url:''},setWindowOpenHandler:handler=>{this.popup=handler;}});created.push(this);}
    isDestroyed(){return this.destroyed;}setMenu(){}show(){this.shown=true;}
    async loadURL(url){this.url=url;this.webContents.mainFrame.url=url;}
    destroy(){this.destroyed=true;this.emit('closed');}
  }
  const profiles=createBrowserProfiles(),main={webContents:{getURL:()=> 'app://local/index.html?build=old&private=omitted'}};
  const source={state:()=>({selected:profiles.selected().id})};
  const manager=createBrowserWindows({BrowserWindow:Window,profileRegistry:profiles,getMainWindow:()=>main,
    createBrowser:({profileRegistry,getWindow})=>{
      const controller={state:()=>({selected:profileRegistry.selected().id}),selectProfile:id=>profileRegistry.select(id),
        async dispose(){this.disposed=(this.disposed||0)+1;},setMix(value){this.mix=value;},hide(){this.hidden=true;},getWindow};
      controllers.push(controller);return controller;
    }});
  const event=window=>({sender:window.webContents,senderFrame:window.webContents.mainFrame});
  return {manager,profiles,source,created,controllers,event};
}
describe('independent Browser window hosts',()=>{
  it('routes each host to its own controller and rejects remote pages, frames and stale hosts',async()=>{
    const {manager,source,created,controllers,event}=setup();
    await manager.open(source);await manager.open(source);
    expect(manager.controller(event(created[0]))).toBe(controllers[0]);
    expect(manager.controller(event(created[1]))).toBe(controllers[1]);
    expect(manager.controller({...event(created[0]),senderFrame:{url:created[0].url}})).toBeUndefined();
    created[0].webContents.mainFrame.url='https://example.com';expect(manager.trusted(event(created[0]))).toBe(false);
    created[0].webContents.mainFrame.url='app://local/index.html';expect(manager.trusted(event(created[0]))).toBe(false);
    created[0].webContents.mainFrame.url=created[0].url;
    expect(created[0].options.webPreferences).toMatchObject({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webviewTag:false});
    expect(created[0].options.webPreferences.preload).toContain('browserWindowPreload.js');
    expect(created[0].options.webPreferences.partition).not.toBe(created[1].options.webPreferences.partition);
    expect(created[0].url).toBe('app://local/index.html?browserWindow=1');
    expect(manager.allows('navigate')).toBe(true);
    for(const action of ['clearData','startWorkflow','browserTool','releaseWorkflowMedia','connection'])expect(manager.allows(action)).toBe(false);
    created[0].destroy();await Promise.resolve();
    expect(manager.controller(event(created[0]))).toBeUndefined();expect(controllers[1].disposed).toBeUndefined();
    await manager.dispose();expect(controllers.map(c=>c.disposed)).toEqual([1,1]);
  });
  it('bounds windows, propagates sound mix and closes only matching profile windows',async()=>{
    const {manager,source,profiles,created,controllers,event}=setup();
    manager.setMix({muted:true});await manager.open(source);
    const account=profiles.create('Second');controllers[0].selectProfile(account.id);
    expect(profiles.selected().id).toBe('default');
    for(let i=1;i<MAX_BROWSER_WINDOWS;i++)await manager.open(source);
    expect(controllers.every(c=>c.mix.muted)).toBe(true);
    await expect(manager.open(source)).rejects.toThrow(/maximum/);
    await manager.closeProfile('default');expect(created[0].isDestroyed()).toBe(false);
    expect(created.slice(1).every(win=>win.isDestroyed())).toBe(true);
    expect(manager.trusted(event(created[0]))).toBe(true);
    await manager.dispose();await expect(manager.open(source)).rejects.toThrow(/closing/);
  });
});
