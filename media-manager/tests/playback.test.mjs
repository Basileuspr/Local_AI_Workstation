import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frameAt,FRAME_STEPS,TIME_STEPS,attachPlayback} from '../frontend/playback.js';
import {parseHTML} from 'linkedom';
test('requested step ranges and variable frame timestamp lookup',()=>{
  assert.deepEqual(FRAME_STEPS,[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(TIME_STEPS,[1,2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50,55,60]);
  assert.equal(frameAt([0,.04,.12,.16,.36],.12),2);
  assert.equal(frameAt([0,.04,.12,.16,.36],.3),3);
  assert.equal(frameAt([0,.04,.12,.16,.36],-1),0);
});

for (const duplicate of [false, true]) test(`${duplicate ? 'duplicate' : 'details'} fullscreen retains the video, controls and playback position`, async () => {
  const {document}=parseHTML('<html><body><dialog open><button data-close>Close</button><div class="mo-viewer-stage"><video></video></div></dialog></body></html>');
  const previous=globalThis.document;globalThis.document=document;
  try {
    const dialog=document.querySelector('dialog'),video=dialog.querySelector('video');
    video.currentTime=.25;video.duration=1;video.paused=true;
    dialog.requestFullscreen=()=>{throw Error('Dialog elements are invalid');};
    attachPlayback({},duplicate ? video.parentElement : dialog,{});
    const surface=dialog.querySelector('.mo-playback-surface'),button=dialog.querySelector('[data-fullscreen]');
    assert.equal(surface.localName,'div');assert.ok(surface.contains(video));assert.ok(surface.contains(button));
    surface.requestFullscreen=async()=>{document.fullscreenElement=surface;surface.onfullscreenchange();};
    document.exitFullscreen=async()=>{document.fullscreenElement=null;surface.onfullscreenchange();};
    await button.onclick();assert.equal(document.fullscreenElement,surface);assert.equal(button.textContent,'Exit fullscreen');
    assert.equal(dialog.querySelector('video'),video);assert.equal(video.currentTime,.25);
    await button.onclick();assert.equal(document.fullscreenElement,null);assert.equal(button.textContent,'Fullscreen');
    surface.requestFullscreen=async()=>{throw Error('Denied by browser');};
    await button.onclick();assert.match(dialog.querySelector('[data-capture-status]').textContent,/Fullscreen unavailable: Denied by browser/);
    assert.equal(video.currentTime,.25);
  } finally {globalThis.document=previous;}
});
