const KNOWN_MODELS = [
  {
    name: "qwen3-vl:8b",
    label: "Qwen3 VL 8B",
    capability: "vision",
  },
  {
    name: "qwen3.5:9b",
    label: "Qwen3.5 9B",
  },
];

const PREFERRED_MODEL_ORDER = [
  "qwen3.5:9b",
  "qwen3-vl:8b",
  "heretic-20b:latest",
  "mistral:latest",
];

export function mergeKnownModels(models) {
  const modelMap = new Map(
    models.map((model) => [
      model.name,
      {
        ...model,
        contextLength: model.context_length || model.contextLength || 8192,
        capability: model.capabilities?.includes("vision") ? "vision" : "text",
      },
    ])
  );

  for (const known of KNOWN_MODELS) {
    const existing = modelMap.get(known.name);
    if (!existing) continue;
    modelMap.set(known.name, {
      ...known,
      ...existing,
      contextLength: existing.contextLength || 8192,
      knownLabel: known.label,
      capability: existing.capability || known.capability,
    });
  }

  return Array.from(modelMap.values()).sort((a, b) => {
    const aIndex = PREFERRED_MODEL_ORDER.indexOf(a.name);
    const bIndex = PREFERRED_MODEL_ORDER.indexOf(b.name);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }
    return a.name.localeCompare(b.name);
  });
}

export function pickDefaultModel(models, { preferSmall = false } = {}) {
  if (preferSmall) {
    const sized = models.filter(model => Number.isFinite(model.size) && model.size > 0);
    if (sized.length) return [...sized].sort((a, b) => a.size - b.size || a.name.localeCompare(b.name))[0].name;
  }
  for (const name of PREFERRED_MODEL_ORDER) {
    const match = models.find((model) => model.name === name);
    if (match) return match.name;
  }
  return models[0]?.name || "";
}

export function reconcileChatModel(models, selected, options) {
  return models.some(model => model.name === selected) ? selected : pickDefaultModel(models, options);
}

export function modelInventoryKey(status) {
  if (!status?.ollama?.reachable) return "offline";
  return JSON.stringify((status.models?.installed || []).map(model => [model.name, model.digest, model.size])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

export function formatModelLabel(model) {
  const name = model.knownLabel || model.name;
  const tags = [];

  if (model.capability === "vision") tags.push("Vision");
  if (model.capability === "text") tags.push("Text");
  if (model.size) tags.push((model.size / 1e9).toFixed(1) + "GB");

  return tags.length ? `${name} (${tags.join(", ")})` : name;
}
