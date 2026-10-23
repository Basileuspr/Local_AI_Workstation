import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import WebAccess from '../../src/components/WebAccess';
import {getActiveWebImport,getWebImport,startWebImport,stopWebImport} from '../../src/webAccess';

vi.mock('../../src/useStore',()=>({useStore:()=>({selectedModel:'local',isGenerating:false})}));
vi.mock('../../src/webAccess',()=>({getActiveWebImport:vi.fn(),getWebImport:vi.fn(),startWebImport:vi.fn(),stopWebImport:vi.fn(),createWebChat:vi.fn(),webImageUrl:()=>''}));
vi.mock('../../src/components/WebImageReader',()=>({default:()=>null}));
let root;
beforeEach(()=>{
  vi.useFakeTimers();const {window,document}=parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  getActiveWebImport.mockResolvedValue({job:null});root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();vi.resetAllMocks();});
async function render(props={}){await act(async()=>root.render(<WebAccess embedded {...props}/>));}

it('keeps labels unique when Chat and Web both mount the same importer',async()=>{
  await act(async()=>root.render(<><WebAccess embedded active={false}/><WebAccess embedded active/></>));
  const inputs=[...document.querySelectorAll('input[type="url"]')];
  expect(new Set(inputs.map(input=>input.id)).size).toBe(2);
  for(const label of document.querySelectorAll('label[for]'))expect(inputs).toContain(document.getElementById(label.htmlFor||label.getAttribute('for')));
  expect(getActiveWebImport).toHaveBeenCalledTimes(1);
});

it('recovers and stops an import started through the other entry point when revealed',async()=>{
  await render({active:false});expect(getActiveWebImport).not.toHaveBeenCalled();
  const job={id:'shared-import',status:'running',message:'Importing shared page'};
  getActiveWebImport.mockResolvedValue({job});getWebImport.mockResolvedValue(job);
  await render({active:true});expect(document.body.textContent).toContain('Importing shared page');
  expect(document.querySelector('input[type="url"]').disabled).toBe(true);
  stopWebImport.mockResolvedValue({...job,status:'cancelled',message:'Stopped'});
  await act(async()=>[...document.querySelectorAll('button')].find(node=>node.textContent==='Stop import').click());
  expect(stopWebImport).toHaveBeenCalledWith('shared-import');expect(document.body.textContent).toContain('Stopped');
  expect(document.querySelector('input[type="url"]').disabled).toBe(false);
});

it('ignores a stale recovery response after a new import was submitted',async()=>{
  let recover;getActiveWebImport.mockImplementation(()=>new Promise(resolve=>{recover=resolve;}));
  const job={id:'new-import',status:'running',message:'New import running'};
  startWebImport.mockResolvedValue(job);getWebImport.mockResolvedValue(job);
  await render();await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  await act(async()=>recover({job:{id:'old-import',status:'running',message:'Stale import'}}));
  expect(document.body.textContent).toContain('New import running');expect(document.body.textContent).not.toContain('Stale import');
  expect(getWebImport.mock.calls.every(([id])=>id==='new-import')).toBe(true);
});
