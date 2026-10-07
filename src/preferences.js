import { defaultRoleplayConfig, mergeRoleplayConfig } from "./roleplayPrompt";
import { defaultAppearance, normalizeAppearance } from "./appearance";
import {defaultMixerSettings, normalizeMixerSettings} from './mixerSettings';

export const PREFERENCES_STORAGE_KEY = "local-ai-workstation-preferences-v1";
export const LEGACY_ROLEPLAY_STORAGE_KEY = "local-ai-workstation-roleplay";

export const defaultSoundOutput = {volume:1, muted:false, deviceId:'', deviceLabel:''};
export function normalizeSoundOutput(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const volume = typeof value.volume === 'number' && Number.isFinite(value.volume) ? Math.min(1, Math.max(0, value.volume)) : 1;
  const deviceId = typeof value.deviceId === 'string' && value.deviceId.length <= 512 && !/[\u0000-\u001f]/.test(value.deviceId) && value.deviceId !== 'default' ? value.deviceId : '';
  return {volume, muted:value.muted === true, deviceId,
    deviceLabel:deviceId && typeof value.deviceLabel === 'string' ? value.deviceLabel.slice(0,200) : ''};
}

export const defaultVoiceOutput = {
  autoSpeak: false, referenceId: '', referenceName: '', referenceText: '',
  engine: 'chatterbox-turbo', language: 'English', acceleration: 'auto',
};

export function normalizeVoiceOutput(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const engine = ['omnivoice','chatterbox-turbo','qwen3-tts'].includes(value.engine) ? value.engine : defaultVoiceOutput.engine;
  return {
    autoSpeak: value.autoSpeak === true,
    referenceId: /^[a-f0-9]{64}$/.test(value.referenceId || '') ? value.referenceId : '',
    referenceName: typeof value.referenceName === 'string' ? value.referenceName.slice(0, 200) : '',
    referenceText: typeof value.referenceText === 'string' ? value.referenceText.slice(0, 4000) : '',
    engine,
    language: ['English','Chinese','Japanese','Korean','German','French','Russian','Portuguese','Spanish','Italian'].includes(value.language) && engine !== 'chatterbox-turbo' ? value.language : 'English',
    acceleration: value.acceleration === 'cpu' ? 'cpu' : 'auto',
  };
}

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
  allowLongWait: false,
  outputDir: "",
};

const DEFAULT_PREFERENCES = {
  startupBehavior: "new",
  appearance: defaultAppearance,
  activeProfile: "balanced",
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  numPredict: 1024,
  responseLength: 1024,
  systemPrompt: "",
  responseStyle: "default",
  selectedModel: "",
  modelOrder: [],
  knowledgeScopes: {},
  summaryModel: "",
  useKnowledgeBase: false,
  toolUseEnabled: false,
  chatToolIds: ['system_stats', 'runtime_status', 'chat_models', 'knowledge_list', 'knowledge_search', 'knowledge_read'],
  roleplay: defaultRoleplayConfig,
  imageSettings: defaultImageSettings,
  voiceOutput: defaultVoiceOutput,
  soundOutput: defaultSoundOutput,
  soundMixer: defaultMixerSettings,
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
        appearance: normalizeAppearance(saved.appearance),
        roleplay: mergeRoleplayConfig(saved.roleplay),
        imageSettings: { ...defaultImageSettings, ...(saved.imageSettings || {}) },
        voiceOutput: normalizeVoiceOutput(saved.voiceOutput),
        soundOutput: normalizeSoundOutput(saved.soundOutput),
        soundMixer: normalizeMixerSettings(saved.soundMixer),
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
    startupBehavior: state.startupBehavior === "resume" ? "resume" : "new",
    appearance: normalizeAppearance(state.appearance),
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
    modelOrder: state.modelOrder,
    knowledgeScopes: state.knowledgeScopes,
    summaryModel: state.summaryModel,
    useKnowledgeBase: state.useKnowledgeBase,
    toolUseEnabled: state.toolUseEnabled === true,
    chatToolIds: state.chatToolIds,
    roleplay: state.roleplay,
    imageSettings: state.imageSettings,
    voiceOutput: normalizeVoiceOutput(state.voiceOutput),
    soundOutput: normalizeSoundOutput(state.soundOutput),
    soundMixer: normalizeMixerSettings(state.soundMixer),
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
