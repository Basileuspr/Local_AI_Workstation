import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, it, expect, vi} from 'vitest';
import {confirmAction} from '../../src/confirmAction';
let document,window,input,focused;
beforeEach(()=>{
  ({document,window}=parseHTML('<html><body><textarea>draft text</textarea></body></html>'));
  input=document.querySelector('textarea');focused=input;
  Object.defineProperty(document,'activeElement',{get:()=>focused});
  document.hasFocus=()=>true;input.getClientRects=()=>[{}];input.focus=vi.fn(()=>{focused=input;});
  const create=document.createElement.bind(document);
  document.createElement=tag=>{const node=create(tag);if(tag==='dialog'){
    node.showModal=()=>{node.setAttribute('open','');focused=node.querySelector('button');};
    node.close=value=>{node.returnValue=value;node.removeAttribute('open');node.dispatchEvent(new window.Event('close'));};
  }return node;};
  vi.stubGlobal('document',document);
});
afterEach(()=>vi.unstubAllGlobals());
it('cancels safely, restores the original input and keeps draft bytes unchanged',async()=>{
  const result=confirmAction('Delete this?');await Promise.resolve();
  document.querySelector('dialog button').click();expect(await result).toBe(false);
  expect(input.focus).toHaveBeenCalledWith({preventScroll:true});expect(input.value).toBe('draft text');expect(document.querySelector('dialog')).toBeNull();
});
it('requires the confirm button and treats message text as text',async()=>{
  const result=confirmAction('<img src=x onerror=bad()>');await Promise.resolve();
  expect(document.querySelector('dialog img')).toBeNull();
  document.querySelectorAll('dialog button')[1].click();expect(await result).toBe(true);
});
it('does not refocus a hidden workspace after cancellation',async()=>{
  const result=confirmAction('Continue?');await Promise.resolve();input.setAttribute('hidden','');
  document.querySelector('dialog').close();expect(await result).toBe(false);expect(input.focus).not.toHaveBeenCalled();
});
it('serializes confirmations and leaves notices with only a close action',async()=>{
  const one=confirmAction('First'),two=confirmAction('Notice',{notice:true});await Promise.resolve();
  expect(document.querySelectorAll('dialog')).toHaveLength(1);document.querySelector('dialog').close();await one;await Promise.resolve();
  expect(document.querySelector('dialog p').textContent).toBe('Notice');expect(document.querySelectorAll('dialog button')).toHaveLength(1);
  document.querySelector('dialog button').click();expect(await two).toBe(false);
});
