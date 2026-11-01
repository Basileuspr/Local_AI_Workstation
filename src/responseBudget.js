export const MAX_RESPONSE_TOKENS = 32768;
export const DEFAULT_RESPONSE_TOKENS = 1024;
export const responseLengthPresets = [[256, 'Short'], [512, 'Brief'], [1024, 'Medium'], [2048, 'Long'], [4096, 'Very long'], [8192, 'Extended']];

export function validResponseLength(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  const number = Number(value);
  return String(value).trim() !== '' && Number.isInteger(number) && (number === -1 || (number >= 1 && number <= MAX_RESPONSE_TOKENS));
}

export function normalizeResponseLength(value, fallback = DEFAULT_RESPONSE_TOKENS) {
  return validResponseLength(value) ? Number(value) : fallback;
}

export function effectiveOutputBudget(value, contextWindow) {
  const context = Number.isFinite(Number(contextWindow)) && Number(contextWindow) >= 1 ? Math.floor(Number(contextWindow)) : 8192;
  return Math.min(value > 0 ? value : 2048, Math.max(128, Math.floor(context / 2)));
}

// Same allocation as backend context_awareness.request_budget. Retrieval and
// tools are counted when the backend assembles the real request, not reserved twice.
export function requestBudget(contextWindow, responseLength) {
  const outputReserve = effectiveOutputBudget(responseLength, contextWindow);
  const safetyReserve = Math.min(512, Math.floor(contextWindow / 4));
  return { outputReserve, safetyReserve, fixedReserve: outputReserve + safetyReserve,
    usableInputTokens: Math.max(0, contextWindow - outputReserve - safetyReserve) };
}
