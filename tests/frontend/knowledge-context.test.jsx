import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ state: {}, dispatch: vi.fn() }));
vi.mock("../../src/useStore", () => ({ useStore: () => fixture.state, useDispatch: () => fixture.dispatch }));
vi.mock("react", async importOriginal => ({ ...await importOriginal(), useState: initial => [initial === false ? true : initial, vi.fn()] }));
import KnowledgeContext from "../../src/components/KnowledgeContext";

function findSelect(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "select") return node;
  return [node.props?.children].flat(Infinity).map(findSelect).find(Boolean);
}
beforeEach(() => fixture.dispatch.mockClear());
it.each([false, true])("remembers chosen documents after switching Knowledge off or to All (%s)", enabled => {
  fixture.state = { currentSessionId: "a", useKnowledgeBase: enabled, knowledgeDocIds: null,
    kbDocuments: [], knowledgeScopes: { a: { mode: enabled ? "all" : "off", ids: ["chosen"] } } };
  findSelect(KnowledgeContext()).props.onChange({ target: { value: "selected" } });
  expect(fixture.dispatch).toHaveBeenCalledWith({ type: "SET_KNOWLEDGE_SCOPE", payload: { mode: "selected", ids: ["chosen"] } });
});
it("uses the current chat's saved selection", () => {
  fixture.state = { currentSessionId: "b", useKnowledgeBase: false, knowledgeDocIds: null,
    kbDocuments: [], knowledgeScopes: { a: { mode: "off", ids: ["private-a"] }, b: { mode: "off", ids: ["chosen-b"] } } };
  findSelect(KnowledgeContext()).props.onChange({ target: { value: "selected" } });
  expect(fixture.dispatch.mock.calls[0][0].payload.ids).toEqual(["chosen-b"]);
});
