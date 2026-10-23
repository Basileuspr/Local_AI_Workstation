import {parseHTML} from 'linkedom';
import {beforeAll, afterAll, afterEach, it, expect, vi} from 'vitest';
vi.mock('../../media-manager/frontend/review.js',()=>({mountReview:()=>{}}));
let document, window, MediaOrganizer, ui;
beforeAll(async()=>{
  ({document,window}=parseHTML('<html><body></body></html>'));
  for(const [key,value] of Object.entries({document,window,HTMLElement:window.HTMLElement,customElements:window.customElements,
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}}}))vi.stubGlobal(key,value);
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this._value || '';},set(value){this._value=value;}});
  ({MediaOrganizer}=await import('../../media-manager/frontend/organizer.js'));
  vi.spyOn(MediaOrganizer.prototype,'poll').mockResolvedValue();
  vi.spyOn(MediaOrganizer.prototype,'renderLibrary').mockImplementation(()=>{});
});
afterEach(()=>{ui?.remove();});
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function mount(){ui=document.createElement('media-organizer');ui.adapter={};document.body.append(ui);return ui.querySelector('[aria-label="Media library controls"]');}
it('keeps exactly one connected control for every media action after grouping the toolbar',()=>{
  const controls=mount(),ids=[...ui.querySelectorAll('[id]')].map(node=>node.id);
  expect(new Set(ids).size).toBe(ids.length);
  for(const id of ['mo-page-size','mo-search','mo-category','mo-order','mo-grouping','mo-selection-bar'])expect(controls.contains(ui.querySelector('#'+id))).toBe(true);
  expect(controls.contains(ui.querySelector('#mo-results'))).toBe(false);
});
it('retains the search, view and batch-size handlers on the visible controls',()=>{
  const controls=mount();
  const search=controls.querySelector('#mo-search');search.value='fixture';search.dispatchEvent(new window.Event('input',{bubbles:true}));
  expect(ui.filters.query).toBe('fixture');
  controls.querySelector('[data-view="list"]').click();expect(ui.view).toBe('list');
  const size=controls.querySelector('#mo-page-size');size.value='100';size.dispatchEvent(new window.Event('change'));
  expect(ui.pageSize).toBe(100);expect(ui.limit).toBe(100);expect(ui.renderLibrary).toHaveBeenCalled();
});
