export const matchSymbols = ['☀', '☾', '★', '◆', '♣', '♥', '♫', '⚓'];
export function shuffledCards(random = Math.random) {
  const values = matchSymbols.flatMap((symbol, pair) => [{ id: pair * 2, pair, symbol }, { id: pair * 2 + 1, pair, symbol }]);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
export function readMatchBest(storage = globalThis.localStorage) {
  try { const value = Number(storage?.getItem('local-ai-workstation-match-best-v1')); return Number.isInteger(value) && value >= 8 ? value : null; }
  catch { return null; }
}
