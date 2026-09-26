import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frameAt,FRAME_STEPS,TIME_STEPS} from '../frontend/playback.js';
test('requested step ranges and variable frame timestamp lookup',()=>{
  assert.deepEqual(FRAME_STEPS,[1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(TIME_STEPS,[1,2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50,55,60]);
  assert.equal(frameAt([0,.04,.12,.16,.36],.12),2);
  assert.equal(frameAt([0,.04,.12,.16,.36],.3),3);
  assert.equal(frameAt([0,.04,.12,.16,.36],-1),0);
});
