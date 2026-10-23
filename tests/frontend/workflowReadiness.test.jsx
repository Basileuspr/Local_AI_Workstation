import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ImageWorkflows from '../../src/components/ImageWorkflows';
import ImageMagic from '../../src/components/ImageMagic';
import * as api from '../../src/imageWorkflowApi';
import * as faces from '../../src/faceApi';
import { newStage } from '../../src/imageWorkflow';
import { SCENE_FIELDS } from '../../src/sceneState';

vi.mock('../../src/imageWorkflowApi');
vi.mock('../../src/faceApi');
vi.mock('../../src/components/SceneStudio', () => ({ default: () => null }));
vi.mock('../../src/useStore', () => ({ useStore: () => ({}), useDispatch: () => undefined }));

let root, document, window, metadata, draft;
const reason = 'Image runtime packages missing: diffusers';
const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
const providerSelect = () => [...document.querySelectorAll('label')].find(node => node.textContent.startsWith('Stage 1 provider')).querySelector('select');
async function click(text) { await act(async () => button(text).click()); }

beforeEach(() => {
  vi.resetAllMocks();
  ({ window, document } = parseHTML('<html><body><main id="root"></main></body></html>'));
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  window.HTMLElement.prototype.hidePopover = function () {};
  metadata = { providers: [{ id: 'local-sdxl', name: 'Local SDXL', operations: ['img2img'],
    available: false, unavailable_reason: reason, models: [{ id: 'installed', name: 'Installed SDXL' }] }],
    operations: [{ id: 'img2img', label: 'Image to image', supported: true, help: 'Edit a source.' }] };
  draft = { id: 'workflow', name: 'Existing draft', revision: 3, assets: [], stages: [], scene_notes: '',
    prompt_settings: { prompt: 'Keep this prompt', negative_prompt: '', seed: 42, steps: 30, guidance: 7 } };
  api.catalog.mockImplementation(async () => structuredClone(metadata));
  api.list.mockResolvedValue({ workflows: [], warnings: [] });
  api.create.mockImplementation(async () => structuredClone(draft));
  api.jobs.mockResolvedValue({ jobs: [] });
  faces.listCharacters.mockResolvedValue({ characters: [] });
  root = createRoot(document.getElementById('root'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  delete window.HTMLElement.prototype.hidePopover;
  vi.unstubAllGlobals();
});

it('shows why SDXL is unavailable before selection and refreshes without rewriting the draft', async () => {
  await act(async () => root.render(<ImageWorkflows active />));
  await click('+ New image workflow');
  await click('+ Add stage');
  expect(providerSelect().value).toBe('');
  expect(providerSelect().querySelector('option[value="local-sdxl"]').hasAttribute('disabled')).toBe(true);
  expect(document.querySelector('.workflow-stage [role="status"]').textContent).toContain(reason);
  metadata.providers[0].available = true;
  metadata.providers[0].unavailable_reason = null;
  await click('Refresh providers');
  expect(providerSelect().querySelector('option[value="local-sdxl"]').hasAttribute('disabled')).toBe(false);
  expect(document.querySelector('.workflow-stage [role="status"]')).toBeNull();
  expect(providerSelect().value).toBe('');
  expect([...document.querySelectorAll('label')].find(node => node.textContent.startsWith('Positive prompt')).querySelector('textarea').value).toBe('Keep this prompt');
  expect(api.save).not.toHaveBeenCalled();
});

it('retains an existing model selection while explaining the unavailable runtime', async () => {
  draft.stages = [{ ...newStage(draft, 'img2img'), provider_slot: 'local-sdxl', model_id: 'installed' }];
  await act(async () => root.render(<ImageWorkflows active />));
  await click('+ New image workflow');
  expect(providerSelect().value).toBe('local-sdxl');
  expect(document.querySelector('.workflow-stage [role="status"]').textContent).toContain(reason);
  expect(api.save).not.toHaveBeenCalled();
});

it('reports missing packages in Magic Edit without starting image work', async () => {
  await act(async () => root.render(<ImageMagic />));
  await act(async () => {
    const details = document.querySelector('details');
    details.open = true;
    details.dispatchEvent(new window.Event('toggle'));
  });
  expect(document.querySelector('[role="status"]').textContent).toContain(reason);
  expect(button('Generate edited candidate').hasAttribute('disabled')).toBe(true);
  expect(api.execute).not.toHaveBeenCalled();
});

it('keeps scenes editable while showing the actual runtime failure', async () => {
  const { default: SceneStudio } = await vi.importActual('../../src/components/SceneStudio');
  draft.mode = 'scene';
  const state = { current_action: '', visual_style: '', objects: [],
    ...Object.fromEntries(SCENE_FIELDS.map(([group, , fields]) => [group, Object.fromEntries(fields.map(([key]) => [key, '']))])) };
  draft.scene = { state, model_id: 'installed', identity_asset_ids: [], width: 512, height: 512, denoise: .4 };
  api.sceneFrames.mockResolvedValue({ frames: [], warnings: [] });
  api.scenePlannerModels.mockResolvedValue({ models: [] });
  api.scenePlans.mockResolvedValue({ plans: [] });
  await act(async () => root.render(<SceneStudio active />));
  await click('+ New iterative scene');
  expect(document.querySelector('.workflow-muted[role="status"]').textContent).toContain(reason);
  expect(button('Generate first frame').hasAttribute('disabled')).toBe(true);
  expect(document.querySelector('.workflow-editor').hasAttribute('disabled')).toBe(false);
  expect(api.execute).not.toHaveBeenCalled();
});
