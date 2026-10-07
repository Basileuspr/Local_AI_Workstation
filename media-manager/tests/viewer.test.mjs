import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement = class {};
globalThis.customElements = {get:()=>true};
globalThis.document = {hidden:false};
const {MediaOrganizer} = await import('../frontend/organizer.js');

const record = (id,path='source.mp4') => ({RecordId:id,SHA256:'a'.repeat(64),Available:true,
  CurrentPath:path,OriginalFilename:path,DuplicatePrimary:id==='primary'?'yes':'no'});

function workspace() {
  const ui = Object.create(MediaOrganizer.prototype);
  Object.assign(ui,{isConnected:true,busy:false,libraryRequest:1,
    data:{uiRunId:'scan',records:[record('primary')]},selected:new Set(['primary']),
    filters:{query:'saved search'},duplicateFilters:{year:'2024'},limit:80,duplicateLimit:24,
    adapter:{library:async()=>({uiRunId:'scan',records:[{...record('primary'),Available:false}]})},
    updatePlan(){},renderLibrary(){this.renders=(this.renders||0)+1;},
    querySelector:()=>({open:true})});
  return ui;
}

test('availability updates while a viewer is open without resetting browsing state',async()=>{
  const ui=workspace(), filters=ui.filters, duplicates=ui.duplicateFilters, selection=ui.selected;
  await ui.refreshAvailability();
  assert.equal(ui.data.records[0].Available,false);
  assert.equal(ui.renders,1);
  assert.equal(ui.filters,filters);assert.equal(ui.duplicateFilters,duplicates);assert.equal(ui.selected,selection);
  assert.equal(ui.limit,80);assert.equal(ui.duplicateLimit,24);assert.equal(ui.checkingAvailability,false);
});

test('late availability results cannot overwrite a newly selected scan',async()=>{
  const ui=workspace();let resolve;
  ui.adapter.library=()=>new Promise(done=>{resolve=done;});
  const pending=ui.refreshAvailability();
  const replacement={uiRunId:'another-scan',records:[]};ui.data=replacement;ui.libraryRequest++;
  resolve({uiRunId:'scan',records:[]});await pending;
  assert.equal(ui.data,replacement);assert.equal(ui.renders,undefined);
});

test('failed checks preserve the last known records and retry can succeed',async()=>{
  const ui=workspace(), previous=ui.data;
  ui.adapter.library=async()=>{throw Error('disconnected');};await ui.refreshAvailability();
  assert.equal(ui.data,previous);assert.equal(ui.checkingAvailability,false);
  ui.adapter.library=async()=>({uiRunId:'scan',records:[]});await ui.refreshAvailability();
  assert.equal(ui.data.records.length,0);
});

test('idle polling refreshes server state and file availability once per poll',async()=>{
  const ui=workspace();let refreshes=0,checks=0,release;
  ui.refresh=()=>{refreshes++;return new Promise(done=>{release=done;});};
  ui.refreshAvailability=async()=>{checks++;};
  const pending=ui.poll();await ui.poll();assert.equal(refreshes,1);
  release();await pending;assert.equal(checks,1);assert.equal(ui.polling,false);
});

test('viewer navigation uses current available copies and retains the missing current copy',()=>{
  const ui=workspace();ui.data.records=[record('extra','copy.mp4'),record('primary'),
    {...record('missing'),Available:false}, {...record('trash'),Trashed:true}, {...record('different'),SHA256:'b'.repeat(64)}];
  ui.data.records[0].SHA256='A'.repeat(64);
  assert.deepEqual(ui.duplicateViewerGroup('extra').copies.map(row=>row.RecordId),['primary','extra']);
  assert.deepEqual(ui.duplicateViewerGroup('missing').copies.map(row=>row.RecordId),['primary','extra','missing']);
  assert.equal(ui.duplicateViewerGroup('unknown'),null);
});

function viewer(ui) {
  const nodes = new Map();
  const dialog={open:true,dataset:{runId:'scan',recordId:'primary',currentPath:'source.mp4'},
    querySelector(selector){return nodes.get(selector) || null;}};
  for(const selector of ['[data-viewer-status]','[data-viewer-play]','[data-viewer-reveal]',
    '[data-copy-previous]','[data-copy-next]','#mo-duplicate-viewer-title','.mo-viewer-location code','.mo-viewer-heading p','[data-play]'])
    nodes.set(selector,{textContent:'',disabled:false});
  const video={paused:false,currentTime:12,source:'url',hasAttribute(){return !!this.source;},
    pause(){this.paused=true;},removeAttribute(){this.source=null;},load(){this.loads=(this.loads||0)+1;},
    set src(value){this.source=value;},play(){this.paused=false;return Promise.resolve();}};
  nodes.set('video',video);ui.$=()=>dialog;ui.adapter.mediaUrl=()=> 'refreshed-url';
  return {dialog,nodes,video};
}

test('unchanged refresh preserves the decoded video and playback position',()=>{
  const ui=workspace(), {video}=viewer(ui);ui.syncDuplicateViewer();
  assert.equal(video.currentTime,12);assert.equal(video.paused,false);assert.equal(video.loads,undefined);
});

test('missing files stop the old stream and restore permits playback without closing the viewer',()=>{
  const ui=workspace(), {video,nodes,dialog}=viewer(ui);
  ui.data.records[0].Available=false;ui.syncDuplicateViewer();
  assert.equal(video.source,null);assert.equal(video.paused,true);
  assert.equal(nodes.get('[data-viewer-play]').disabled,true);
  assert.match(nodes.get('[data-viewer-status]').textContent,/unavailable/);
  ui.data.records[0].Available=true;ui.syncDuplicateViewer();
  assert.equal(video.source,'refreshed-url');assert.equal(nodes.get('[data-viewer-play]').disabled,false);
  assert.equal(dialog.open,true);
});

test('switching scans cannot retarget an open player to a matching local record ID',()=>{
  const ui=workspace(), {video,nodes}=viewer(ui);ui.data.uiRunId='other';ui.syncDuplicateViewer();
  assert.equal(video.source,null);assert.equal(nodes.get('[data-copy-next]').disabled,true);
});
