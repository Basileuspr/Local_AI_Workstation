export function orderModels(models, order = []) {
  const ranks = new Map((Array.isArray(order) ? order : []).map((name, index) => [name, index]));
  return [...models].sort((a, b) => (ranks.get(a.name) ?? Infinity) - (ranks.get(b.name) ?? Infinity));
}

export function moveModel(models, name, offset) {
  const names = models.map(model => model.name), index = names.indexOf(name);
  const destination = Math.max(0, Math.min(names.length - 1, index + offset));
  if (index < 0) return names;
  names.splice(index, 1); names.splice(destination, 0, name);
  return names;
}
