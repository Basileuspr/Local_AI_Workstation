export function imagePromptIndexEntry(settings, title) {
  const prompt = settings.prompt || "";
  const negativePrompt = settings.negativePrompt || "";
  if (!prompt.trim() && !negativePrompt.trim()) throw new Error("Enter a positive or negative prompt first.");
  if (!title.trim()) throw new Error("Enter a name for this prompt pair.");
  return {
    title: title.trim().slice(0, 120),
    content: `Positive prompt:\n${prompt}\n\nNegative prompt:\n${negativePrompt}`,
    source: "Generate",
    tags: ["image-generation", "prompts"],
  };
}

export function imagePromptIndexTitle(settings) {
  const summary = (settings.prompt || settings.negativePrompt || "").trim().replace(/\s+/g, " ");
  return `Image prompts · ${summary.slice(0, 80)}`;
}
