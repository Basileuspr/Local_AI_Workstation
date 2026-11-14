import './workspaceControlsBackend';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from '../../src/useStore';
import FaceStudio from '../../src/components/FaceStudio';
import LoraStudio from '../../src/components/LoraStudio';

const qa = window.taskPollingQA = { finish: false, active: { faces: 0, lora: 0 }, maximum: { faces: 0, lora: 0 }, reads: { faces: 0, lora: 0 } };
Object.defineProperty(document, 'hidden', { value: false });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const fallback = window.fetch;
const run = () => ({ id: 'scan', name: 'Scan', status: qa.finish ? 'complete' : 'running', total: 1, processed: qa.finish ? 1 : 0 });
const dataset = () => ({ id: 'dataset', name: qa.finish ? 'Finished faces' : 'Running faces', faces: [], face_count: 0, run: run(),
  settings: { crop_mode: 'square', padding: 0.2, size: 512, detect_threshold: 0.5, similar_threshold: 0.45 } });
const project = () => ({ id: 'project', name: qa.finish ? 'Finished training' : 'Running training', images: [], settings: {}, base_model_id: 'preview-image',
  training: { status: qa.finish ? 'complete' : 'running', logs: [] }, ...(qa.finish ? { adapter: { filename: 'completed.safetensors' } } : {}) });
window.fetch = async (input, options = {}) => {
  const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
  const task = path === '/faces/datasets/dataset/run' ? 'faces' : path === '/lora/projects/project/training' ? 'lora' : null;
  if (task) {
    qa.active[task]++; qa.reads[task]++; qa.maximum[task] = Math.max(qa.maximum[task], qa.active[task]);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 2200);
        options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      return json(task === 'faces' ? { run: run() } : project().training);
    } finally { qa.active[task]--; }
  }
  if (path === '/faces/datasets') return json({ datasets: [dataset()] });
  if (path === '/faces/datasets/dataset') return json(dataset());
  if (path === '/faces/datasets/dataset/runs') return json({ runs: qa.finish ? [run()] : [] });
  if (path === '/lora/projects') return json({ projects: [project()] });
  if (path === '/lora/projects/project') return json(project());
  return fallback(input, options);
};
createRoot(document.getElementById('root')).render(<StoreProvider><FaceStudio active /><LoraStudio active /></StoreProvider>);
