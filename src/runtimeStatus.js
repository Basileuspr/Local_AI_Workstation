import {chatStageLabel} from './chatActivity';

export function runtimeIndicator(runtime, queue = {}) {
  const jobs = (queue.jobs || []).filter(job => ['running', 'cancelling'].includes(job.status));
  const active = jobs.find(job => job.requires_gpu !== false) || jobs[0];
  const busy = Boolean(active || runtime?.gpu_owner || runtime?.active_chat_requests || runtime?.image?.generating);
  if (runtime?.unavailable && (queue.error || !active))
    return {label: 'Runtime status unavailable · last report retained', busy: false, unavailable: true};
  if (active && !queue.error) {
    const phase = active.status === 'cancelling' ? 'Stopping safely'
      : ['chat', 'compact'].includes(active.kind) ? chatStageLabel(active.stage) : active.stage || 'Running';
    return {label: `${phase} · ${active.label || active.model || 'Local task'}`, busy,
      detail: active.stage_detail || 'Live local workload from Prompt Queue'};
  }
  const chat = runtime?.chat_activity?.find(job => ['running', 'cancelling'].includes(job.status));
  if (chat) return {label: `${chat.status === 'cancelling' ? 'Stopping Request' : chatStageLabel(chat.stage)}${chat.model ? ` · ${chat.model}` : ''}`, busy: true, detail: chat.stage_detail};
  const owner = runtime?.gpu_owner || '';
  if (owner || busy) {
    const name = owner.startsWith('media-generation:') ? 'image/video generation'
      : owner.startsWith('workflow:') ? 'image workflow'
        : owner.startsWith('image') || runtime?.image?.generating ? 'image generation'
          : owner.startsWith('lora') ? 'LoRA' : owner === 'pdf-ocr' ? 'PDF OCR'
            : runtime?.active_chat_requests ? 'chat' : 'local GPU task';
    return {label: `Running: ${name}`, busy: true};
  }
  if (!runtime) return {label: 'Checking GPU/model runtimes…', busy: false};
  if (queue.error) return {label: 'Queue status unavailable · checking runtime', busy: false, unavailable: true};
  const waiting = (queue.jobs || []).filter(job => job.status === 'queued').length;
  if (waiting) return {label: `${queue.paused ? 'Queue paused' : 'Waiting for GPU'} · ${waiting} queued`, busy: false};
  const loaded = new Set([...(runtime.ollama_loaded_models || []), ...(runtime.image?.loaded_model ? [`image:${runtime.image.loaded_model}`] : [])]).size;
  return {label: loaded ? `Idle; ${loaded} model runtime${loaded === 1 ? '' : 's'} loaded` : 'GPU/model runtimes idle', busy: false};
}
