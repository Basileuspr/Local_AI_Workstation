import { expect, it } from "vitest";
import { editCommandSettings, isEditCommand } from "../../src/chatEdit";
import { rotationKey } from "../../src/mediaRotation";

it("routes only the explicit edit slash command and preserves all requested supported edits", () => {
  expect(isEditCommand("/Edit rotate right")).toBe(true);
  expect(isEditCommand("/editor")).toBe(false);
  expect(isEditCommand("please /Edit this")).toBe(false);
  expect(editCommandSettings("/Edit retain image exact, but reduce red hue, increase contrast and decrease exposure")).toMatchObject({ red:60, contrast:20, exposure:-.5 });
  expect(editCommandSettings("/EDIT rotate left").rotation).toBe(270);
});
it("does not silently ignore unsupported changes or claim they were performed", () => {
  expect(() => editCommandSettings("/Edit rotate right and replace the background")).toThrow("Supported phrases");
  expect(editCommandSettings("/Edit").rotation).toBe(0);
});
it("view orientation is stable across credential/privacy refreshes without retaining tokens", () => {
  expect(rotationKey("http://localhost:8000/sessions/a/images/b?law_token=secret&privacy=4")).toBe("/sessions/a/images/b");
  expect(rotationKey("data:image/png;base64,abc")).not.toContain("base64");
});
