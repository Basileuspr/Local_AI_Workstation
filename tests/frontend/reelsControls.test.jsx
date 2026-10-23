import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import ReelsAnalyzer from '../../src/components/ReelsAnalyzer';

vi.mock('../../src/components/ViewerBrowser',()=>({default:({active})=><div className="viewer-browser" data-active={String(active)}/>}));
let root,desktop,state;
beforeEach(()=>{
  vi.useFakeTimers();const {window,document}=parseHTML('<html><body><main id="root"></main></body></html>');
  vi.stubGlobal('window',window);vi.stubGlobal('document',document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  state={batches:[],summaries:[]};desktop={reelsState:vi.fn(async()=>state),viewerBrowserState:vi.fn(async()=>({selected:'default',ready:true})),
    discoverReels:vi.fn(async()=>({reels:[{url:'https://site.example/reel/1'}],sourceUrl:'https://site.example/conversation'})),
    startReels:vi.fn(async()=>({batchId:'batch'})),pauseReels:vi.fn(async()=>({})),cancelReels:vi.fn(async()=>({})),clearReelsCache:vi.fn(),reelsAccountControls:vi.fn()};
  window.workstationDesktop=desktop;root=createRoot(document.getElementById('root'));
});
afterEach(async()=>{await act(async()=>root.unmount());vi.useRealTimers();vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(<ReelsAnalyzer active models={[{name:'local-vision',supports_vision:true},{name:'local-text'}]} defaultModel="local-text"/>));}
function button(text){return [...document.querySelectorAll('button')].find(node=>node.textContent===text);}

it('presents setup and collapsed cache controls, then starts with the same selected models and source',async()=>{
  await render();expect([...document.querySelectorAll('.reels-step h3')].map(node=>node.textContent)).toEqual(['1. Account & conversation','2. Local analysis']);
  expect(button('Pause after this reel')).toBeUndefined();expect(button('Cancel')).toBeUndefined();
  expect(button('Clear cache').closest('details').hasAttribute('open')).toBe(false);
  expect(button('Analyze discovered reels').disabled).toBe(true);
  await act(async()=>button('Use this conversation').click());
  expect(button('Analyze discovered reels').disabled).toBe(false);
  await act(async()=>button('Analyze discovered reels').click());
  expect(desktop.startReels).toHaveBeenCalledWith({visionModel:'local-vision',summaryModel:'local-text',whisperModel:'small',videoName:''});
  expect(document.querySelector('.viewer-browser')).toBeNull();
});

it('reveals pause and cancel during active processing and locks account and cache actions',async()=>{
  state={...state,active:{index:0,stage:'analyzing',pauseRequested:false}};await render();
  expect(button('Pause after this reel').disabled).toBe(false);expect(button('Cancel').getAttribute('aria-label')).toBe('Cancel reel analysis');
  expect(button('Use this conversation').disabled).toBe(true);expect(button('Clear cache').disabled).toBe(true);
  expect(document.querySelector('.viewer-browser')).toBeNull();
  await act(async()=>button('Pause after this reel').click());expect(desktop.pauseReels).toHaveBeenCalledOnce();
  await act(async()=>button('Cancel').click());expect(desktop.cancelReels).toHaveBeenCalledOnce();
});
