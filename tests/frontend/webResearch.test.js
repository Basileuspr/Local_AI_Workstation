import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {createWebResearch}=require('../../electron/webResearch');
const id='a'.repeat(32);
function fixture(){let current={selected:'default',url:'https://site.example.com/release',title:'Release'};const calls=[];let afterRead=null;
  const browser={state:()=>({...current}),startWorkflow:async()=>({workflowId:'fixture',page:{pageRef:'bound-page'}}),
    browserTool:async()=>{afterRead?.();return {pageRef:'bound-page',text:'Bearer PRIVATE token=SECRET Captured body.'};},cancelWorkflow:async()=>calls.push('cancel')};
  const service=createWebResearch({browser,request:async(route,body)=>{calls.push({route,body});return {status:'RUNNING'};}});
  return {service,calls,change:value=>{current={...current,...value};},onRead:callback=>{afterRead=callback;}};
}
describe('Explicit rendered research fallback',()=>{
  it('reads one selected document and redacts session secrets',async()=>{const f=fixture();await f.service.read(id);expect(f.calls.at(-1)).toBe('cancel');expect(f.calls[0].body.text).not.toMatch(/PRIVATE|SECRET/);expect(f.calls[0].route).toContain(id);});
  it('rejects changed profiles or documents before handoff',async()=>{const f=fixture();f.onRead(()=>f.change({selected:'different'}));await expect(f.service.read(id)).rejects.toThrow('changed');expect(f.calls).toEqual(['cancel']);});
  it('rejects signed URLs and arbitrary operations',async()=>{const f=fixture();f.change({url:'https://site.example.com/?token=SECRET'});await expect(f.service.read(id)).rejects.toThrow('stable');await expect(f.service.read('bad/id')).rejects.toThrow('current');expect(()=>f.service.background('True')).toThrow('enable');});
});
