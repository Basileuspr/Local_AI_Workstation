import {describe,expect,it} from 'vitest';
import {activeImageTasks,restoreImageTaskHistory} from '../../src/imageTaskState';

const task = (id,index,status='running') => ({request_id:id,session_id:'chat',batch_id:'batch',batch_index:index,batch_count:3,status,prompt:'Forest',
  ...(status === 'completed' ? {result:{url:`/saved/${id}`,request_id:id,batch_id:'batch',seed:index}} : {})});
describe('reconnecting to image generation', () => {
  it('restores completed slots and active request identities after a UI refresh', () => {
    const tasks = [task('one',0,'completed'),task('two',1),task('three',2,'queued')];
    const restored = restoreImageTaskHistory(tasks);
    expect(restored.batch.slots.map(slot => slot.status)).toEqual(['complete','pending','pending']);
    expect(restored.batch.slots[0].image.seed).toBe(0);
    expect(activeImageTasks(tasks).map(item => [item.id,item.batchLabel])).toEqual([['two','Image 2 of 3'],['three','Image 3 of 3']]);
  });
  it('restores stopped and failed slots without resetting their original positions', () => {
    const restored = restoreImageTaskHistory([task('one',0,'cancelled'),{...task('two',1,'failed'),error:'Out of memory'},task('three',2,'completed')]);
    expect(restored.batch.slots.map(slot => slot.status)).toEqual(['stopped','failed','complete']);
    expect(restored.batch.slots[1].error).toBe('Out of memory');
  });
  it('selects the newest submission without moving older results into it', () => {
    const tasks = [task('old',0,'completed'),{...task('new',0),batch_id:'new-batch',batch_count:1}];
    const restored = restoreImageTaskHistory(tasks);
    expect(restored.batch.id).toBe('new-batch');
    expect(restored.batch.slots.map(slot => slot.id)).toEqual(['new']);
    expect(restored.images).toHaveLength(1);
  });
});
