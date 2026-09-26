import { createContext, useContext, useReducer, useRef, useCallback } from "react";
import { defaultRoleplayConfig, mergeRoleplayConfig } from "./roleplayPrompt";
import { defaultImageSettings, loadPreferences } from "./preferences";
import { loadNavigation } from "./navigation";
import { orderModels } from "./modelOrder";

const StoreContext = createContext(null);
const DispatchContext = createContext(null);
const RefsContext = createContext(null);

const initialState = {
  // Connection
  connected: false,
  // Dependency readiness (Ollama, models, embeddings, knowledge base).
  serviceStatus: null,
  modelsError: null,

  // Models
  models: [],
  selectedModel: "",
  summaryModel: "",

  // Session
  currentSessionId: null,
  conversationHistory: [],
  sessionTitle: "New Chat",
  memorySummary: "",
  summarizedMessageCount: 0,
  scrollTargetMessageId: "",

  // Sidebar
  activeSidebarTab: "chats",
  sessions: [],
  sessionImages: [],
  kbDocuments: [],

  // Generation
  isGenerating: false,

  // Knowledge Base
  useKnowledgeBase: false,
  knowledgeDocIds: null,
  knowledgeMode: "off",

  // Settings
  settingsOpen: false,
  slidersOpen: false,
  activeProfile: "balanced",
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  numPredict: 1024,
  responseLength: 1024,
  systemPrompt: "",
  responseStyle: "structured",
  roleplayOpen: false,
  roleplay: defaultRoleplayConfig,
  imageSettings: defaultImageSettings,
  customProfiles: [],
  activeCustomProfileId: "",
  activeLoraProjectId: "",
  sceneToOpen: null,

  // Toast
  toast: null, // { message, type }
};

function createInitialState() {
  const preferences = loadPreferences();
  const navigation = loadNavigation();
  const scope = preferences.knowledgeScopes?.[navigation.sessionId] || preferences.knowledgeScopes?.draft || { mode: "off", ids: [] };
  return {
    ...initialState,
    ...preferences,
    activeSidebarTab: navigation.tab,
    useKnowledgeBase: scope.mode !== "off",
    knowledgeMode: scope.mode,
    knowledgeDocIds: scope.mode === "selected" ? scope.ids : null,
    roleplay: mergeRoleplayConfig(preferences.roleplay),
  };
}

const profiles = {
  balanced: {
    label: "Balanced",
    systemPrompt: "",
    temperature: 0.7,
    topP: 0.9,
    topK: 40,
    repeatPenalty: 1.1,
    numPredict: 2048,
  },
  precise: {
    label: "Precise",
    systemPrompt:
      "You are a precise, factual assistant. Be concise and accurate. Avoid speculation. When making factual claims, cite sources if possible. Do not cite sources for creative writing, fiction, or hypothetical scenarios. If unsure, say so.",
    temperature: 0.2,
    topP: 0.8,
    topK: 20,
    repeatPenalty: 1.15,
    numPredict: 2048,
  },
  creative: {
    label: "Creative",
    systemPrompt:
      "You are a creative and expressive assistant. Think outside the box. Use vivid language, metaphors, and explore ideas freely. Be imaginative and bold. Never cite sources in creative writing \u2014 just tell the story or express the idea naturally.",
    temperature: 0.95,
    topP: 0.95,
    topK: 60,
    repeatPenalty: 1.05,
    numPredict: 4096,
  },
  coding: {
    label: "Coding",
    systemPrompt:
      "You are a technical coding assistant. Write clean, well-commented code. Explain your reasoning step by step. Use best practices. When showing code, always specify the language. Be precise with syntax.",
    temperature: 0.2,
    topP: 0.85,
    topK: 30,
    repeatPenalty: 1.1,
    numPredict: 4096,
  },
};

function chatSettingsFrom(state) {
  return {
    selectedModel: state.selectedModel,
    summaryModel: state.summaryModel,
    temperature: state.temperature,
    topP: state.topP,
    topK: state.topK,
    repeatPenalty: state.repeatPenalty,
    numPredict: state.numPredict,
    responseLength: state.responseLength,
    systemPrompt: state.systemPrompt,
    responseStyle: state.responseStyle,
    useKnowledgeBase: state.useKnowledgeBase,
    roleplay: state.roleplay,
  };
}

function updateActiveCustomProfile(nextState) {
  if (!nextState.activeCustomProfileId) return nextState;
  const profileIndex = nextState.customProfiles.findIndex(
    (profile) => profile.id === nextState.activeCustomProfileId
  );
  if (profileIndex === -1) return { ...nextState, activeCustomProfileId: "" };

  const customProfiles = nextState.customProfiles.map((profile, index) =>
    index === profileIndex
      ? {
          ...profile,
          imageSettings: { ...nextState.imageSettings },
          chatSettings: chatSettingsFrom(nextState),
          updatedAt: new Date().toISOString(),
        }
      : profile
  );
  return { ...nextState, customProfiles };
}

export function reducer(state, action) {
  switch (action.type) {
    case "OPEN_IMAGE_WORKFLOW":
      return { ...state, activeSidebarTab: "workflows", workflowToOpen: action.payload };
    case "IMAGE_WORKFLOW_OPENED":
      return { ...state, workflowToOpen: null };
    case "OPEN_ITERATIVE_SCENE":
      return { ...state, activeSidebarTab: "workflows", sceneToOpen: action.payload };
    case "ITERATIVE_SCENE_OPENED":
      return state.sceneToOpen === action.payload ? { ...state, sceneToOpen: null } : state;
    case "SET_CONNECTED":
      return { ...state, connected: action.payload };

    case "SET_MODELS":
      return { ...state, models: orderModels(action.payload, state.modelOrder) };
    case "SET_MODEL_ORDER":
      return { ...state, modelOrder: action.payload, models: orderModels(state.models, action.payload) };

    case "SET_SERVICE_STATUS":
      return { ...state, serviceStatus: action.payload };

    case "SET_MODELS_ERROR":
      return { ...state, modelsError: action.payload || null };

    case "SET_SELECTED_MODEL":
      return updateActiveCustomProfile({ ...state, selectedModel: action.payload });

    case "SET_SESSION": {
      const {
        id,
        messages,
        title,
        memorySummary = "",
        summarizedMessageCount = 0,
      } = action.payload;
      const scopes = state.knowledgeScopes || {};
      const scope = scopes[id] || (!state.currentSessionId ? scopes.draft : null) || { mode: "off", ids: [] };
      return {
        ...state,
        currentSessionId: id,
        conversationHistory: messages,
        sessionTitle: title,
        memorySummary,
        summarizedMessageCount,
        scrollTargetMessageId: "",
        knowledgeScopes: id && !scopes[id] ? { ...scopes, [id]: scope, draft: undefined } : scopes,
        knowledgeMode: scope.mode,
        knowledgeDocIds: scope.mode === "selected" ? scope.ids : null,
        useKnowledgeBase: scope.mode !== "off",
      };
    }
    case "SET_KNOWLEDGE_SCOPE": {
      const scope = action.payload;
      return { ...state, knowledgeMode: scope.mode, useKnowledgeBase: scope.mode !== "off",
        knowledgeDocIds: scope.mode === "selected" ? scope.ids : null,
        knowledgeScopes: { ...state.knowledgeScopes, [state.currentSessionId || "draft"]: scope } };
    }

    case "SET_MEMORY":
      return {
        ...state,
        memorySummary: action.payload.memorySummary,
        summarizedMessageCount: action.payload.summarizedMessageCount,
      };

    case "SET_SESSION_TITLE":
      return { ...state, sessionTitle: action.payload };

    case "PUSH_MESSAGE":
      return {
        ...state,
        conversationHistory: [...state.conversationHistory, action.payload],
      };

    case "SET_SCROLL_TARGET":
      return { ...state, scrollTargetMessageId: action.payload || "" };

    case "CLEAR_SCROLL_TARGET":
      return { ...state, scrollTargetMessageId: "" };

    case "SET_SIDEBAR_TAB":
      return { ...state, activeSidebarTab: action.payload };

    case "SET_ACTIVE_LORA_PROJECT":
      return { ...state, activeLoraProjectId: action.payload || "" };

    case "SET_SESSIONS":
      return { ...state, sessions: action.payload };

    case "SET_SESSION_IMAGES":
      return { ...state, sessionImages: action.payload };

    case "SET_KB_DOCUMENTS":
      return { ...state, kbDocuments: action.payload };

    case "SET_GENERATING":
      return { ...state, isGenerating: action.payload };

    case "TOGGLE_KNOWLEDGE_BASE":
      return { ...state, useKnowledgeBase: !state.useKnowledgeBase };

    case "SET_SETTINGS_OPEN":
      return { ...state, settingsOpen: action.payload };

    case "TOGGLE_SLIDERS":
      return { ...state, slidersOpen: !state.slidersOpen };

    case "APPLY_PROFILE": {
      const profile = profiles[action.payload];
      if (!profile) return state;
      const numPredict = profile.numPredict;
      // Find closest response length option
      const options = [256, 512, 1024, 2048, 4096];
      const closest = options.reduce((prev, curr) =>
        Math.abs(curr - numPredict) < Math.abs(prev - numPredict) ? curr : prev
      );
      return {
        ...state,
        activeProfile: action.payload,
        activeCustomProfileId: "",
        temperature: profile.temperature,
        topP: profile.topP,
        topK: profile.topK,
        repeatPenalty: profile.repeatPenalty,
        numPredict: numPredict,
        responseLength: closest,
        systemPrompt: profile.systemPrompt,
      };
    }

    case "SET_PARAM":
      return updateActiveCustomProfile({ ...state, [action.key]: action.value });

    case "SET_IMAGE_SETTINGS":
      return updateActiveCustomProfile({
        ...state,
        imageSettings: { ...state.imageSettings, ...action.payload },
      });

    case "CLEAR_UNAVAILABLE_IMAGE_LORA":
      // Ignore stale catalog results, and detach rather than autosaving this
      // runtime repair over a reusable profile's original adapter selection.
      if (state.imageSettings.modelId !== action.payload.modelId || state.imageSettings.loraId !== action.payload.loraId) return state;
      return { ...state, imageSettings: { ...state.imageSettings, loraId: "" }, activeCustomProfileId: "" };

    case "RESET_IMAGE_SETTINGS":
      // Detach the active preset without autosaving blank settings over it.
      return {
        ...state,
        imageSettings: { ...defaultImageSettings },
        activeProfile: "",
        activeCustomProfileId: "",
      };

    case "CREATE_CUSTOM_PROFILE": {
      const { id, name } = action.payload;
      const profile = {
        id,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        imageSettings: { ...state.imageSettings },
        chatSettings: chatSettingsFrom(state),
      };

      return {
        ...state,
        activeProfile: "",
        activeCustomProfileId: id,
        customProfiles: [...state.customProfiles, profile],
      };
    }

    case "APPLY_CUSTOM_PROFILE": {
      const profile = state.customProfiles.find((entry) => entry.id === action.payload);
      if (!profile) return { ...state, activeCustomProfileId: "" };
      return {
        ...state,
        ...(profile.chatSettings || {}),
        imageSettings: { ...defaultImageSettings, ...(profile.imageSettings || {}) },
        activeProfile: "",
        activeCustomProfileId: profile.id,
      };
    }

    case "RENAME_CUSTOM_PROFILE":
      return {
        ...state,
        customProfiles: state.customProfiles.map((profile) =>
          profile.id === action.payload.id
            ? { ...profile, name: action.payload.name, updatedAt: new Date().toISOString() }
            : profile
        ),
      };

    case "DELETE_CUSTOM_PROFILES":
    case "DELETE_CUSTOM_PROFILE": {
      const removed = new Set(action.type === "DELETE_CUSTOM_PROFILES" ? action.payload : [action.payload]);
      return {
        ...state,
        activeCustomProfileId:
          removed.has(state.activeCustomProfileId) ? "" : state.activeCustomProfileId,
        customProfiles: state.customProfiles.filter((profile) => !removed.has(profile.id)),
      };
    }

    case "TOGGLE_ROLEPLAY_OPEN":
      return { ...state, roleplayOpen: !state.roleplayOpen };

    case "SET_ROLEPLAY":
      return updateActiveCustomProfile({
        ...state,
        roleplay: mergeRoleplayConfig(action.payload),
      });

    case "SET_ROLEPLAY_FIELD":
      return updateActiveCustomProfile({
        ...state,
        roleplay: {
          ...state.roleplay,
          [action.key]: action.value,
        },
      });

    case "RESET_ROLEPLAY":
      return {
        ...state,
        roleplay: defaultRoleplayConfig,
      };

    case "RESET_PREFERENCES":
      return {
        ...state,
        ...createInitialState(),
        connected: state.connected,
        models: state.models,
        currentSessionId: state.currentSessionId,
        conversationHistory: state.conversationHistory,
        sessionTitle: state.sessionTitle,
        memorySummary: state.memorySummary,
        summarizedMessageCount: state.summarizedMessageCount,
        sessions: state.sessions,
        sessionImages: state.sessionImages,
        kbDocuments: state.kbDocuments,
        toast: state.toast,
      };

    case "SET_RESPONSE_LENGTH": {
      const val = action.payload;
      return updateActiveCustomProfile({ ...state, responseLength: val, numPredict: val > 0 ? val : state.numPredict });
    }

    case "SHOW_TOAST":
      return { ...state, toast: action.payload };

    case "HIDE_TOAST":
      return { ...state, toast: null };

    default:
      return state;
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  // Refs for things that need to survive across renders without causing re-renders
  const refs = useRef({
    abortController: null,
    generationRequestId: null,
    stopRequested: false,
    imageAbortController: null,
    imageGenerationRequestId: null,
    imageResetUi: null,
  });

  return (
    <StoreContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        <RefsContext.Provider value={refs.current}>
          {children}
        </RefsContext.Provider>
      </DispatchContext.Provider>
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}

export function useDispatch() {
  return useContext(DispatchContext);
}

export function useRefs() {
  return useContext(RefsContext);
}

export { profiles };
