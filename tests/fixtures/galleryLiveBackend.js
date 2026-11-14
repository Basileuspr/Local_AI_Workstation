import './workspaceControlsBackend';
import {invalidatePolling} from '../../src/polling';

const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const sessionImage = number => ({id: `fixture:message:image-${number}`, session_id: 'fixture', message_id: 'message', image_id: `image-${number}`,
  name: `Generated image ${number}`, session_title: 'Gallery fixture', url: `/sessions/fixture/images/by-id/message/image-${number}`});
const qa = window.galleryQA = {sessionImages: [sessionImage(1)], owned: [], sessionReads: 0, libraryReads: 0, failSessions: false,
  media: [{id: 'qwen-job', kind: 'image', status: 'running', request: {seed: 42}}],
  completeSession() {
    const image = sessionImage(this.sessionImages.length + 1); this.sessionImages.push(image);
    const generation = window.workspaceCoexistenceQA.generation;
    generation.tasks.push({request_id: image.image_id, session_id: 'fixture', status: 'completed', result: {...image, request_id: image.image_id, filename: image.name, seed: 42}});
    generation.snapshot_sequence++; invalidatePolling('image-tasks');
  },
  completeQwen() {
    this.owned.push({id: 'qwen-library', name: 'Qwen completed image', url: '/image-library/images/qwen-library/content',
      folder_ids: [], origin: {kind: 'media-generation', job_id: 'qwen-job'}, seed: 42, width: 64, height: 64});
    this.media[0] = {...this.media[0], status: 'completed', url: '/media-generation/jobs/qwen-job/output'};
    invalidatePolling('media-jobs');
  },
};
const previous = window.fetch;
window.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.pathname === '/sessions/images') {qa.sessionReads++; return json(qa.failSessions ? {detail: 'Offline fixture'} : {images: qa.sessionImages, hidden_images: []}, qa.failSessions ? 503 : 200);}
  if (url.pathname === '/image-library') {qa.libraryReads++; return json({images: qa.owned, folders: [{id: 'fixture-folder', name: 'My collection'}], tags: [], warnings: []});}
  if (url.pathname === '/image-library/vault/status') return json({configured: false, locked_hashes: []});
  if (url.pathname === '/media-generation/jobs') return json({jobs: qa.media});
  if (url.pathname === '/mobile/image-tasks') return json({backend_id: 'gallery-mobile-fixture', snapshot_sequence: 1, tasks: []});
  if (url.pathname === '/image-workflows/images') return json({runs: [], warnings: []});
  return previous(input, options);
};
