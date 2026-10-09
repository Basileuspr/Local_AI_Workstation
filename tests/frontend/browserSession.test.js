import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {describe,it,expect} from 'vitest';
const {installBrowserSession,REMOTE_PREFERENCES}=createRequire(import.meta.url)('../../electron/browserSession');
const {redactSecrets}=createRequire(import.meta.url)('../../electron/redactSecrets');
function setup(dialog) {
  const ses=new EventEmitter();ses.webRequest={onBeforeRequest(fn){ses.request=fn;}};
  for(const name of ['PermissionCheck','PermissionRequest','DevicePermission','DisplayMediaRequest'])ses[`set${name}Handler`]=fn=>{ses[name]=fn;};
  const wc={id:1,isDestroyed:()=>false,getURL:()=> 'https://example.com/page'},owned=new Set([wc]);
  const policy=installBrowserSession({browserSession:ses,owned,getWindow:()=>null,dialog,notify:()=>{}});
  return {ses,wc,policy};
}
describe('persistent browser permission policy',()=>{
  it('routes shared-profile permission dialogs to each owner and preserves other grants on detach',async()=>{
    const parents=[],second={name:'second'};
    const {ses,wc,policy}=setup({showMessageBox:async parent=>{parents.push(parent);return {response:1};}});
    const wc2={...wc,id:2},owned2=new Set([wc2]);
    const next=installBrowserSession({browserSession:ses,owned:owned2,getWindow:()=>second,
      dialog:{showMessageBox:async parent=>{parents.push(parent);return {response:1};}}});
    const ask=contents=>new Promise(resolve=>ses.PermissionRequest(contents,'geolocation',resolve,{}));
    expect(await ask(wc)).toBe(true);expect(await ask(wc2)).toBe(true);
    expect(parents).toEqual([null,second]);
    policy.detach();
    expect(ses.PermissionCheck(wc,'geolocation','https://example.com',{})).toBe(false);
    expect(ses.PermissionCheck(wc2,'geolocation','https://example.com',{})).toBe(true);
    next.revoke(wc2);expect(await ask(wc2)).toBe(true);
    expect(ses.listenerCount('will-download')).toBe(1);
    next.detach();expect(ses.listenerCount('will-download')).toBe(0);
    expect(await ask(wc2)).toBe(false);
  });
  it('routes downloads to the owning window and does not cancel another window download',async()=>{
    const {ses,wc,policy}=setup(),parent={name:'second'},wc2={...wc,id:2},notices=[];
    let chosen;
    const next=installBrowserSession({browserSession:ses,owned:new Set([wc2]),getWindow:()=>parent,
      dialog:{showSaveDialog:async actual=>{expect(actual).toBe(parent);return new Promise(resolve=>{chosen=resolve;});}},notify:value=>notices.push(value)});
    const item=new EventEmitter();Object.assign(item,{pause(){},getFilename:()=> 'clip.mp4',cancel(){throw Error('Another owner must not cancel this download');},setSavePath(value){this.path=value;},resume(){this.resumed=true;}});
    ses.emit('will-download',{preventDefault(){throw Error('Owned download denied');}},item,wc2);
    policy.detach();chosen({filePath:'chosen.mp4'});await new Promise(resolve=>setImmediate(resolve));
    expect(item.resumed).toBe(true);expect(item.path).toBe('chosen.mp4');
    item.emit('done',null,'completed');expect(notices.at(-1)).toBe('Download saved.');next.detach();
  });
  it('redacts auth headers, cookies, OAuth callback values and password fields',()=>{
    for(const value of ['Authorization: Basic SECRET','Cookie: session=SECRET; other=SECRET','Set-Cookie: session=SECRET','{"password":"SECRET"}','https://example.com/callback?code=SECRET&state=SECRET#access_token=SECRET','Bearer SECRET','X-LAW-Session: SECRET'])expect(redactSecrets(value)).not.toContain('SECRET');
    expect(redactSecrets('Window started')).toBe('Window started');
  });
  it('keeps remote preferences sandboxed without preload or Node',()=>{
    expect(REMOTE_PREFERENCES).toMatchObject({sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false});
    expect(REMOTE_PREFERENCES.preload).toBeUndefined();
  });
  it('denies foreign contents, frames, devices and local-network access',async()=>{
    const {ses,wc}=setup({showMessageBox(){throw Error('Must not prompt');}});
    const ask=(contents,permission,details)=>new Promise(resolve=>ses.PermissionRequest(contents,permission,resolve,details));
    expect(await ask({...wc,id:2},'geolocation',{})).toBe(false);
    expect(await ask(wc,'geolocation',{isMainFrame:false})).toBe(false);
    expect(await ask(wc,'geolocation',{requestingUrl:'https://other.example/page'})).toBe(false);
    for(const permission of ['local-network','usb','serial','hid','bluetooth','fileSystem','display-capture'])expect(await ask(wc,permission,{})).toBe(false);
    expect(ses.DevicePermission()).toBe(false);
  });
  it('revokes page grants on navigation and never persists them',async()=>{
    const {ses,wc,policy}=setup({showMessageBox:async()=>({response:1})});
    expect(await new Promise(resolve=>ses.PermissionRequest(wc,'geolocation',resolve,{}))).toBe(true);
    expect(ses.PermissionCheck(wc,'geolocation','https://example.com',{})).toBe(true);
    policy.revoke(wc);expect(ses.PermissionCheck(wc,'geolocation','https://example.com',{})).toBe(false);
  });
  it('does not apply an old permission dialog after reloading the same URL',async()=>{
    let answer;const {ses,wc,policy}=setup({showMessageBox:()=>new Promise(resolve=>{answer=resolve;})});
    const request=new Promise(resolve=>ses.PermissionRequest(wc,'geolocation',resolve,{}));
    policy.revoke(wc);answer({response:1});expect(await request).toBe(false);
  });
  it('never silently broadens a microphone grant to camera',async()=>{
    let prompts=0;const {ses,wc}=setup({showMessageBox:async()=>{prompts++;return {response:1};}});
    for(const type of ['audio','video'])expect(await new Promise(resolve=>ses.PermissionRequest(wc,'media',resolve,{mediaTypes:[type]}))).toBe(true);
    expect(prompts).toBe(2);
  });
});
