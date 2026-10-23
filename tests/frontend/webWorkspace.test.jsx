import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import WebWorkspace from '../../src/components/WebWorkspace';
import {webSystem} from '../../src/webSystem';

vi.mock('../../src/webSystem',async original=>({...await original(),webSystem:vi.fn()}));
vi.mock('../../src/components/ViewerBrowser',()=>({default:({active})=><div data-browser-active={String(active)}/>}));
vi.mock('../../src/components/WebSearch',()=>({default:({active})=><div data-search-active={String(active)}><input aria-label="Search draft"/></div>}));
vi.mock('../../src/components/SearchProviderSettings',()=>({default:()=>null}));
vi.mock('../../src/components/WebAccess',()=>({default:({active,model,isGenerating,onOpenSession})=><div data-import-active={String(active)} data-model={model}>
  <input aria-label="Import draft"/><button disabled={isGenerating} onClick={()=>onOpenSession('source-chat')}>Open import source chat</button>
</div>}));

let root;
const models=[{name:'local-text'}];
beforeEach(()=>{
  vi.useFakeTimers();
  const {window,document}=parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  webSystem.mockImplementation(async path=>path==='/state'?{sources:[],jobs:[],events:[],worker:{}}:{provider:'wikipedia'});
  root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks();});
async function render(props={}){await act(async()=>root.render(<WebWorkspace active models={models} {...props}/>));}
function tab(label){return [...document.querySelectorAll('[role="tab"]')].find(node=>node.textContent===label);}
async function click(label){await act(async()=>[...document.querySelectorAll('button')].find(node=>node.textContent===label).click());}
async function key(label,key){await act(async()=>{const event=new window.Event('keydown',{bubbles:true,cancelable:true});event.key=key;tab(label).dispatchEvent(event);expect(event.defaultPrevented).toBe(true);});}
async function change(label,value){await act(async()=>{const element=document.querySelector(`[aria-label="${label}"]`);element[Object.keys(element).find(k=>k.startsWith('__reactProps$'))].onChange({target:{value}});});}

it('links keyboard-operated mode tabs to one visible panel with a single tab stop',async()=>{
  await render();
  expect([...document.querySelectorAll('[role="tab"]')].map(node=>node.textContent)).toEqual(['Search & preview','Live research','Recurring sources','Import page']);
  for(const node of document.querySelectorAll('[role="tab"]')){
    const panel=document.getElementById(node.getAttribute('aria-controls'));
    expect(panel.getAttribute('role')).toBe('tabpanel');expect(panel.getAttribute('aria-labelledby')).toBe(node.id);
  }
  await key('Search & preview','ArrowRight');expect(tab('Live research').getAttribute('aria-selected')).toBe('true');
  await key('Live research','End');expect(tab('Import page').getAttribute('aria-selected')).toBe('true');
  await key('Import page','ArrowRight');expect(tab('Search & preview').getAttribute('aria-selected')).toBe('true');
  await key('Search & preview','ArrowLeft');expect(tab('Import page').getAttribute('aria-selected')).toBe('true');
  await key('Import page','Home');
  expect(document.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  expect(document.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
});

it('retains research, source and import drafts and releases an inactive browser fallback',async()=>{
  await render();await click('Live research');await change('Research question','Keep this research question');
  const question=document.querySelector('[aria-label="Research question"]');
  await click('Browser fallback');expect(document.querySelector('[data-browser-active]').dataset.browserActive).toBe('true');
  await click('Recurring sources');await change('Source name','Keep this source');
  expect(document.querySelector('[data-browser-active]').dataset.browserActive).toBe('false');
  await click('Import page');const draft=document.querySelector('[aria-label="Import draft"]');draft.value='https://source.example/article';
  expect(document.querySelector('[data-import-active]').dataset.importActive).toBe('true');
  await click('Live research');
  expect(document.querySelector('[aria-label="Research question"]')).toBe(question);expect(question.value).toBe('Keep this research question');
  expect(document.querySelector('[aria-label="Source name"]').value).toBe('Keep this source');
  expect(document.querySelector('[aria-label="Import draft"]')).toBe(draft);expect(draft.value).toBe('https://source.example/article');
  await render({active:false});expect(document.querySelector('[data-browser-active]').dataset.browserActive).toBe('false');
});

it('uses the shared source-chat handoff and reply guard for the new import mode',async()=>{
  const open=vi.fn();await render({chatModel:'chosen-chat-model',onOpenSession:open,isGenerating:true});await click('Import page');
  expect(document.querySelector('[data-import-active]').dataset.model).toBe('chosen-chat-model');
  expect([...document.querySelectorAll('button')].find(node=>node.textContent==='Open import source chat').disabled).toBe(true);
  await render({chatModel:'chosen-chat-model',onOpenSession:open});await click('Open import source chat');
  expect(open).toHaveBeenCalledWith('source-chat');
});
