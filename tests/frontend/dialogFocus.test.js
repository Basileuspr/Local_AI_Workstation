import {createRequire} from 'node:module';
import {describe, it, expect, vi} from 'vitest';
const require = createRequire(import.meta.url);
const {createFocusedDialog} = require('../../electron/dialogFocus');
const {placeBrowserView} = require('../../electron/browserPlacement');

function fixture() {
  const host = {isDestroyed:()=>false, isFocused:()=>false, focus:vi.fn(), getZoomFactor:()=>1};
  const wc = {isDestroyed:()=>false, isFocused:()=>true, focus:vi.fn(), getBackgroundThrottling:()=>false, setBackgroundThrottling:vi.fn()};
  let visible = true;
  const view = {webContents:wc, getVisible:()=>visible, setVisible:vi.fn(value=>{visible=value;}), getBounds:()=>({x:0,y:0,width:200,height:200}), setBounds:vi.fn()};
  const win = {isDestroyed:()=>false, isFocused:()=>true, isVisible:()=>true, isMinimized:()=>false, getContentSize:()=>[800,600], webContents:host, contentView:{children:[view]}};
  return {win, view, host, wc};
}

describe('native keyboard focus handoff', () => {
  it('returns keyboard input to the host when a focused native workspace is hidden', () => {
    const {view,win,host} = fixture();
    placeBrowserView(view,win,{visible:false});
    expect(host.focus).toHaveBeenCalledOnce();
    placeBrowserView(view,win,{visible:false});
    expect(host.focus).toHaveBeenCalledOnce();
  });
  it('does not change focus for redraws or repeated geometry', () => {
    const {view,win,host,wc} = fixture();
    for(let i=0;i<30;i++) placeBrowserView(view,win,{visible:true,bounds:{x:0,y:0,width:200,height:200}});
    expect(view.setVisible).not.toHaveBeenCalled();
    expect(view.setBounds).not.toHaveBeenCalled();
    expect(host.focus).not.toHaveBeenCalled(); expect(wc.focus).not.toHaveBeenCalled();
  });
  it.each(['blurred','hidden','minimized'])('never steals OS focus from a %s window', async state => {
    const {view,win,host,wc} = fixture();
    if(state==='blurred')win.isFocused=()=>false;
    if(state==='hidden')win.isVisible=()=>false;
    if(state==='minimized')win.isMinimized=()=>true;
    const dialogs=createFocusedDialog({showOpenDialog:async()=>({canceled:true})});
    const result=dialogs.showOpenDialog(win,{});wc.isFocused=()=>false;
    placeBrowserView(view,win,{visible:false});
    expect(await result).toEqual({canceled:true});
    expect(host.focus).not.toHaveBeenCalled();expect(wc.focus).not.toHaveBeenCalled();
  });
  it('restores the same surviving native editor after a file dialog', async () => {
    const {win,wc,host}=fixture();const options={title:'Open'};
    const native={showOpenDialog:vi.fn(async()=>({filePaths:['fixture']}))};
    const result=createFocusedDialog(native).showOpenDialog(win,options);wc.isFocused=()=>false;
    expect(await result).toEqual({filePaths:['fixture']});
    expect(native.showOpenDialog).toHaveBeenCalledWith(win,options);
    expect(wc.focus).toHaveBeenCalledOnce();expect(host.focus).not.toHaveBeenCalled();
  });
  it('falls back to the host if the old view disappeared while the dialog closed', async () => {
    const {win,host,wc}=fixture();
    const result=createFocusedDialog({showSaveDialog:async()=>({canceled:true})}).showSaveDialog(win,{});
    win.contentView.children=[];
    await result;expect(host.focus).toHaveBeenCalledOnce();expect(wc.focus).not.toHaveBeenCalled();
  });
  it('preserves dialog failures while recovering host input', async () => {
    const {win,host}=fixture();win.contentView.children=[];
    const dialogs=createFocusedDialog({showMessageBox:async()=>{throw Error('fixture failure');}});
    await expect(dialogs.showMessageBox(win,{})).rejects.toThrow('fixture failure');
    expect(host.focus).toHaveBeenCalledOnce();
  });
  it('keeps host input when a native pane reappears after a dialog',()=>{
    const {view,win,host}=fixture();view.setVisible(false);host.isFocused=()=>true;
    placeBrowserView(view,win,{visible:true,bounds:{x:0,y:0,width:200,height:200}});
    expect(host.focus).toHaveBeenCalledOnce();
  });
  it('does not touch a closed window when an outstanding dialog settles',async()=>{
    const {win,host,wc}=fixture();const result=createFocusedDialog({showOpenDialog:async()=>({canceled:true})}).showOpenDialog(win,{});
    win.isDestroyed=()=>true;
    Object.defineProperty(win,'contentView',{get(){throw Error('Window destroyed');}});
    expect(await result).toEqual({canceled:true});expect(host.focus).not.toHaveBeenCalled();expect(wc.focus).not.toHaveBeenCalled();
  });
});
