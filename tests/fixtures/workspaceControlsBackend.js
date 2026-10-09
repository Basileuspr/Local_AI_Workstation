// UI-only preview. Every API call is answered here; no live backend, user data,
// model inference, device actions, or filesystem operations are available.
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const actualFetch = window.fetch.bind(window);
window.workspaceControlsQA = { requests: [], errors: [] };
window.addEventListener('error', event => window.workspaceControlsQA.errors.push(event.message));
window.addEventListener('unhandledrejection', event => window.workspaceControlsQA.errors.push(event.reason?.message || String(event.reason)));
if (!window.workstationDesktop) window.workstationDesktop = {
  connection: { base: 'http://127.0.0.1:1', token: '' },
  localDocumentDirty() {},
};
const project = { id: 'preview-project', name: 'Preview training settings', images: [], settings: {},
  training: { status: 'draft', logs: [] }, base_model_id: 'preview-image', trigger_word: 'preview' };
const models = [{ id: 'preview-image', name: 'Preview image model', pipeline: 'SDXL', supports_reference: true }];
const responses = {
  '/models': { models: ['Preview text model'] },
  '/status': { backend: { ok: true }, ollama: { reachable: false }, models: { chat_count: 1 }, knowledge_base: { ok: true, documents: 0 } },
  '/runtime/status': { loaded: false, busy: false, models: [], active: [] },
  '/sessions/list': { sessions: [] }, '/sessions/deleted': { sessions: [] },
  '/sessions/images': { images: [], hidden_images: [] },
  '/files/knowledge-base/list': { documents: [] },
  '/files/knowledge-base/graph': { nodes: [], edges: [] },
  '/prompt-index': { entries: [] }, '/prompt-index/state': { entries: [], draft: null },
  '/image-generation/models': { models }, '/image-generation/tasks': { tasks: [] },
  '/request-queue': { jobs: [], paused: false },
  '/image-library': { images: [], folders: [], tags: [], hidden_images: [] },
  '/image-manager': { folders: [], summary: { images: 0, bytes: 0, favorites: 0 }, functions: [], duplicates: [], receipts: [], plans: [] },
  '/image-manager/images': { images: [], total: 0, offset: 0, months: [], formats: [], tags: [] },
  '/image-workflows': { workflows: [], warnings: [] },
  '/image-workflows/capabilities': { providers: [], operations: [], limits: {}, assets: [], models },
  '/image-workflows/scene-planner/models': { models: [] },
  '/lora/projects': { projects: [project] }, '/lora/projects/preview-project': project,
  '/lora/hardware': { cuda_available: false, ready: false, error: 'UI preview; training is unavailable.' },
  '/lora/vision-models': { models: [] }, '/lora/adapters': { adapters: [] },
  '/faces/providers': { providers: [], ready: false, installed: false },
  '/faces/datasets': { datasets: [] }, '/faces/characters': { characters: [] },
  '/folder-review/status': { active: null, reviews: [] },
  '/hash-auditor/status': { active: null, scans: [], jobs: [], catalogs: [] },
  '/audio/status': { available: false, models: [], device: 'UI preview' },
  '/slicer/status': { available: false, ready: false, jobs: [], detail: 'UI preview; Cura is unavailable.' },
  '/integrations': { applications: [], groups: [] },
};
// Opt-in coexistence QA: real UI and native browser, simulated image inference.
// All stores and browser profiles are still disposable; no model is started.
const coexistence = new URLSearchParams(location.search).has('coexistence');
const generation = { backend_id: 'coexistence-fixture', snapshot_sequence: 1, tasks: [] };
if (coexistence) {
  responses['/image-generation/models'] = { models, loras: [], runtime: { ready: true, device: 'Fixture; no real inference' } };
  window.workspaceCoexistenceQA = {
    generation, stopped: [],
    advance(step) { generation.snapshot_sequence++; for (const task of generation.tasks) task.progress = {
      phase: 'Fixture denoising', step, total_steps: 4, elapsed_seconds: step, estimated_remaining_seconds: 4 - step,
    }; },
  };
}
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.origin === location.origin) return actualFetch(input, options);
  window.workspaceControlsQA.requests.push(url.pathname);
  if (url.origin !== 'http://127.0.0.1:1') return json({ detail: 'External requests are unavailable in this UI preview.' }, 503);
  if (coexistence) {
    if (url.pathname === '/sessions/new') return json({ id: 'coexistence-chat', title: 'Fixture chat', revision: 'fixture', messages: [] });
    if (url.pathname === '/sessions/coexistence-chat') return json({ id: 'coexistence-chat', title: 'Fixture chat', revision: 'fixture', messages: [] });
    if (url.pathname === '/image-generation/prompt-tokens') return json({
      prompt: { token_count: 3, chunks_required: 1, native_content_limit: 75 },
      negative_prompt: { token_count: 0, chunks_required: 1, native_content_limit: 75 },
      long_prompt_max_chunks: 4, long_prompt_max_tokens: 300,
    });
    if (url.pathname === '/image-generation/tasks') {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        generation.tasks.push(...body.requests.map(request => ({ ...request, status: 'running', progress: {
          phase: 'Fixture denoising', step: 1, total_steps: 4, elapsed_seconds: 1, estimated_remaining_seconds: 3,
        } })));
        generation.snapshot_sequence++;
      }
      return json(generation);
    }
    if (url.pathname.startsWith('/image-generation/stop/')) {
      window.workspaceCoexistenceQA.stopped.push(url.pathname); return json({ status: 'cancelled' });
    }
  }
  if (url.pathname in responses) return json(responses[url.pathname]);
  return json({ detail: 'This UI preview has no live service for this action.' }, 503);
};
