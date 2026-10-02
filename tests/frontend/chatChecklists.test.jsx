import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownMessage from "../../src/components/MarkdownMessage";
import ChatChecklistHistory from "../../src/components/ChatChecklistHistory";
import { updateChecklistItem } from "../../src/api";
import { reducer } from "../../src/useStore";

afterEach(() => vi.unstubAllGlobals());

it("renders checked, unchecked and nested tasks alongside ordinary lists", () => {
  const html = renderToStaticMarkup(<MarkdownMessage onTaskToggle={() => {}}>{
    "- [ ] **Buy milk**\n  + [X] Nested\n- Ordinary\n1. [x] Ordered"
  }</MarkdownMessage>);
  expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  expect(html.match(/ checked=""/g)).toHaveLength(2);
  expect(html).toContain("<strong>Buy milk</strong>");
  expect(html).toContain("<li>Ordinary</li>");
  expect(html).not.toContain("disabled");
});

it.each(["```md\n- [ ] Example\n```", "  ~~~~md\n- [ ] Example\n~~~\n- [ ] Still code\n~~~~"])(
  "keeps code samples inert: %s", source => {
    const html = renderToStaticMarkup(<MarkdownMessage onTaskToggle={() => {}}>{source}</MarkdownMessage>);
    expect(html).toContain("<pre>");
    expect(html).not.toContain('type="checkbox"');
  });

it("shows read-only boxes outside editable chat and disables during save", () => {
  expect(renderToStaticMarkup(<MarkdownMessage>{"- [ ] Preview"}</MarkdownMessage>)).toContain('disabled=""');
  expect(renderToStaticMarkup(<MarkdownMessage onTaskToggle={() => {}} taskDisabledReason="Saving checklist…">{
    "- [ ] Task"}</MarkdownMessage>)).toContain('disabled=""');
});

it("sends only one requested task edit and surfaces save conflicts", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ detail: {
    code: "session_conflict", message: "Reload this chat before saving", current_revision: "new",
  } }) });
  vi.stubGlobal("fetch", fetch);
  await expect(updateChecklistItem("chat", "message", { lineIndex: 3, checked: true, expectedContent: "- [ ] Task" }))
    .rejects.toMatchObject({ status: 409, code: "session_conflict" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ line_index: 3, checked: true, expected_content: "- [ ] Task" });
});

const state = { currentSessionId: "a", sessionRevision: "r1", memorySummary: "Old summary", summarizedMessageCount: 1,
  conversationHistory: [{ id: "tasks", content: "- [ ] Task", artifacts: [{ id: "document" }] }, { id: "new", content: "Newer reply" }] };
const action = { type: "CHECKLIST_ITEM_SAVED", expectedContent: "- [ ] Task", payload: {
  id: "a", message_id: "tasks", content: "- [x] Task", previous_revision: "r1", revision: "r2",
  memory_summary: "", summarized_message_count: 0,
} };

it("merges a saved task without replacing newer replies or message attachments", () => {
  const updated = reducer(state, action);
  expect(updated.conversationHistory[0]).toEqual({ ...state.conversationHistory[0], content: "- [x] Task" });
  expect(updated.conversationHistory[1]).toBe(state.conversationHistory[1]);
  expect(updated.sessionRevision).toBe("r2");
  expect(updated.memorySummary).toBe("");
  expect(updated.summarizedMessageCount).toBe(0);
});

it("ignores navigation and stale message results and never advances an unmatched history revision", () => {
  const navigated = { ...state, currentSessionId: "b" };
  expect(reducer(navigated, action)).toBe(navigated);
  const changed = { ...state, conversationHistory: [{ id: "tasks", content: "A newer message" }] };
  expect(reducer(changed, action)).toBe(changed);
  const advanced = reducer({ ...state, sessionRevision: "r3" }, action);
  expect(advanced.sessionRevision).toBe("r3");
  expect(advanced.conversationHistory[0].content).toBe("- [x] Task");
});

it("merges saved list history into the same message for chat and pinned views", () => {
  const history = [{ id: 'edit-1', changes: [{ kind: 'added' }] }];
  const saved = { ...action, payload: { ...action.payload, checklist_history: history, checklist_editable: true } };
  const next = reducer(state, saved);
  expect(next.conversationHistory[0].checklist_history).toBe(history);
  expect(next.conversationHistory[1]).toBe(state.conversationHistory[1]);
  expect(reducer({ ...state, currentSessionId: 'another' }, saved).conversationHistory[0].checklist_history).toBeUndefined();
});

it("shows dated changes and previous lists without interactive boxes or executing item text", () => {
  const entry = { id: 'edit-1', at: '2026-10-02T12:00:00-06:00',
    before: [{ text: 'Deleted task', checked: false }], after: [{ text: '<script>alert(1)</script>', checked: true }],
    changes: [{ kind: 'removed', before: { text: 'Deleted task' } }, { kind: 'added', after: { text: '<script>alert(1)</script>' } }] };
  const html = renderToStaticMarkup(<ChatChecklistHistory history={[entry]}/>);
  expect(html).toContain('List history (1)');
  expect(html).toContain('Removed:'); expect(html).toContain('Added:');
  expect(html).toContain('List before this change'); expect(html).toContain('List after this change');
  expect(html).toContain('dateTime="2026-10-02T12:00:00-06:00"');
  expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
  expect(html).not.toContain('type="checkbox"');
  expect(renderToStaticMarkup(<ChatChecklistHistory history={[]}/>)).toBe('');
});
