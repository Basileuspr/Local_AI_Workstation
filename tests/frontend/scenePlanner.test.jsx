import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, expect, it, vi} from 'vitest';
import {reviewedActions, previewSceneAction} from '../../src/scenePlanner';
import ScenePlanner from '../../src/components/ScenePlanner';
import * as api from '../../src/imageWorkflowApi';
import {queueDestination} from '../../src/queueNavigation';

const base={character:{clothing:'blue shirt'},body:{wrist_rotation:'neutral'},objects:[{id:'driver',name:'screwdriver'}]};
afterEach(() => vi.unstubAllGlobals());
it('opens scene planning queue entries in the correct workspace', () => {
  expect(queueDestination({kind:'analysis',owner:'scene-planner:p',project_id:'w'})).toEqual({tab:'workflows',workflowId:'w',scene:true});
});
it('reviews ordered changes without mutating the scene and adjusts for omitted actions', () => {
  const actions=[{description:'turn',changes:{body:{wrist_rotation:'clockwise'}}},{description:'turn again',changes:{body:{wrist_rotation:'further clockwise'}}}];
  const plan={base_state:base,proposal:{actions}};
  expect(reviewedActions(plan)[1].review[0]).toEqual({field:'body / wrist rotation',before:'clockwise',after:'further clockwise'});
  expect(reviewedActions(plan,[1])[1].review[0].before).toBe('neutral');
  expect(base.body.wrist_rotation).toBe('neutral');
});
it('shows explicit removals and preserves unrelated objects and character fields', () => {
  const action={changes:{objects:[{id:'brush',name:'brush'}]},remove_objects:['driver']};
  const changed=previewSceneAction(base,action);
  expect(changed.objects).toEqual([{id:'brush',name:'brush'}]);
  expect(changed.character).toEqual(base.character);
  expect(base.objects[0].id).toBe('driver');
  expect(reviewedActions({base_state:base,proposal:{actions:[action]}})[0].review.some(item => item.after==='Removed')).toBe(true);
});
it('offers explicit planning without invoking providers merely by rendering', () => {
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const html=renderToStaticMarkup(<ScenePlanner workflow={{id:'w',revision:2}} active={false} />);
  expect(html).toContain('Propose visual actions');
  expect(html).toContain('Intention for the next frame');
  expect(fetch).not.toHaveBeenCalled();
});
it('sends revision-bound review selections and supports aborting planning', async () => {
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({})});vi.stubGlobal('fetch',fetch);
  const workflow={id:'w',revision:2};const controller=new AbortController();
  await api.planScene(workflow,{request_id:'r',intention:'turn',model:'local'},controller.signal);
  expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  expect(JSON.parse(fetch.mock.calls[0][1].body).revision).toBe(2);
  await api.applyScenePlan(workflow,'p',[1]);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({revision:2,selected_actions:[1]});
  await api.stopScenePlan('w','p');
  expect(fetch.mock.calls[2][0]).toContain('/scene/plans/p/stop');
});
