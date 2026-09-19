import { defaultRoleplayConfig, mergeRoleplayConfig } from "./roleplayPrompt";

export const PREFERENCES_STORAGE_KEY = "local-ai-workstation-preferences-v1";
export const LEGACY_ROLEPLAY_STORAGE_KEY = "local-ai-workstation-roleplay";

export const defaultImageSettings = {
  modelId: "",
  prompt: "",
  negativePrompt: "",
  width: 1024,
  height: 1024,
  steps: 24,
  guidanceScale: 5.5,
  seed: "",
  loraId: "",
  loraScale: 1,
  longPrompt: true,
};

const DEFAULT_PREFERENCES = {
  activeProfile: "balanced",
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  numPredict: 1024,
  responseLength: 1024,
  systemPrompt: "",
  responseStyle: "structured",
  selectedModel: "",
  summaryModel: "",
  useKnowledgeBase: false,
  roleplay: defaultRoleplayConfig,
  imageSettings: defaultImageSettings,
  customProfiles: [],
  activeCustomProfileId: "",
  activeLoraProjectId: "",
};

function storageAvailable() {
  return typeof window !== "undefined" && window.localStorage;
}

export function loadPreferences() {
  if (!storageAvailable()) return DEFAULT_PREFERENCES;

  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return {
        ...DEFAULT_PREFERENCES,
        ...saved,
        roleplay: mergeRoleplayConfig(saved.roleplay),
        imageSettings: { ...defaultImageSettings, ...(saved.imageSettings || {}) },
        customProfiles: Array.isArray(saved.customProfiles) ? saved.customProfiles : [],
        activeCustomProfileId: saved.activeCustomProfileId || "",
      };
    }
  } catch {
    // Ignore bad preference state and fall back below.
  }

  try {
    const legacyRoleplay = localStorage.getItem(LEGACY_ROLEPLAY_STORAGE_KEY);
    if (legacyRoleplay) {
      return {
        ...DEFAULT_PREFERENCES,
        roleplay: mergeRoleplayConfig(JSON.parse(legacyRoleplay)),
      };
    }
  } catch {
    // Ignore bad legacy roleplay state.
  }

  return DEFAULT_PREFERENCES;
}

export function pickPreferences(state) {
  return {
    activeProfile: state.activeProfile,
    temperature: state.temperature,
    topP: state.topP,
    topK: state.topK,
    repeatPenalty: state.repeatPenalty,
    numPredict: state.numPredict,
    responseLength: state.responseLength,
    systemPrompt: state.systemPrompt,
    responseStyle: state.responseStyle,
    selectedModel: state.selectedModel,
    summaryModel: state.summaryModel,
    useKnowledgeBase: state.useKnowledgeBase,
    roleplay: state.roleplay,
    imageSettings: state.imageSettings,
    customProfiles: state.customProfiles,
    activeCustomProfileId: state.activeCustomProfileId,
    activeLoraProjectId: state.activeLoraProjectId,
  };
}

export function savePreferences(preferences) {
  if (!storageAvailable()) return;
  localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function clearPreferences() {
  if (!storageAvailable()) return;
  localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  localStorage.removeItem(LEGACY_ROLEPLAY_STORAGE_KEY);
}
