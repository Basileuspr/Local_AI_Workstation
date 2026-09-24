import { describe, expect, it } from "vitest";
import { reducer } from "../../src/useStore.jsx";
import { defaultImageSettings, pickPreferences } from "../../src/preferences";

describe("reset Generate settings", () => {
  it("clears an unavailable runtime adapter without overwriting a saved profile or newer selection", () => {
    const settings = { ...defaultImageSettings, modelId: "base", loraId: "deleted-lora", prompt: "A forest" };
    const profile = { id: "saved", name: "Forest", imageSettings: settings };
    const state = { imageSettings: settings, activeCustomProfileId: "saved", customProfiles: [profile] };
    const action = { type: "CLEAR_UNAVAILABLE_IMAGE_LORA", payload: settings };
    const repaired = reducer(state, action);
    expect(repaired.imageSettings).toEqual({ ...settings, loraId: "" });
    expect(repaired.activeCustomProfileId).toBe("");
    expect(repaired.customProfiles).toBe(state.customProfiles);
    expect(profile.imageSettings.loraId).toBe("deleted-lora");
    const newer = { ...state, imageSettings: { ...settings, loraId: "new-lora" } };
    expect(reducer(newer, action)).toBe(newer);
    const otherModel = { ...state, imageSettings: { ...settings, modelId: "other" } };
    expect(reducer(otherModel, action)).toBe(otherModel);
  });
  it("clears the draft without autosaving over the selected profile or touching chat data", () => {
    const settings = { modelId: "model-a", prompt: "teapot", negativePrompt: "text", width: 512, height: 768, steps: 60, guidanceScale: 20, seed: 42, loraId: "adapter-a", loraScale: 0.5, longPrompt: false };
    const profile = { id: "saved", name: "Watercolor", imageSettings: { ...settings } };
    const state = { imageSettings: settings, activeProfile: "creative", activeCustomProfileId: "saved", customProfiles: [profile], selectedModel: "chat-model", temperature: 0.95, currentSessionId: "chat", conversationHistory: [{ role: "user", content: "Keep this" }], sessionImages: ["saved-image"] };
    const reset = reducer(state, { type: "RESET_IMAGE_SETTINGS" });
    expect(reset.imageSettings).toEqual(defaultImageSettings);
    expect(reset.activeProfile).toBe("");
    expect(reset.activeCustomProfileId).toBe("");
    expect(reset.customProfiles).toBe(state.customProfiles);
    expect(profile.imageSettings).toEqual(settings);
    expect(reset.conversationHistory).toBe(state.conversationHistory);
    expect(reset.sessionImages).toBe(state.sessionImages);
    expect(reset.currentSessionId).toBe("chat");
    expect(reset.selectedModel).toBe("chat-model");
    expect(reset.temperature).toBe(0.95);
    expect(pickPreferences(reset).imageSettings.modelId).toBe("");
    const edited = reducer(reset, { type: "SET_IMAGE_SETTINGS", payload: { prompt: "new draft" } });
    expect(edited.customProfiles).toBe(state.customProfiles);
    expect(defaultImageSettings.prompt).toBe("");
  });
});
