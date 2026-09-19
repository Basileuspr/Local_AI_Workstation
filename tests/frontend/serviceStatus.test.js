/**
 * Tests for turning dependency status into user-facing guidance.
 *
 * The failure this replaces: every problem rendered as "almost ready", so a
 * machine with no Ollama, no models, or a broken index looked identical and
 * gave the user nothing to act on.
 */

import { describe, expect, it } from "vitest";
import { SEVERITY, canChat, describeStatus, statusIndicator } from "../../src/serviceStatus.js";

const healthy = {
  backend: { ok: true },
  ollama: { reachable: true, url: "http://localhost:11434", error: null, detail: null },
  models: { chat_count: 3, embedding_ready: true, embedding_model: "nomic-embed-text" },
  knowledge_base: { ok: true, documents: 12, error: null },
};

const withStatus = (overrides) => ({ ...healthy, ...overrides });

describe("describeStatus — healthy", () => {
  it("reports no problem when everything is available", () => {
    expect(describeStatus(healthy)).toBeNull();
  });

  it("treats an empty knowledge base as healthy, not broken", () => {
    const status = withStatus({ knowledge_base: { ok: true, documents: 0, error: null } });

    expect(describeStatus(status)).toBeNull();
  });
});

describe("describeStatus — blocked", () => {
  it("reports an unreachable backend first", () => {
    const problem = describeStatus(withStatus({ backend: { ok: false } }));

    expect(problem.severity).toBe(SEVERITY.blocked);
    expect(problem.code).toBe("backend_unreachable");
  });

  it("names Ollama not running and gives the command to start it", () => {
    const problem = describeStatus(
      withStatus({
        ollama: {
          reachable: false,
          error: "not_running",
          detail: "Nothing is listening at http://localhost:11434.",
          url: "http://localhost:11434",
        },
      })
    );

    expect(problem.severity).toBe(SEVERITY.blocked);
    expect(problem.title).toBe("Ollama is not running");
    expect(problem.detail).toContain("11434");
    expect(problem.action).toBe("ollama serve");
  });

  it("distinguishes a timeout from Ollama being absent", () => {
    const problem = describeStatus(
      withStatus({ ollama: { reachable: false, error: "timeout", detail: "did not respond" } })
    );

    expect(problem.title).toBe("Cannot reach Ollama");
    expect(problem.action).toBeNull();
  });

  it("tells the user to pull a model when none are installed", () => {
    const problem = describeStatus(
      withStatus({ models: { chat_count: 0, embedding_ready: true, embedding_model: "n" } })
    );

    expect(problem.severity).toBe(SEVERITY.blocked);
    expect(problem.code).toBe("no_chat_models");
    expect(problem.action).toBe("ollama pull mistral");
  });

  it("prefers the backend problem over downstream ones", () => {
    const problem = describeStatus({
      backend: { ok: false },
      ollama: { reachable: false, error: "not_running" },
      models: { chat_count: 0, embedding_ready: false },
      knowledge_base: { ok: false },
    });

    expect(problem.code).toBe("backend_unreachable");
  });

  it("prefers Ollama being down over an empty model list", () => {
    const problem = describeStatus(
      withStatus({
        ollama: { reachable: false, error: "not_running" },
        models: { chat_count: 0, embedding_ready: false, embedding_model: "n" },
      })
    );

    expect(problem.code).toBe("not_running");
  });
});

describe("describeStatus — degraded", () => {
  it("reports a missing embedding model without blocking chat", () => {
    const problem = describeStatus(
      withStatus({
        models: { chat_count: 2, embedding_ready: false, embedding_model: "nomic-embed-text" },
      })
    );

    expect(problem.severity).toBe(SEVERITY.degraded);
    expect(problem.action).toBe("ollama pull nomic-embed-text");
    expect(problem.detail).toContain("Chat works");
  });

  it("names the configured embedding model, not a hardcoded one", () => {
    const problem = describeStatus(
      withStatus({
        models: { chat_count: 2, embedding_ready: false, embedding_model: "mxbai-embed-large" },
      })
    );

    expect(problem.action).toBe("ollama pull mxbai-embed-large");
  });

  it("reports an unreadable knowledge base as degraded", () => {
    const problem = describeStatus(
      withStatus({ knowledge_base: { ok: false, documents: 0, error: "database is locked" } })
    );

    expect(problem.severity).toBe(SEVERITY.degraded);
    expect(problem.detail).toContain("database is locked");
  });
});

describe("describeStatus — defensive", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
  ])("treats %s as an unreachable backend rather than throwing", (_label, input) => {
    const problem = describeStatus(input);

    expect(problem.code).toBe("backend_unreachable");
  });

  it("tolerates a partial payload from an older backend", () => {
    expect(() => describeStatus({ backend: { ok: true } })).not.toThrow();
  });
});

describe("statusIndicator", () => {
  it("shows an error when disconnected", () => {
    expect(statusIndicator({ connected: false }).className).toBe("error");
  });

  it("shows an error for a blocking problem even while connected", () => {
    const problem = describeStatus(withStatus({ ollama: { reachable: false, error: "not_running" } }));

    expect(statusIndicator({ connected: true, problem, hasModel: false }).className).toBe("error");
  });

  it("shows a warning for a degraded problem", () => {
    const problem = describeStatus(
      withStatus({ models: { chat_count: 1, embedding_ready: false, embedding_model: "n" } })
    );
    const indicator = statusIndicator({ connected: true, problem, hasModel: true });

    expect(indicator.className).toBe("warning");
    expect(indicator.label).toBe("limited");
  });

  it("reports generating ahead of a degraded warning", () => {
    const problem = describeStatus(
      withStatus({ models: { chat_count: 1, embedding_ready: false, embedding_model: "n" } })
    );

    expect(
      statusIndicator({ connected: true, isGenerating: true, problem, hasModel: true }).label
    ).toBe("responding");
  });

  it("reports ready when everything is available", () => {
    const indicator = statusIndicator({ connected: true, problem: null, hasModel: true });

    expect(indicator).toEqual({ className: "ready", label: "ready" });
  });

  it("still reports almost ready while a model is being selected", () => {
    expect(statusIndicator({ connected: true, problem: null, hasModel: false }).label).toBe(
      "almost ready"
    );
  });
});

describe("canChat", () => {
  it("allows chat when nothing is wrong", () => {
    expect(canChat(null)).toBe(true);
  });

  it("allows chat when only degraded", () => {
    const problem = describeStatus(
      withStatus({ models: { chat_count: 1, embedding_ready: false, embedding_model: "n" } })
    );

    expect(canChat(problem)).toBe(true);
  });

  it("blocks chat when Ollama is unreachable", () => {
    const problem = describeStatus(withStatus({ ollama: { reachable: false, error: "not_running" } }));

    expect(canChat(problem)).toBe(false);
  });
});
