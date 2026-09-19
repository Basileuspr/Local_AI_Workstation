export const responseStyles = {
  structured: {
    label: "Structured",
    prompt:
      "Default response style: use polished Markdown structure like modern frontier assistants. Prefer short openings, clear headings, concise bullets, numbered steps for procedures, tables for comparisons or budgets, and separators only when they improve scanability. Use bold labels for key items. Keep simple answers brief; do not force a table or long outline when a sentence or two is enough.",
  },
  concise: {
    label: "Concise",
    prompt:
      "Default response style: answer directly and briefly. Use Markdown only when it improves clarity. Avoid long recaps unless the user asks.",
  },
  detailed: {
    label: "Detailed",
    prompt:
      "Default response style: provide thorough, well-organized answers with Markdown headings, bullets, examples, tables when useful, and concrete next steps.",
  },
  plain: {
    label: "Plain",
    prompt:
      "Default response style: use natural plain prose. Avoid heavy formatting unless the user asks for structure.",
  },
};

export function buildResponseStylePrompt(styleKey) {
  const style = responseStyles[styleKey] || responseStyles.structured;
  return [
    "Write for easy reading. Use paragraphs, headings, lists, emphasis, quotations, and fenced code blocks only when they genuinely clarify the answer. Keep formatting semantic and do not force a template onto short replies.",
    style.prompt,
  ].join(" ");
}

export function mergeSystemPrompt({ basePrompt, roleplayPrompt, responseStyle }) {
  return [buildResponseStylePrompt(responseStyle), basePrompt, roleplayPrompt]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}
