import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import LoraStudio from '../../src/components/LoraStudio';
import * as api from '../../src/api';

const dispatch = vi.fn();
vi.mock('../../src/useStore.jsx', () => ({useStore: () => ({connected:true, activeLoraProjectId:'project'}), useDispatch: () => dispatch}));
vi.mock('../../src/workspaceInfoContext', () => ({useLoraInfo: () => {}}));
vi.mock('../../src/components/PromptQueue', () => ({QueueRequestStatus: () => null}));
vi.mock('../../src/components/CharacterLinks', () => ({default: () => null}));
vi.mock('../../src/api', () => ({listLoraProjects:vi.fn(), getLoraProject:vi.fn(), getLoraPreflight:vi.fn(),
  loadImageGenerationModels:vi.fn(), loraHardware:vi.fn(), listLoraVisionModels:vi.fn(),
  recoverLoraTraining:vi.fn(), cancelLoraTraining:vi.fn(), startLoraTraining:vi.fn(), getLoraTraining:vi.fn()}));

let root, document, project;
beforeEach(() => {
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  document = dom.document;
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  project = {id:'project', name:'Restart test', description:'', trigger_word:'', training_goal:'style',
    base_model_id:'sdxl', vision_model:'', output_location:'', settings:{}, images:[],
    training:{status:'running', recovery_required:true, logs:['Saved progress']}};
  api.listLoraProjects.mockResolvedValue([{id:'project', name:'Restart test'}]);
  api.getLoraProject.mockImplementation(async () => project);
  api.getLoraPreflight.mockResolvedValue({valid:true, errors:[], warnings:[]});
  api.loadImageGenerationModels.mockResolvedValue({models:[{id:'sdxl', name:'Test model'}]});
  api.loraHardware.mockResolvedValue({cuda_available:true, training_ready:true});
  api.listLoraVisionModels.mockResolvedValue([]);
  root = createRoot(document.getElementById('root'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text);
async function mount() {await act(async () => root.render(<LoraStudio/>));}

it('offers deliberate orphan recovery and re-enables training after recovery', async () => {
  api.recoverLoraTraining.mockImplementation(async () => {
    project = {...project, training:{status:'interrupted', recovery_required:false, logs:['Saved progress']}};
    return project.training;
  });
  await mount();
  expect(button('Recover previous run')).toBeDefined();
  expect(button('Cancel safely')).toBeUndefined();
  expect(button('Start local training')).toBeUndefined();
  await act(async () => button('Recover previous run').click());
  expect(api.recoverLoraTraining).toHaveBeenCalledWith('project');
  expect(api.cancelLoraTraining).not.toHaveBeenCalled();
  expect(api.startLoraTraining).not.toHaveBeenCalled();
  expect(button('Recover previous run')).toBeUndefined();
  expect(button('Start local training').disabled).toBe(false);
  expect(document.querySelector('.lora-log').textContent).toContain('Saved progress');
});

it('keeps recovery available and training blocked when stopping the worker fails', async () => {
  api.recoverLoraTraining.mockRejectedValue(new Error('Worker ownership could not be verified'));
  await mount();
  await act(async () => button('Recover previous run').click());
  expect(button('Recover previous run').disabled).toBe(false);
  expect(button('Start local training')).toBeUndefined();
  expect(dispatch).toHaveBeenCalledWith({type:'SHOW_TOAST', payload:{message:'Worker ownership could not be verified', type:'error'}});
});

it('uses ordinary cancellation for a run owned by the current backend', async () => {
  project.training.recovery_required = false;
  await mount();
  expect(button('Cancel safely')).toBeDefined();
  expect(button('Recover previous run')).toBeUndefined();
});

it('sends recovery through the existing authenticated LoRA API contract', async () => {
  const actualApi = await vi.importActual('../../src/api');
  const fetch = vi.fn().mockResolvedValue({ok:true, json:async () => ({status:'interrupted'})});
  vi.stubGlobal('fetch', fetch);
  expect(await actualApi.recoverLoraTraining('project/one')).toEqual({status:'interrupted'});
  expect(fetch.mock.calls[0][0]).toContain('/lora/projects/project%2Fone/recover');
  expect(fetch.mock.calls[0][1]).toEqual({method:'POST'});
});
