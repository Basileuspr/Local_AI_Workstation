const DEFAULT_CONTEXT_WINDOW = 8192;
const MIN_CONTEXT_WINDOW = 1;
const DEFAULT_UNLIMITED_OUTPUT_RESERVE = 2048;
const CONTEXT_SAFETY_RESERVE = 512;
const DURABLE_MEMORY_RESERVE = 1200;
const KNOWLEDGE_BASE_RESERVE = 2000;
const COMPACTION_TRIGGER_RATIO = 0.60;
const HARD_COMPACTION_RATIO = 0.86;
const TARGET_CONTEXT_RATIO = 0.56;
const SUMMARY_TARGET_TOKENS = 700;

import { latestDocumentContextMessages } from './chatDocuments';

function textTokenEstimate(value) {
  const text = String(value || "");
  if (!text) return 0;

  // A deliberately conservative local estimate. It slightly overestimates
  // prose and is safer than assuming a single tokenizer for every model.
  const punctuation = (text.match(/[{}[\]();:=<>`]/g) || []).length;
  return Math.max(Math.ceil([...text].length / 3), Math.ceil(new TextEncoder().encode(text).length / 2.5)) + Math.ceil(punctuation / 4);
}

function messageTokenEstimate(message) {
  const imageReserve = Array.isArray(message.images) ? message.images.length * 2048 : 0;
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
  if (Number.isFinite(parsed) && parsed > 0) return Math.min(Math.floor(parsed), Math.max(128, Math.floor(contextWindow / 2)));
  return Math.min(DEFAULT_UNLIMITED_OUTPUT_RESERVE, Math.max(128, Math.floor(contextWindow / 2)));
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

export function recentTurnStart(messages) {
  let start = messages.findLastIndex(message => message.role === 'user');
  if (start < 0) return Math.max(0, messages.length - 1);
  while (start > 0 && messages[start - 1].role === 'user') start -= 1;
  return start;
}

function contextHistory(messages) {
  const history = latestDocumentContextMessages(messages);
  const lastImage = history.findLastIndex(message => message.images?.length);
  let start = lastImage;
  while (start > 0 && history[start - 1].role === 'user') start -= 1;
  return history.map((message, index) => index < start && message.images?.length
    ? { ...message, images: undefined, content: `${message.content}\n[Earlier image pixels omitted; refer to saved observations or attach again for closer inspection.]` }
    : message);
}

function selectRecentMessages(messages, startIndex, tokenBudget, force = false) {
  const selected = [];
  let tokens = 0;

  for (let index = messages.length - 1; index >= startIndex; index -= 1) {
    const message = messages[index];
    const messageTokens = messageTokenEstimate(message);
    const mustKeep = index >= recentTurnStart(messages);
    if (!mustKeep && (force || tokens + messageTokens > tokenBudget)) break;
    selected.unshift(message);
    tokens += messageTokens;
  }

  // Keep whole user/assistant turns instead of an orphaned assistant response.
  while (selected.length > 1 && selected[0].role !== 'user' && selected[0].role !== 'system') selected.shift();
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
  useDurableMemory = true,
  model = "",
}) {
  const windowTokens = normalizeContextWindow(contextWindow);
  const outputReserve = normalizeOutputReserve(responseLength, windowTokens);
  const fixedReserve =
    outputReserve +
    CONTEXT_SAFETY_RESERVE +
    (useDurableMemory ? DURABLE_MEMORY_RESERVE : 0) +
    (useKnowledgeBase ? KNOWLEDGE_BASE_RESERVE : 0);
  const usableInputTokens = Math.max(0, windowTokens - fixedReserve);
  const summaryMessage = memorySummary?.trim() ? buildContextMessages([], memorySummary, 0)[0] : null;
  const summaryTokens = summaryMessage ? messageTokenEstimate(summaryMessage) : 0;
  const systemTokens = textTokenEstimate(systemPrompt);
  const unsummarizedMessages = contextHistory(messages).slice(summarizedMessageCount || 0);
  const unsummarizedTokens = unsummarizedMessages.reduce(
    (total, message) => total + messageTokenEstimate(message),
    0
  );
  const promptTokens = summaryTokens + systemTokens + unsummarizedTokens;

  return {
    model,
    countKind: "estimate",
    estimationMethod: "Character, message and image heuristic; tokenizer varies by model",
    configuredContextLimit: windowTokens,
    contextLimitSource: contextWindow ? "model_catalog" : "fallback_model_limit_unknown",
    remainingTokens: Math.max(0, windowTokens - promptTokens),
    inputBudgetRemaining: Math.max(0, usableInputTokens - promptTokens),
    summarizationOccurred: Boolean(memorySummary?.trim()) || (summarizedMessageCount || 0) > 0,
    summarizedMessageCount: summarizedMessageCount || 0,
    applicationTrimming: false,
    providerTrimming: "unknown",
    windowTokens,
    outputReserve,
    fixedReserve,
    usableInputTokens,
    promptTokens,
    summaryTokens,
    systemTokens,
    unsummarizedTokens,
    ratio: promptTokens / Math.max(1, usableInputTokens),
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
  useDurableMemory = true,
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
    useDurableMemory,
  });

  const hasUnsummarizedHistory = recentTurnStart(messages) > nextSummarizedCount;
  if ((force || usage.ratio >= triggerRatio) && hasUnsummarizedHistory) {
    const targetInputTokens = Math.floor(usage.usableInputTokens * TARGET_CONTEXT_RATIO);
    const rawTokenBudget = Math.max(
      256,
      targetInputTokens - usage.summaryTokens - usage.systemTokens
    );
    const history = contextHistory(messages);
    const retained = selectRecentMessages(history, nextSummarizedCount, rawTokenBudget, force);
    const compactUntil = messages.length - retained.messages.length;
    const messagesToCompact = history
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
      // An empty summary cannot cover new turns; retain them for the next request.
      if (result.summary?.trim()) {
        nextSummary = result.summary;
        nextSummarizedCount = compactUntil;
      }
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
      useDurableMemory,
    }),
  };
}

export function buildContextMessages(messages, memorySummary, summarizedMessageCount) {
  const recent = contextHistory(messages)
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
