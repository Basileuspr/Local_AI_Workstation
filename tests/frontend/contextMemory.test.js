/**
 * Tests for the rolling-context budget math.
 *
 * This module decides when a conversation gets summarized and what actually
 * reaches the model. Getting it wrong either wastes context or silently drops
 * the user's history, so the reserve arithmetic is pinned down here.
 */

import { describe, expect, it, vi } from "vitest";
import {
  buildContextMessages,
  contextDefaults,
  formatTokenEstimate,
  getContextStatus,
  getContextUsage,
  rotateContextMemory,
  recentTurnStart,
} from "../../src/contextMemory.js";

const CONTEXT_SAFETY_RESERVE = 512;
const DURABLE_MEMORY_RESERVE = 1200;
const KNOWLEDGE_BASE_RESERVE = 2000;

function usageFor(overrides = {}) {
  return getContextUsage({
    messages: [],
    memorySummary: "",
    summarizedMessageCount: 0,
    contextWindow: 8192,
    responseLength: 1024,
    systemPrompt: "",
    useKnowledgeBase: false,
    ...overrides,
  });
}

function messages(count, content = "hello there") {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `${content} ${i}`,
  }));
}

/**
 * Messages heavy enough to overflow the retention budget.
 *
 * Compaction only folds in history that does NOT fit alongside the recent
 * tail, so short messages are never compacted no matter what is forced.
 */
function longMessages(count) {
  const body = "This is a substantial message body used to consume budget. ".repeat(34);
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `${body} ${i}`,
  }));
}

describe("getContextUsage — window normalization", () => {
  it("uses the model's advertised window when it is sane", () => {
    expect(usageFor({ contextWindow: 32768 }).windowTokens).toBe(32768);
  });

  it("falls back to 8192 when the window is missing", () => {
    expect(usageFor({ contextWindow: undefined }).windowTokens).toBe(8192);
  });

  it("respects small configured windows rather than inflating their budget", () => {
    expect(usageFor({ contextWindow: 1000 }).windowTokens).toBe(1000);
  });

  it("falls back to 8192 when the window is not a number", () => {
    expect(usageFor({ contextWindow: "wide" }).windowTokens).toBe(8192);
  });

  it("floors fractional windows", () => {
    expect(usageFor({ contextWindow: 8192.9 }).windowTokens).toBe(8192);
  });
});

describe("getContextUsage — output reserve", () => {
  it("reserves exactly the requested response length", () => {
    expect(usageFor({ responseLength: 2048 }).outputReserve).toBe(2048);
  });

  it("reserves a proportional slice when the response length is unlimited", () => {
    // Unlimited is still bounded so the request leaves room for input.
    expect(usageFor({ responseLength: -1, contextWindow: 8192 }).outputReserve).toBe(2048);
  });

  it("caps the unlimited reserve at 2048 on very large windows", () => {
    expect(usageFor({ responseLength: -1, contextWindow: 128000 }).outputReserve).toBe(2048);
  });
});

describe("getContextUsage — usable budget", () => {
  it("subtracts output, safety, and durable-memory reserves", () => {
    const usage = usageFor({ contextWindow: 8192, responseLength: 1024 });

    const expected = 1024 + CONTEXT_SAFETY_RESERVE + DURABLE_MEMORY_RESERVE;
    expect(usage.fixedReserve).toBe(expected);
    expect(usage.usableInputTokens).toBe(8192 - expected);
  });

  it("reserves additional room only when the knowledge base is on", () => {
    const off = usageFor({ useKnowledgeBase: false });
    const on = usageFor({ useKnowledgeBase: true });

    expect(on.fixedReserve - off.fixedReserve).toBe(KNOWLEDGE_BASE_RESERVE);
    expect(on.usableInputTokens).toBeLessThan(off.usableInputTokens);
  });

  it("reports no usable input budget when reserves exceed the context window", () => {
    const usage = usageFor({ contextWindow: 2048, responseLength: 4096, useKnowledgeBase: true });

    expect(usage.usableInputTokens).toBe(0);
  });
});

describe("getContextUsage — prompt accounting", () => {
  it("counts only messages after the summarized boundary", () => {
    const all = messages(10);

    const full = usageFor({ messages: all, summarizedMessageCount: 0 });
    const partial = usageFor({ messages: all, summarizedMessageCount: 6 });

    expect(partial.unsummarizedTokens).toBeLessThan(full.unsummarizedTokens);
    expect(partial.promptTokens).toBeLessThan(full.promptTokens);
  });

  it("adds the rolling summary and system prompt to the prompt total", () => {
    const bare = usageFor({ messages: messages(2) });
    const withExtras = usageFor({
      messages: messages(2),
      memorySummary: "Goals: finish the packaging work.",
      systemPrompt: "You are a careful assistant.",
    });

    expect(withExtras.summaryTokens).toBeGreaterThan(0);
    expect(withExtras.systemTokens).toBeGreaterThan(0);
    expect(withExtras.promptTokens).toBe(
      bare.unsummarizedTokens + withExtras.summaryTokens + withExtras.systemTokens
    );
  });

  it("reserves budget for attached images", () => {
    const withoutImage = usageFor({ messages: [{ role: "user", content: "look" }] });
    const withImage = usageFor({
      messages: [{ role: "user", content: "look", images: ["base64data"] }],
    });

    // Vision costs vary; use a conservative reserve, not a claimed exact count.
    expect(withImage.unsummarizedTokens - withoutImage.unsummarizedTokens).toBe(2048);
  });

  it("treats an empty conversation as zero prompt tokens", () => {
    const usage = usageFor({ messages: [] });

    expect(usage.promptTokens).toBe(0);
    expect(usage.ratio).toBe(0);
  });

  it("expresses the ratio against the usable budget, not the raw window", () => {
    const usage = usageFor({ messages: messages(20) });

    expect(usage.ratio).toBeCloseTo(usage.promptTokens / usage.usableInputTokens, 10);
  });
});

describe("getContextStatus", () => {
  it("reports healthy below the compaction trigger", () => {
    expect(getContextStatus({ ratio: 0.5 })).toEqual({
      className: "healthy",
      label: "within budget",
    });
  });

  it("warns at the compaction trigger", () => {
    expect(getContextStatus({ ratio: contextDefaults.normalTriggerRatio }).className).toBe(
      "warning"
    );
  });

  it("escalates to critical at 90 percent", () => {
    expect(getContextStatus({ ratio: 0.9 }).className).toBe("critical");
  });

  it("stays critical when over budget", () => {
    expect(getContextStatus({ ratio: 2.4 }).className).toBe("critical");
  });
});

describe("formatTokenEstimate", () => {
  it.each([
    [0, "0"],
    [1, "1"],
    [999, "999"],
    [1000, "1.0k"],
    [1500, "1.5k"],
    [9999, "10.0k"],
    [10000, "10k"],
    [128000, "128k"],
  ])("formats %i as %s", (input, expected) => {
    expect(formatTokenEstimate(input)).toBe(expected);
  });

  it("never renders a negative estimate", () => {
    expect(formatTokenEstimate(-50)).toBe("0");
  });
});

describe("buildContextMessages", () => {
  it('keeps pending image uploads with the latest question and drops only older pixel groups', () => {
    const history = [{ role: 'user', content: 'old image', images: ['old'] }, { role: 'assistant', content: 'Old observations.' },
      { role: 'user', content: 'image A', images: ['a'] }, { role: 'user', content: 'image B', images: ['b'] }, { role: 'user', content: 'Compare them.' }];
    expect(recentTurnStart(history)).toBe(2);
    const built = buildContextMessages(history, '', 0);
    expect(built[0].images).toBeUndefined();
    expect(built.slice(2)).toEqual(history.slice(2));
    expect(history[0].images).toEqual(['old']);
  });
  it("sends only the unsummarized tail", () => {
    const built = buildContextMessages(messages(6), "", 4);

    expect(built).toHaveLength(2);
    expect(built[0].content).toContain("4");
  });

  it("prepends the rolling summary as a system message", () => {
    const built = buildContextMessages(messages(2), "Goals: ship it.", 0);

    expect(built).toHaveLength(3);
    expect(built[0].role).toBe("system");
    expect(built[0].content).toContain("Goals: ship it.");
  });

  it("omits the system message when the summary is blank", () => {
    expect(buildContextMessages(messages(2), "   ", 0)).toHaveLength(2);
  });

  it("strips runtime-only fields that must never reach the model", () => {
    const built = buildContextMessages(
      [
        {
          role: "user",
          content: "hi",
          id: "msg-1",
          imagePreviews: [{ src: "data:image/png;base64,AAAA", name: "big.png" }],
          generatedImages: [{ src: "data:image/png;base64,BBBB" }],
        },
      ],
      "",
      0
    );

    expect(built[0]).toEqual({ role: "user", content: "hi" });
  });

  it("preserves raw images, which the model does need", () => {
    const built = buildContextMessages(
      [{ role: "user", content: "describe", images: ["rawbase64"], id: "m1" }],
      "",
      0
    );

    expect(built[0]).toEqual({ role: "user", content: "describe", images: ["rawbase64"] });
  });

  it("treats a missing summarized count as zero", () => {
    expect(buildContextMessages(messages(3), "", undefined)).toHaveLength(3);
  });
});

describe("rotateContextMemory", () => {
  it('compacts a four-message overflow without sacrificing the newest turn', async () => {
    const all = longMessages(4);
    const compactMemory = vi.fn().mockResolvedValue({ summary: 'Keep original files.' });
    const result = await rotateContextMemory({ api: { compactMemory }, model: 'local', messages: all,
      memorySummary: '', summarizedMessageCount: 0, contextWindow: 4096, responseLength: 512, useDurableMemory: false });
    expect(compactMemory).toHaveBeenCalledTimes(1);
    expect(result.summarizedMessageCount).toBe(2);
    expect(result.contextMessages.slice(-2)).toEqual(all.slice(-2));
    expect(result.usage.promptTokens).toBeLessThan(4096);
  });
  function apiReturning(summary) {
    return { compactMemory: vi.fn().mockResolvedValue({ summary }) };
  }

  const baseArgs = {
    model: "mistral:latest",
    contextWindow: 8192,
    responseLength: 1024,
    systemPrompt: "",
    useKnowledgeBase: false,
  };

  it("does not compact a short conversation that is under budget", async () => {
    const api = apiReturning("should not be used");

    const result = await rotateContextMemory({
      ...baseArgs,
      api,
      messages: messages(2),
      memorySummary: "",
      summarizedMessageCount: 0,
    });

    expect(api.compactMemory).not.toHaveBeenCalled();
    expect(result.memorySummary).toBe("");
    expect(result.summarizedMessageCount).toBe(0);
  });

  it("refuses to compact when only the protected recent messages remain", async () => {
    const api = apiReturning("nope");

    // The latest user request and answer are retained together.
    await rotateContextMemory({
      ...baseArgs,
      api,
      messages: longMessages(2),
      memorySummary: "",
      summarizedMessageCount: 0,
      force: true,
    });

    expect(api.compactMemory).not.toHaveBeenCalled();
  });

  it("allows manual compaction of older turns even when the history fits", async () => {
    const api = apiReturning("nope");

    await rotateContextMemory({
      ...baseArgs,
      api,
      messages: messages(20),
      memorySummary: "",
      summarizedMessageCount: 0,
      force: true,
    });

    expect(api.compactMemory).toHaveBeenCalledTimes(1);
    expect(api.compactMemory.mock.calls[0][0].messages).toHaveLength(18);
  });

  it("compacts when forced and there is older history to fold in", async () => {
    const api = apiReturning("Goals: tested summary.");

    const result = await rotateContextMemory({
      ...baseArgs,
      api,
      messages: longMessages(20),
      memorySummary: "",
      summarizedMessageCount: 0,
      force: true,
    });

    expect(api.compactMemory).toHaveBeenCalledTimes(1);
    expect(result.memorySummary).toBe("Goals: tested summary.");
    expect(result.summarizedMessageCount).toBeGreaterThan(0);
  });

  it("compacts automatically once the trigger ratio is crossed", async () => {
    const api = apiReturning("Auto summary.");

    // No `force` here — the budget alone should drive compaction.
    const result = await rotateContextMemory({
      ...baseArgs,
      api,
      messages: longMessages(20),
      memorySummary: "",
      summarizedMessageCount: 0,
    });

    expect(api.compactMemory).toHaveBeenCalledTimes(1);
    expect(result.memorySummary).toBe("Auto summary.");
  });

  it("keeps the latest complete turn rather than four arbitrarily large messages", async () => {
    const api = apiReturning("summary");
    const all = longMessages(30);

    const result = await rotateContextMemory({
      ...baseArgs,
      api,
      messages: all,
      memorySummary: "",
      summarizedMessageCount: 0,
      force: true,
    });

    expect(all.length - result.summarizedMessageCount).toBe(2);
    expect(result.contextMessages.slice(-2)).toEqual(all.slice(-2));
  });

  it("forwards the previous summary and cancellation handles to the backend", async () => {
    const api = apiReturning("new summary");
    const signal = new AbortController().signal;

    await rotateContextMemory({
      ...baseArgs,
      api,
      messages: longMessages(20),
      memorySummary: "previous summary",
      summarizedMessageCount: 0,
      force: true,
      requestId: "req-1",
      sessionId: "source-chat",
      signal,
    });

    expect(api.compactMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "mistral:latest",
        previousSummary: "previous summary",
        targetTokens: contextDefaults.summaryTargetTokens,
        requestId: "req-1",
        sessionId: "source-chat",
        signal,
      })
    );
  });

  it("strips image payloads before sending history to the summarizer", async () => {
    const api = apiReturning("summary");
    const withImages = longMessages(20).map((m, i) =>
      i === 0 ? { ...m, images: ["averylongbase64payload"] } : m
    );

    await rotateContextMemory({
      ...baseArgs,
      api,
      messages: withImages,
      memorySummary: "",
      summarizedMessageCount: 0,
      force: true,
    });

    const sent = api.compactMemory.mock.calls[0][0].messages;
    const withImage = sent.find((m) => m.images);
    expect(withImage.images).toEqual(["[image omitted]"]);
  });

  it("keeps the previous summary when the backend returns nothing usable", async () => {
    const api = apiReturning("");

    const result = await rotateContextMemory({
      ...baseArgs,
      api,
      messages: longMessages(20),
      memorySummary: "previous summary",
      summarizedMessageCount: 0,
      force: true,
    });

    expect(result.memorySummary).toBe("previous summary");
    expect(result.summarizedMessageCount).toBe(0);
    expect(result.contextMessages.filter(message => message.role !== "system")).toHaveLength(20);
  });

  it("returns context messages that already include the new summary", async () => {
    const api = apiReturning("Fresh summary.");

    const result = await rotateContextMemory({
      ...baseArgs,
      api,
      messages: longMessages(20),
      memorySummary: "",
      summarizedMessageCount: 0,
      force: true,
    });

    expect(result.contextMessages[0].role).toBe("system");
    expect(result.contextMessages[0].content).toContain("Fresh summary.");
  });

  it("reports usage recalculated after compaction, not before", async () => {
    const api = apiReturning("Short summary.");

    const result = await rotateContextMemory({
      ...baseArgs,
      api,
      messages: longMessages(40),
      memorySummary: "",
      summarizedMessageCount: 0,
      force: true,
    });

    const before = getContextUsage({
      messages: longMessages(40),
      memorySummary: "",
      summarizedMessageCount: 0,
      ...baseArgs,
    });
    expect(result.usage.promptTokens).toBeLessThan(before.promptTokens);
  });

  it("propagates a summarizer failure to the caller", async () => {
    const api = { compactMemory: vi.fn().mockRejectedValue(new Error("backend down")) };

    await expect(
      rotateContextMemory({
        ...baseArgs,
        api,
        messages: longMessages(20),
        memorySummary: "",
        summarizedMessageCount: 0,
        force: true,
      })
    ).rejects.toThrow("backend down");
  });
});
