const DEFAULT_CONTEXT_WINDOW = 8192;
const MIN_CONTEXT_WINDOW = 2048;
const DEFAULT_UNLIMITED_OUTPUT_RESERVE = 4096;
const CONTEXT_SAFETY_RESERVE = 512;
const DURABLE_MEMORY_RESERVE = 1200;
const KNOWLEDGE_BASE_RESERVE = 2000;
const COMPACTION_TRIGGER_RATIO = 0.72;
const HARD_COMPACTION_RATIO = 0.86;
const TARGET_CONTEXT_RATIO = 0.56;
const MIN_RECENT_MESSAGE_COUNT = 4;
const SUMMARY_TARGET_TOKENS = 700;

function textTokenEstimate(value) {
  const text = String(value || "");
  if (!text) return 0;

  // A deliberately conservative local estimate. It slightly overestimates
  // prose and is safer than assuming a single tokenizer for every model.
  const whitespace = (text.match(/\s/g) || []).length;
  const punctuation = (text.match(/[{}[\]();:=<>`]/g) || []).length;
  return Math.ceil(text.length / 3.6) + Math.ceil(whitespace / 18) + Math.ceil(punctuation / 10);
}

function messageTokenEstimate(message) {
  const imageReserve = Array.isArray(message.images) ? message.images.length * 700 : 0;
  return 6 + textTokenEstimate(message.content) + textTokenEstimate(message.document_text) + imageReserve;
}

function normalizeContextWindow(contextWindow) {
  const parsed = Number(contextWindow);
  return Number.isFinite(parsed) && parsed >= MIN_CONTEXT_WINDOW
    ? Math.floor(parsed)
    : DEFAULT_CONTEXT_WINDOW;
}

function normalizeOutputReserve(responseLength, contextWindow) {
  const parsed = Number(responseLength);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return Math.min(DEFAULT_UNLIMITED_OUTPUT_RESERVE, Math.floor(contextWindow * 0.45));
}

function stripRuntimeOnlyFields(message) {
  const clean = {
    role: message.role,
    content: message.document_text ? `${message.content}\n[Document content]\n${message.document_text}` : message.content,
  };

  if (message.images?.length) clean.images = message.images;
  return clean;
}

function stripHeavyFieldsForSummary(message) {
  return {
    role: message.role,
    content: message.document_text ? `${message.content}\n[Document content]\n${message.document_text}` : message.content,
    images: message.images?.length ? ["[image omitted]"] : undefined,
  };
}

function selectRecentMessages(messages, startIndex, tokenBudget) {
  const selected = [];
  let tokens = 0;

  for (let index = messages.length - 1; index >= startIndex; index -= 1) {
    const message = messages[index];
    const messageTokens = messageTokenEstimate(message);
    const mustKeep = selected.length < MIN_RECENT_MESSAGE_COUNT;
    if (!mustKeep && tokens + messageTokens > tokenBudget) break;
    selected.unshift(message);
    tokens += messageTokens;
  }

  return { messages: selected, tokens };
}

export function getContextUsage({
  messages,
  memorySummary,
  summarizedMessageCount,
  contextWindow,
  responseLength,
  systemPrompt,
  useKnowledgeBase,
}) {
  const windowTokens = normalizeContextWindow(contextWindow);
  const outputReserve = normalizeOutputReserve(responseLength, windowTokens);
  const fixedReserve =
    outputReserve +
    CONTEXT_SAFETY_RESERVE +
    DURABLE_MEMORY_RESERVE +
    (useKnowledgeBase ? KNOWLEDGE_BASE_RESERVE : 0);
  const usableInputTokens = Math.max(512, windowTokens - fixedReserve);
  const summaryTokens = textTokenEstimate(memorySummary);
  const systemTokens = textTokenEstimate(systemPrompt);
  const unsummarizedMessages = messages.slice(summarizedMessageCount || 0);
  const unsummarizedTokens = unsummarizedMessages.reduce(
    (total, message) => total + messageTokenEstimate(message),
    0
  );
  const promptTokens = summaryTokens + systemTokens + unsummarizedTokens;

  return {
    windowTokens,
    outputReserve,
    fixedReserve,
    usableInputTokens,
    promptTokens,
    summaryTokens,
    systemTokens,
    unsummarizedTokens,
    ratio: promptTokens / usableInputTokens,
  };
}

export function formatTokenEstimate(tokens) {
  if (tokens < 1000) return `${Math.max(0, Math.round(tokens))}`;
  return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`;
}

export function getContextStatus(usage) {
  if (usage.ratio >= 0.9) return { className: "critical", label: "near limit" };
  if (usage.ratio >= COMPACTION_TRIGGER_RATIO) return { className: "warning", label: "compact soon" };
  return { className: "healthy", label: "within budget" };
}

export async function rotateContextMemory({
  api,
  model,
  messages,
  memorySummary,
  summarizedMessageCount,
  contextWindow,
  responseLength,
  systemPrompt,
  useKnowledgeBase,
  triggerRatio = COMPACTION_TRIGGER_RATIO,
  force = false,
  requestId,
  sessionId,
  signal,
}) {
  let nextSummary = memorySummary || "";
  let nextSummarizedCount = summarizedMessageCount || 0;
  const usage = getContextUsage({
    messages,
    memorySummary: nextSummary,
    summarizedMessageCount: nextSummarizedCount,
    contextWindow,
    responseLength,
    systemPrompt,
    useKnowledgeBase,
  });

  const hasUnsummarizedHistory = messages.length - nextSummarizedCount > MIN_RECENT_MESSAGE_COUNT;
  if ((force || usage.ratio >= triggerRatio) && hasUnsummarizedHistory) {
    const targetInputTokens = Math.floor(usage.usableInputTokens * TARGET_CONTEXT_RATIO);
    const rawTokenBudget = Math.max(
      256,
      targetInputTokens - usage.summaryTokens - usage.systemTokens
    );
    const retained = selectRecentMessages(messages, nextSummarizedCount, rawTokenBudget);
    const compactUntil = messages.length - retained.messages.length;
    const messagesToCompact = messages
      .slice(nextSummarizedCount, compactUntil)
      .map(stripHeavyFieldsForSummary);

    if (messagesToCompact.length > 0) {
      const result = await api.compactMemory({
        model,
        previousSummary: nextSummary,
        messages: messagesToCompact,
        targetTokens: SUMMARY_TARGET_TOKENS,
        requestId,
        sessionId,
        signal,
      });
      nextSummary = result.summary || nextSummary;
      nextSummarizedCount = compactUntil;
    }
  }

  return {
    memorySummary: nextSummary,
    summarizedMessageCount: nextSummarizedCount,
    contextMessages: buildContextMessages(messages, nextSummary, nextSummarizedCount),
    usage: getContextUsage({
      messages,
      memorySummary: nextSummary,
      summarizedMessageCount: nextSummarizedCount,
      contextWindow,
      responseLength,
      systemPrompt,
      useKnowledgeBase,
    }),
  };
}

export function buildContextMessages(messages, memorySummary, summarizedMessageCount) {
  const recent = messages
    .slice(summarizedMessageCount || 0)
    .map(stripRuntimeOnlyFields);

  if (!memorySummary?.trim()) return recent;

  return [
    {
      role: "system",
      content:
        "Rolling session context from earlier in this chat. Treat it as a factual continuity record. Prefer recent messages when details conflict, preserve stated constraints, and do not mention this hidden context unless the user asks.\n\n" +
        memorySummary.trim(),
    },
    ...recent,
  ];
}

export const contextDefaults = {
  hardTriggerRatio: HARD_COMPACTION_RATIO,
  normalTriggerRatio: COMPACTION_TRIGGER_RATIO,
  summaryTargetTokens: SUMMARY_TARGET_TOKENS,
};
