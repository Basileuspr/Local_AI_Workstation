import { createMessageId } from './messageIds';
import { emptyGenerationHistory, generationHistoryReducer } from './generationHistory';

export const imageTaskFinished = task => ['completed', 'failed', 'cancelled'].includes(task.status);

export function newerImageTaskSnapshot(current, incoming) {
  if (current?.backend_id && incoming.backend_id === current.backend_id
    && incoming.snapshot_sequence <= current.snapshot_sequence) return current;
  return incoming;
}

export function canReloadGeneratedSession(before, current) {
  return before.currentSessionId === current.currentSessionId && !current.isGenerating
    && before.sessionRevision === current.sessionRevision
    && before.conversationHistory === current.conversationHistory;
}

export function imageGenerationClientId() {
  const key = 'local-ai-workstation-image-client';
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return saved;
    const id = createMessageId();
    sessionStorage.setItem(key, id);
    return id;
  } catch { return createMessageId(); }
}

export function restoreImageTaskHistory(tasks) {
  let history = emptyGenerationHistory;
  const latest = tasks.at(-1);
  if (latest?.batch_id) history = generationHistoryReducer(history, {type:'start-batch', id:latest.batch_id,
    requestIds:tasks.filter(task => task.batch_id === latest.batch_id).sort((a,b) => a.batch_index-b.batch_index).map(task => task.request_id)});
  for (const task of tasks) {
    if (task.status === 'completed' && task.result) history = generationHistoryReducer(history, {type:'complete',image:task.result});
    else if (imageTaskFinished(task)) history = generationHistoryReducer(history, {type:'batch-failed',batchId:task.batch_id,
      requestId:task.request_id,cancelled:task.status === 'cancelled',error:task.error});
  }
  return history;
}

export function activeImageTasks(tasks) {
  return tasks.filter(task => !imageTaskFinished(task)).map(task => ({id:task.request_id,prompt:task.prompt,
    label:task.label,status:task.status,progress:task.progress,batchLabel:task.batch_id ? `Image ${task.batch_index + 1} of ${task.batch_count}` : undefined}));
}
