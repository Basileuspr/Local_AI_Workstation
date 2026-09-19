export const PHRASES_STORAGE_KEY = "local-ai-workstation-prompt-phrases-v1";

export function loadPromptPhrases() {
  const saved = JSON.parse(localStorage.getItem(PHRASES_STORAGE_KEY) || "[]");
  if (!Array.isArray(saved)) throw new Error("Invalid phrase buttons");
  const ids = new Set();
  return saved.filter((item) => {
    if (!item || typeof item.id !== "string" || ids.has(item.id)
      || typeof item.name !== "string" || !item.name.trim()
      || typeof item.text !== "string" || !item.text.trim()) return false;
    ids.add(item.id);
    return true;
  });
}

export function savePromptPhrases(phrases) {
  localStorage.setItem(PHRASES_STORAGE_KEY, JSON.stringify(phrases));
}

export async function copyPromptPhrase(text, target) {
  // Restore synchronously: Ctrl+V must work even before the clipboard promise
  // resolves. Do not steal focus later if the user moves to another field.
  const canFocus = target?.isConnected && !target.disabled;
  if (canFocus) target.focus({ preventScroll: true });
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  // Older renderer contexts may lack the Clipboard API.
  const previous = document.activeElement;
  const selection = previous?.selectionStart == null ? null : [
    previous.selectionStart, previous.selectionEnd, previous.selectionDirection,
  ];
  const input = document.createElement("textarea");
  input.value = text;
  input.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    input.remove();
    previous?.focus({ preventScroll: true });
    if (selection) previous.setSelectionRange(...selection);
  }
}
