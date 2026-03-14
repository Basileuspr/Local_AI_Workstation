import { createContext, useContext, useReducer, useRef, useCallback } from "react";

const StoreContext = createContext(null);
const DispatchContext = createContext(null);
const RefsContext = createContext(null);

const initialState = {
  // Connection
  connected: false,

  // Models
  models: [],
  selectedModel: "",

  // Session
  currentSessionId: null,
  conversationHistory: [],
  sessionTitle: "New Chat",

  // Sidebar
  activeSidebarTab: "chats",
  sessions: [],
  kbDocuments: [],

  // Generation
  isGenerating: false,

  // Knowledge Base
  useKnowledgeBase: false,

  // Settings
  settingsOpen: false,
  slidersOpen: false,
  activeProfile: "balanced",
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  numPredict: 2048,
  responseLength: 2048,
  systemPrompt: "",

  // Toast
  toast: null, // { message, type }
};

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

function reducer(state, action) {
  switch (action.type) {
    case "SET_CONNECTED":
      return { ...state, connected: action.payload };

    case "SET_MODELS":
      return { ...state, models: action.payload };

    case "SET_SELECTED_MODEL":
      return { ...state, selectedModel: action.payload };

    case "SET_SESSION": {
      const { id, messages, title } = action.payload;
      return {
        ...state,
        currentSessionId: id,
        conversationHistory: messages,
        sessionTitle: title,
      };
    }

    case "SET_SESSION_TITLE":
      return { ...state, sessionTitle: action.payload };

    case "PUSH_MESSAGE":
      return {
        ...state,
        conversationHistory: [...state.conversationHistory, action.payload],
      };

    case "SET_SIDEBAR_TAB":
      return { ...state, activeSidebarTab: action.payload };

    case "SET_SESSIONS":
      return { ...state, sessions: action.payload };

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
      return { ...state, [action.key]: action.value };

    case "SET_RESPONSE_LENGTH": {
      const val = action.payload;
      return { ...state, responseLength: val, numPredict: val > 0 ? val : state.numPredict };
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
  const [state, dispatch] = useReducer(reducer, initialState);
  // Refs for things that need to survive across renders without causing re-renders
  const refs = useRef({
    abortController: null,
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