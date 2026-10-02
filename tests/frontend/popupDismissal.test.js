import { describe, it, expect, vi } from 'vitest';
import { installPopupDismissal, registerPopupLayer } from '../../src/popupDismissal';

function fixture() {
  const listeners = new Map(), dialogs = [];
  const doc = { activeElement:null, defaultView:{Event}, querySelectorAll:()=>dialogs,
    addEventListener:(name,fn)=>{const group=listeners.get(name)||new Set(); group.add(fn);listeners.set(name,group);},
    removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn),
  };
  function emit(name, values={}) {
    const event = {defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation:vi.fn(),...values};
    for(const fn of listeners.get(name)||[])fn(event);
    return event;
  }
  const node = values => ({isConnected:true,getClientRects:()=>[{}],contains:target=>target===values?.inside,
    getBoundingClientRect:()=>({left:10,top:10,right:100,bottom:100}),...values});
  return {doc,listeners,dialogs,emit,node};
}

describe('shared popup dismissal',()=>{
  it('Escape dismisses only the innermost visible popup, even when focus is outside',()=>{
    const f=fixture(), outer=vi.fn(),inner=vi.fn();
    const releaseOuter=registerPopupLayer(f.doc,{node:()=>f.node(),dismiss:outer});
    const releaseInner=registerPopupLayer(f.doc,{node:()=>f.node(),dismiss:inner});
    const event=f.emit('keydown',{key:'Escape'});
    expect(inner).toHaveBeenCalledWith('escape'); expect(outer).not.toHaveBeenCalled();expect(event.defaultPrevented).toBe(true);
    releaseInner();f.emit('keydown',{key:'Escape'});expect(outer).toHaveBeenCalledOnce();releaseOuter();
  });
  it('clicking within a portal menu leaves its parent open; clicking outside all closes both',()=>{
    const f=fixture(), target={},outer=vi.fn(),inner=vi.fn();
    const cleanup=[registerPopupLayer(f.doc,{node:()=>f.node(),dismiss:outer}),registerPopupLayer(f.doc,{node:()=>f.node({inside:target}),dismiss:inner})];
    f.emit('pointerdown',{target});expect(inner).not.toHaveBeenCalled();expect(outer).not.toHaveBeenCalled();
    f.emit('pointerdown',{target:{}});expect(inner).toHaveBeenCalledWith('outside');expect(outer).toHaveBeenCalledWith('outside');
    cleanup.forEach(fn=>fn());
  });
  it('clicking inside a parent closes its child without swallowing the click',()=>{
    const f=fixture(), target={},outer=vi.fn(),inner=vi.fn();
    const cleanup=[registerPopupLayer(f.doc,{node:()=>f.node({inside:target}),dismiss:outer}),registerPopupLayer(f.doc,{node:()=>f.node(),dismiss:inner})];
    const event=f.emit('pointerdown',{target});expect(inner).toHaveBeenCalledOnce();expect(outer).not.toHaveBeenCalled();expect(event.defaultPrevented).toBe(false);
    cleanup.forEach(fn=>fn());
  });
  it('ignores hidden layers and Escape already handled by an inner editor',()=>{
    const f=fixture(),dismiss=vi.fn();
    const release=registerPopupLayer(f.doc,{node:()=>f.node({getClientRects:()=>[]}),dismiss});
    f.emit('keydown',{key:'Escape'});expect(dismiss).not.toHaveBeenCalled();release();
    const visible=registerPopupLayer(f.doc,{node:()=>f.node(),dismiss});
    f.emit('keydown',{key:'Escape',defaultPrevented:true});expect(dismiss).not.toHaveBeenCalled();visible();
  });
  it('lets native dialog Escape run without dismissing its parent popup',()=>{
    const f=fixture(),dismiss=vi.fn();f.dialogs.push(f.node({open:true}));
    const release=registerPopupLayer(f.doc,{node:()=>f.node(),dismiss});
    const event=f.emit('keydown',{key:'Escape'});expect(dismiss).not.toHaveBeenCalled();expect(event.defaultPrevented).toBe(false);release();
  });
  it('backdrop dismissal uses dialog cancellation and respects cancelled requests',()=>{
    const f=fixture(),release=installPopupDismissal(f.doc),close=vi.fn();
    const dialog=f.node({open:true,close,dispatchEvent:vi.fn(()=>false)});f.dialogs.push(dialog);
    f.emit('pointerdown',{target:dialog,clientX:1,clientY:1});f.emit('click',{target:dialog,clientX:1,clientY:1});
    expect(dialog.dispatchEvent.mock.calls[0][0].type).toBe('cancel');expect(close).not.toHaveBeenCalled();
    dialog.dispatchEvent.mockReturnValue(true);
    f.emit('pointerdown',{target:dialog,clientX:1,clientY:1});f.emit('click',{target:dialog,clientX:1,clientY:1});expect(close).toHaveBeenCalledOnce();release();
  });
  it('does not dismiss dialog padding or a drag that starts inside and ends outside',()=>{
    const f=fixture(),release=installPopupDismissal(f.doc),close=vi.fn();
    const dialog=f.node({open:true,close,dispatchEvent:vi.fn(()=>true)});f.dialogs.push(dialog);
    f.emit('pointerdown',{target:dialog,clientX:20,clientY:20});f.emit('click',{target:dialog,clientX:20,clientY:20});
    f.emit('pointerdown',{target:dialog,clientX:20,clientY:20});f.emit('click',{target:dialog,clientX:1,clientY:1});
    expect(close).not.toHaveBeenCalled();release();
  });
  it('uses the focused nested native dialog rather than DOM insertion order',()=>{
    const f=fixture(),release=installPopupDismissal(f.doc),close=vi.fn();
    const inner=f.node({open:true,close,dispatchEvent:()=>true}),outer=f.node({open:true});
    f.dialogs.push(inner,outer);f.doc.activeElement={closest:()=>inner};
    f.emit('pointerdown',{target:inner,clientX:1,clientY:1});f.emit('click',{target:inner,clientX:1,clientY:1});
    expect(close).toHaveBeenCalledOnce();release();
  });
  it('shares listeners across clients and removes them when the last client leaves',()=>{
    const f=fixture(),app=installPopupDismissal(f.doc),popup=registerPopupLayer(f.doc,{node:()=>f.node(),dismiss:vi.fn()});
    expect([...f.listeners.values()].every(group=>group.size===1)).toBe(true);
    popup();expect([...f.listeners.values()].every(group=>group.size===1)).toBe(true);
    app();expect([...f.listeners.values()].every(group=>group.size===0)).toBe(true);
  });
});
