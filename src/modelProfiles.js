import { effectiveOutputBudget, validResponseLength } from './responseBudget';

export const modelProfileFields = ['contextWindow', 'thinking', 'responseLength', 'temperature', 'topP', 'topK', 'repeatPenalty'];
export const modelProfileKey = model => model?.name ? JSON.stringify([model.name, model.digest || '']) : '';
const number = (value, fallback, low, high) => typeof value === 'number' && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

export function modelDefaults(model = {}) {
  const supplied = model.chat_profile || {};
  const context = supplied.contextWindow || model.contextLength || model.context_length || 8192;
  const choices = supplied.thinkingChoices || model.thinking?.values || (model.capabilities?.includes('thinking') ? [false, true] : []);
  const thinking = supplied.thinking ?? (choices.includes(false) ? false : model.thinking?.default ?? choices[0] ?? null);
  return { contextWindow: context, maxContext: Math.min(262144, supplied.maxContext || model.trained_context_length || context),
    thinkingChoices: choices, thinking, responseLength: supplied.responseLength || (thinking ? 2048 : 1024),
    temperature: supplied.temperature ?? .7, topP: supplied.topP ?? .9, topK: supplied.topK ?? 40, repeatPenalty: supplied.repeatPenalty ?? 1.1 };
}

export function normalizeModelProfile(model, saved = {}) {
  const defaults = modelDefaults(model);
  const contextWindow = Math.floor(number(saved?.contextWindow, defaults.contextWindow, Math.min(512, defaults.maxContext), defaults.maxContext));
  const thinking = defaults.thinkingChoices.some(v => v === saved?.thinking) ? saved.thinking : defaults.thinking;
  const requested = validResponseLength(saved?.responseLength) ? Number(saved.responseLength) : defaults.responseLength;
  return { contextWindow, thinking, responseLength: requested === -1 ? -1 : effectiveOutputBudget(requested, contextWindow),
    temperature: number(saved?.temperature, defaults.temperature, 0, 2), topP: number(saved?.topP, defaults.topP, 0, 1),
    topK: Math.floor(number(saved?.topK, defaults.topK, 0, 1000)), repeatPenalty: number(saved?.repeatPenalty, defaults.repeatPenalty, 0, 2) };
}

export function profileForModel(state, name = state.selectedModel) {
  const model = (state.models || []).find(item => item.name === name);
  return normalizeModelProfile(model, state.modelProfiles?.[modelProfileKey(model)]);
}

export function rememberModelProfile(state, changes = {}) {
  const model = (state.models || []).find(item => item.name === state.selectedModel);
  if (!model) return state;
  const key = modelProfileKey(model);
  const profile = normalizeModelProfile(model, { ...Object.fromEntries(modelProfileFields.map(field => [field, state[field]])), ...changes });
  // Exact installed versions own their settings; a changed digest gets defaults.
  const entries = Object.entries(state.modelProfiles || {}).filter(([id]) => id !== key);
  return { ...state, ...profile, numPredict: profile.responseLength, activeModelProfileKey: key,
    modelProfiles: Object.fromEntries([...entries, [key, profile]].slice(-100)) };
}

export function activateModelProfile(state, name = state.selectedModel) {
  const model = (state.models || []).find(item => item.name === name);
  if (!model) return { ...state, selectedModel: name, activeModelProfileKey: '' };
  const profile = profileForModel(state, name);
  return rememberModelProfile({ ...state, ...profile, selectedModel: name, activeProfile: '', activeCustomProfileId: '' });
}

export function thinkingLabel(value) {
  return value === false ? 'Off' : value === true ? 'On' : typeof value === 'string' ? value[0].toUpperCase() + value.slice(1) : 'Provider default';
}
