import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach, expect, it, vi} from 'vitest';
import WebSearch from '../../src/components/WebSearch';
import SearchProviderSettings from '../../src/components/SearchProviderSettings';
import {webSystem} from '../../src/webSystem';
import {createWebChat} from '../../src/webAccess';

vi.mock('../../src/webSystem', () => ({webSystem:vi.fn()}));
vi.mock('../../src/webAccess', () => ({createWebChat:vi.fn(), webImageUrl:src => src?.startsWith('blob:') ? '/web/images/' + src.slice(5) : ''}));
vi.mock('../../src/components/WebImageReader', () => ({default:({images, sourceFor}) => <div>{images.map(image => <img key={image.id} src={sourceFor(image)} alt={image.name}/>)}</div>}));
let root;
const config = {provider:'wikipedia', endpoint:'', key_configured:false, key_source:'none'};
const expires = () => Date.now()/1000 + 1800;
const source = {id:'page', title:'Source page', url:'https://site.example.com/article', requested_url:'https://site.example.com/article',
  description:'Captured source description.', description_kind:'page_excerpt', text:'Readable source text.', char_count:21,
  fetched_at:'2026-10-22T08:00:00Z', images:[], image_warnings:[]};

afterEach(async () => {if(root)await act(async () => root.unmount());root=null;vi.useRealTimers();vi.unstubAllGlobals();vi.resetAllMocks();});
async function mount(component) {
  vi.useFakeTimers();
  const {window, document} = parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window', window);vi.stubGlobal('document', document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root=createRoot(document.getElementById('root'));await act(async () => root.render(component));
}
async function click(text) {await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent===text).click());}
async function change(label,value) {
  await act(async () => {
    const element=document.querySelector(`[aria-label="${label}"]`);
    Object.defineProperty(element,'value',{value,configurable:true,writable:true});
    // linkedom does not implement React's browser text-input value tracker.
    // The real input event path is covered by qa-web.cjs in Chromium.
    const props=element[Object.keys(element).find(key=>key.startsWith('__reactProps$'))];
    props.onChange({target:element});
  });
}
async function submit(index) {await act(async () => document.querySelectorAll('form')[index].dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));}
async function tick(ms=1100) {await act(async () => vi.advanceTimersByTimeAsync(ms));}

function fixture() {
  let search = {id:'search',kind:'search',status:'PENDING',value:'solar',provider:'wikipedia',results:[],expires_at:expires()};
  const completed = {...search,status:'COMPLETED',results:[{title:'Solar source',url:'https://site.example.com/article',domain:'site.example.com',snippet:'A search snippet.'}]};
  webSystem.mockImplementation(async (path) => {
    if (path==='/lookup/active')return {job:null};
    if (path==='/lookup')return search;
    if (path==='/lookup/search')return completed;
    if (path==='/preview')return {id:'preview',kind:'preview',status:'PENDING'};
    if (path==='/lookup/preview')return {id:'preview',kind:'preview',status:'FAILED',error:'Page denied automated access.',expires_at:expires()};
    return {discarded:true};
  });
}

it('returns provider-labelled results without a model and preserves them on preview failure', async () => {
  fixture();
  await mount(<WebSearch active config={config} onConfig={()=>{}}/>);
  // Submission drives the form contract; no installed model is supplied.
  await submit(0);await tick();
  expect(document.querySelector('.web-search-results').textContent).toContain('A search snippet.');
  expect(document.body.textContent).toContain('encyclopedia only');
  expect(document.querySelector('.web-search-results img')).toBeNull();
  await click('Preview this page');await tick();
  expect(document.querySelector('.web-search-results').textContent).toContain('Solar source');
  expect(document.body.textContent).toContain('Page denied automated access.');
  expect(webSystem).toHaveBeenCalledWith('/preview',{url:'https://site.example.com/article',include_image:true});
});

it('shows captured text while the image is still running and permits cancellation', async () => {
  webSystem.mockImplementation(async path => {
    if(path==='/lookup/active')return {job:{id:'preview',kind:'preview',status:'RUNNING',stage:'image',source}};
    if(path.endsWith('/cancel'))return {id:'preview',kind:'preview',status:'CANCELLED',source};
    return {id:'preview',kind:'preview',status:'RUNNING',stage:'image',source};
  });
  await mount(<WebSearch active config={config} onConfig={()=>{}}/>);await tick();
  expect(document.querySelector('.web-page-preview').textContent).toContain('Captured source description.');
  await click('Stop web request');
  expect(document.body.textContent).toContain('Web request stopped.');
  expect(document.querySelector('.web-page-preview')).not.toBeNull();
});

it('saves one source chat with local image references and reopens it without duplicates', async () => {
  const captured={...source,images:[{id:'image',src:'blob:'+'a'.repeat(64),name:'Photo'}]};
  webSystem.mockResolvedValueOnce({job:{id:'preview',kind:'preview',status:'RUNNING'}})
    .mockResolvedValue({id:'preview',kind:'preview',status:'COMPLETED',source:captured,expires_at:expires()});
  createWebChat.mockResolvedValue({id:'chat',title:'Web: Source page'});
  const open=vi.fn(async()=>true);
  await mount(<WebSearch active config={config} onConfig={()=>{}} model="local-model" onOpenSession={open}/>);await tick();
  expect(document.querySelector('.web-page-preview img').getAttribute('src')).toBe('/web/images/'+'a'.repeat(64));
  await click('Save source in new chat');await click('Open saved source chat');
  expect(createWebChat).toHaveBeenCalledTimes(1);expect(createWebChat).toHaveBeenCalledWith(captured,'local-model');
  expect(open).toHaveBeenCalledTimes(2);
});

it('keeps prior results labelled when a later search fails and expires visible text', async () => {
  fixture();await mount(<WebSearch active config={config} onConfig={()=>{}}/>);await submit(0);await tick();
  webSystem.mockImplementation(async path => path==='/lookup'?{id:'second',kind:'search',status:'FAILED',error:'Provider unavailable',expires_at:expires()}:{job:null});
  await submit(0);
  expect(document.body.textContent).toContain('Results for “solar”');
  expect(document.body.textContent).toContain('Provider unavailable');
  await tick(1830000);
  expect(document.querySelector('.web-search-results')).toBeNull();
});

it('keeps results when clearing fails instead of claiming the backend was cleared', async () => {
  fixture();await mount(<WebSearch active config={config} onConfig={()=>{}}/>);await submit(0);await tick();
  webSystem.mockRejectedValue(new Error('Connection lost'));
  await click('Clear results');
  expect(document.body.textContent).toContain('Connection lost');
  expect(document.querySelector('.web-search-results')).not.toBeNull();
});

it('saves only explicit provider fields, clears the key input, and never receives a key back', async () => {
  webSystem.mockResolvedValue({...config,provider:'brave',key_configured:true,key_source:'session'});
  const saved=vi.fn();
  await mount(<SearchProviderSettings config={{...config,provider:'brave'}} onSaved={saved}/>);
  await change('Brave API key','fixture-credential');await click('Save search provider');
  expect(webSystem).toHaveBeenCalledWith('/search',{provider:'brave',endpoint:'',api_key:'fixture-credential',clear_api_key:false},'PUT');
  expect(document.querySelector('[aria-label="Brave API key"]').value).toBe('');
  expect(JSON.stringify(saved.mock.calls)).not.toContain('fixture-credential');
});

it('ignores an old active-job response that arrives after a new submission', async () => {
  let old;
  webSystem.mockImplementation(path => path==='/lookup/active' ? new Promise(resolve=>{old=resolve;}) :
    Promise.resolve({id:'new',kind:'search',status:'COMPLETED',value:'new query',provider:'wikipedia',results:[]}));
  await mount(<WebSearch active config={config} onConfig={()=>{}}/>);await submit(0);
  await act(async () => old({job:{id:'stale',kind:'search',status:'RUNNING'}}));
  expect(document.body.textContent).toContain('new query');
  expect(webSystem.mock.calls.some(([path])=>path==='/lookup/stale')).toBe(false);
});

it('releases the controls after a backend restart while preserving captured text', async () => {
  webSystem.mockResolvedValueOnce({job:{id:'preview',kind:'preview',status:'RUNNING',source}})
    .mockRejectedValue(Object.assign(new Error('Unavailable job'),{status:400}));
  await mount(<WebSearch active config={config} onConfig={()=>{}}/>);await tick();
  expect(document.body.textContent).toContain('backend restarted');
  expect(document.querySelector('.web-page-preview').textContent).toContain('Readable source text.');
  expect([...document.querySelectorAll('button')].find(b=>b.textContent==='Clear results').disabled).toBe(false);
  expect(document.body.textContent).not.toContain('Stop web request');
});
