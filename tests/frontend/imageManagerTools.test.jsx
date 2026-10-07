import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import ImageManagerTools from '../../src/components/ImageManagerTools';

vi.mock('../../src/components/ImageThumbnail',()=>({default:()=>null}));
let root,window,document,start,records;
const folders=[{id:'source',path:'C:/fixture/source',purpose:'source'},{id:'output',path:'C:/fixture/output',purpose:'output'}];
const Dialog=({children})=><div>{children}</div>;
beforeEach(()=>{
  ({window,document}=parseHTML('<html><body><main id="root"></main></body></html>'));
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  records=Array.from({length:297},(_,i)=>({id:String(i),relative:`fixture-${i}.png`,width:16,height:16,bytes:100}));
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({images:records,total:records.length})})));
  start=vi.fn(async()=>({job_id:'new'}));root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
async function mount(){await act(async()=>root.render(<ImageManagerTools Dialog={Dialog} folders={folders} selected={[]} folderId="source" outputId="output" start={start} onClose={()=>{}}/>));}
const button=()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Create images');
async function select(label,value){await act(async()=>{const field=document.querySelector(`[aria-label="${label}"]`);for(const option of field.querySelectorAll('option'))option.selected=false;field.querySelector(`option[value="${value}"]`).selected=true;field.dispatchEvent(new window.Event('change',{bubbles:true}));});}
it('offers exact large PNG exports and disables only incompatible format choices',async()=>{
  await mount();expect(button().disabled).toBe(false);
  const layout=document.querySelector('[aria-label="Image tools layout"]');
  for(const value of ['grid','horizontal','vertical','balanced'])expect(layout.querySelector(`option[value="${value}"]`).hasAttribute('disabled')).toBe(false);
  expect(layout.querySelector('option[value="gif"]').hasAttribute('disabled')).toBe(true);
  await select('Image tools format','webp');
  for(const value of ['grid','horizontal','vertical'])expect(layout.querySelector(`option[value="${value}"]`).hasAttribute('disabled')).toBe(true);
  await select('Image tools layout','grid');
  expect(document.querySelector('[aria-label="Image tools layout"]').value).toBe('none');
  expect(start).not.toHaveBeenCalled();
});
it('submits a fitted compilation with optional copies off and shows the planned reduction',async()=>{
  await mount();await select('Image tools size mode','fit');await select('Image tools layout','grid');
  expect(button().disabled).toBe(false);
  expect(document.querySelector('[aria-label="Stitched output size"]').textContent).toContain('automatically reduced');
  await act(async()=>button().click());
  expect(start.mock.calls[0][0].image_options).toMatchObject({layout:'grid',standardize:true,size_mode:'fit',columns:0,save_copies:false});
});
it('loads the whole folder and renders a bounded source preview rather than rejecting its count',async()=>{
  records=Array.from({length:1001},(_,i)=>({...records[0],id:String(i)}));
  await mount();
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({folder_id:'source',recursive:true});
  expect(document.querySelectorAll('.im-tools-sources li')).toHaveLength(100);
  await select('Image tools layout','grid');await select('Image tools size mode','pages');
  expect(button().disabled).toBe(false);
  await act(async()=>button().click());
  expect(start.mock.calls[0][0].ids).toHaveLength(1001);
});
it('blocks forced submission when the requested dimensions exceed the chosen codec',async()=>{
  await mount();await select('Image tools layout','grid');await select('Image tools format','webp');
  expect(button().disabled).toBe(true);
  await act(async()=>{button().disabled=false;button().click();});
  expect(start).not.toHaveBeenCalled();
});
it('lets a valid individual-copy task proceed instead of enforcing unused stitch settings',async()=>{
  await mount();await act(async()=>button().click());
  expect(start).toHaveBeenCalledOnce();
  expect(start.mock.calls[0][0].image_options).toMatchObject({layout:'none',standardize:false,width:1024,height:1024});
});

it('keeps Create enabled for a folder containing sources above both former caps',async()=>{
  records[0]={...records[0],width:10000,height:8000,bytes:150_000_000};
  await mount();expect(button().disabled).toBe(false);
  expect(document.querySelector('#im-tools-ready').textContent).not.toContain('smaller source');
  await select('Image tools layout','grid');
  expect(button().disabled).toBe(false);
  await act(async()=>button().click());
  expect(start.mock.calls[0][0].ids).toContain('0');
  expect(start.mock.calls[0][0].image_options).toMatchObject({layout:'grid',size_mode:'exact',save_copies:false});
});
