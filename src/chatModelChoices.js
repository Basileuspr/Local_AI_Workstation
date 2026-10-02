const key = "local-ai-workstation-chat-models-v1";
export function chatModelChoice(sessionId, savedModel, fallback, models = []) {
  let choices;
  try { choices = JSON.parse(localStorage.getItem(key)) || {}; } catch { choices = {}; }
  const preferred = choices[sessionId] || savedModel;
  return models.some(item => item.name === preferred) ? preferred : fallback;
}
export function saveChatModelChoice(sessionId, model) {
  if (!sessionId || !model) return;
  try {
    let choices;
    try { choices = JSON.parse(localStorage.getItem(key)) || {}; } catch { choices = {}; }
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries({ ...choices, [sessionId]: model }).slice(-2000))));
  } catch { /* The selection still works if storage is unavailable. */ }
}
