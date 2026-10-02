import { sortNamedItems } from './alphabetical.js';
import { validateWorkflow } from './functionContract.mjs';
export * from './functionContract.mjs';
export const WORKFLOWS_KEY = 'local-ai-workstation-functions-v2';
export function loadWorkflows(storage = localStorage) {
  const values = JSON.parse(storage.getItem(WORKFLOWS_KEY) || '[]');
  if (!Array.isArray(values) || new Set(values.map(value => value?.id)).size !== values.length) throw Error('Saved functions could not be read.');
  return sortNamedItems(values.map(validateWorkflow));
}
export function saveWorkflows(values, storage = localStorage) {
  const sorted = sortNamedItems(values.map(validateWorkflow));
  if (new Set(sorted.map(value => value.id)).size !== sorted.length) throw Error('Duplicate function ID.');
  storage.setItem(WORKFLOWS_KEY, JSON.stringify(sorted));
  return sorted;
}
