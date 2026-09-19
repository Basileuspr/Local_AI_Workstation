import { useEffect, useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { StoreProvider, useStore, useDispatch } from "./useStore.jsx";
import * as api from "./api";
import { mergeKnownModels, pickDefaultModel } from "./modelCatalog";
import { pickPreferences, savePreferences } from "./preferences";

import { ImageGenerationProvider } from "./ImageGenerationContext";
import { ImagePrivacyProvider } from "./ImagePrivacy";
import EmojiPicker from "./components/EmojiPicker";
import ImageReview from "./components/ImageReview";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import SettingsPanel from "./components/SettingsPanel";
import MessageList from "./components/MessageList";
import InputBar from "./components/InputBar";
import PromptIndex from "./components/PromptIndex";
import ImageStudio from "./components/ImageStudio";
import LoraStudio from "./components/LoraStudio";
import ImageWorkflows from "./components/ImageWorkflows";
import FaceStudio from "./components/FaceStudio";
import Toast from "./components/Toast";
import WebAccess from "./components/WebAccess";
import Dashboard from "./components/Dashboard";
import PromptQueue, { PromptQueueProvider } from "./components/PromptQueue";

function AppInner() {
  const state = useStore();
  const dispatch = useDispatch();
  const sessionNavigation = useRef(0);
  useEffect(() => {
    const notice = localStorage.getItem("app-reset-notice");
    if (notice) {
      dispatch({ type: "SET_SIDEBAR_TAB", payload: "dashboard" });
    }
  }, [dispatch]);
  useEffect(() => {
    const refreshImages = () => { void api.listSessionImages().then(images => dispatch({ type: "SET_SESSION_IMAGES", payload: images })).catch(() => {}); };
    const storage = event => { if (event.key === "image-library-revision") refreshImages(); };
    window.addEventListener("image-library-changed", refreshImages); window.addEventListener("storage", storage);
    return () => { window.removeEventListener("image-library-changed", refreshImages); window.removeEventListener("storage", storage); };
  }, [dispatch]);

  useEffect(() => {
    savePreferences(pickPreferences(state));
  }, [
    state.activeProfile,
    state.temperature,
    state.topP,
    state.topK,
    state.repeatPenalty,
    state.numPredict,
    state.responseLength,
    state.systemPrompt,
    state.responseStyle,
    state.selectedModel,
    state.summaryModel,
    state.useKnowledgeBase,
    state.roleplay,
    state.imageSettings,
    state.customProfiles,
    state.activeCustomProfileId,
    state.activeLoraProjectId,
  ]);

  // --- Initialize on mount ---
  useEffect(() => {
    // One probe reports the backend and everything it depends on, so a
    // dependency problem can be named instead of showing "almost ready".
    async function refreshStatus() {
      const status = await api.fetchStatus();
      dispatch({ type: "SET_SERVICE_STATUS", payload: status });
      dispatch({ type: "SET_CONNECTED", payload: Boolean(status?.backend?.ok) });
      return status;
    }

    async function init() {
      const status = await refreshStatus();

      if (status?.backend?.ok) {
        const { models: rawModels, error } = await api.loadModels();
        const models = mergeKnownModels(rawModels);
        dispatch({ type: "SET_MODELS", payload: models });
        dispatch({ type: "SET_MODELS_ERROR", payload: error });

        if (models.length > 0) {
          const savedModel = models.find((m) => m.name === state.selectedModel);
          dispatch({
            type: "SET_SELECTED_MODEL",
            payload: savedModel ? savedModel.name : pickDefaultModel(models),
          });
        }

        // Restore the most recent chat. A new session is created only when the
        // user explicitly chooses New Chat or sends/attaches content with none open.
        const sessions = await api.listSessions();
        dispatch({ type: "SET_SESSIONS", payload: sessions });
        if (sessions.length > 0 && sessionNavigation.current === 0) {
          await handleLoadSession(sessions[0].id);
        }
      }
    }

    init();

    const interval = setInterval(refreshStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // --- Sidebar refresh ---
  async function refreshSidebar() {
    try {
      if (state.activeSidebarTab === "chats") {
        const sessions = await api.listSessions();
        dispatch({ type: "SET_SESSIONS", payload: sessions });
      } else if (state.activeSidebarTab === "images") {
        const images = await api.listSessionImages();
        dispatch({ type: "SET_SESSION_IMAGES", payload: images });
      } else if (state.activeSidebarTab === "knowledge") {
        const docs = await api.listKnowledgeBase();
        dispatch({ type: "SET_KB_DOCUMENTS", payload: docs });
      }
    } catch (err) {
      console.error("Failed to refresh sidebar:", err);
    }
  }

  // Refresh sidebar when tab changes
  useEffect(() => {
    refreshSidebar();
  }, [state.activeSidebarTab]);

  // --- Session actions ---
  const handleNewChat = useCallback(async () => {
    const navigation = ++sessionNavigation.current;
    try {
      const session = await api.createSession();
      if (navigation !== sessionNavigation.current) return session;
      dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" });
      dispatch({
        type: "SET_SESSION",
        payload: {
          id: session.id,
          messages: [],
          title: "New Chat",
          memorySummary: session.memory_summary || "",
          summarizedMessageCount: session.summarized_message_count || 0,
        },
      });
      const sessions = await api.listSessions();
      dispatch({ type: "SET_SESSIONS", payload: sessions });
      return session;
    } catch (err) {
      console.error("Failed to create session:", err);
      return null;
    }
  }, [dispatch]);

  const handleLoadSession = useCallback(
      async (sessionId, targetMessageId = "") => {
        const navigation = ++sessionNavigation.current;
        try {
          const session = await api.loadSession(sessionId);
          if (navigation !== sessionNavigation.current) return;
        dispatch({
          type: "SET_SESSION",
          payload: {
            id: session.id,
            messages: session.messages || [],
            title: session.title,
            memorySummary: session.memory_summary || "",
            summarizedMessageCount: session.summarized_message_count || 0,
          },
        });
        const sessions = await api.listSessions();
        dispatch({ type: "SET_SESSIONS", payload: sessions });
          if (targetMessageId && navigation === sessionNavigation.current) {
          dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" });
          dispatch({ type: "SET_SCROLL_TARGET", payload: targetMessageId });
        }
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    },
    [dispatch]
  );

  const handleSessionSaved = useCallback(async () => {
    const sessions = await api.listSessions();
    dispatch({ type: "SET_SESSIONS", payload: sessions });
    if (state.activeSidebarTab === "images") {
      const images = await api.listSessionImages();
      dispatch({ type: "SET_SESSION_IMAGES", payload: images });
    }
  }, [dispatch, state.activeSidebarTab]);

  const handleSessionRenamed = useCallback(async () => {
    const sessions = await api.listSessions();
    dispatch({ type: "SET_SESSIONS", payload: sessions });
  }, [dispatch]);

  const handleCompactMemory = useCallback(async () => {
    if (!state.currentSessionId || state.conversationHistory.length <= 4) {
      dispatch({ type: "SHOW_TOAST", payload: { message: "More chat history is needed before compaction", type: "" } });
      return;
    }

    const compactUntil = state.conversationHistory.length - 4;
    const messages = state.conversationHistory.slice(state.summarizedMessageCount, compactUntil);
    if (messages.length === 0) {
      dispatch({ type: "SHOW_TOAST", payload: { message: "Recent context is already retained", type: "" } });
      return;
    }

    try {
      const result = await api.compactMemory({
        model: state.summaryModel || state.selectedModel,
        previousSummary: state.memorySummary,
        messages,
        targetTokens: 700,
      });
      const memorySummary = result.summary || state.memorySummary;
      dispatch({
        type: "SET_MEMORY",
        payload: { memorySummary, summarizedMessageCount: compactUntil },
      });
      await api.saveSession(state.currentSessionId, state.conversationHistory, state.selectedModel, {
        memorySummary,
        summarizedMessageCount: compactUntil,
      });
      dispatch({ type: "SHOW_TOAST", payload: { message: "Conversation context compacted", type: "success" } });
    } catch (error) {
      dispatch({ type: "SHOW_TOAST", payload: { message: error.message || "Could not compact context", type: "error" } });
    }
  }, [dispatch, state]);

  // Chats, images, and knowledge all share the chat pane; only the library and
  // generate tabs replace it.
  const activeTab =
    state.activeSidebarTab === "review" || state.activeSidebarTab === "library" || state.activeSidebarTab === "generate" || state.activeSidebarTab === "lora" || state.activeSidebarTab === "workflows" || state.activeSidebarTab === "dashboard" || state.activeSidebarTab === "queue" || state.activeSidebarTab === "faces"
      ? state.activeSidebarTab
      : "chat";

  return (
    <ImageGenerationProvider onSessionSaved={handleSessionSaved}>
      <div id="app">
        <Sidebar
          onNewChat={handleNewChat}
          onLoadSession={handleLoadSession}
        />
        {/*
          Every pane stays mounted and is hidden with CSS rather than being
          swapped out. Switching tabs used to unmount the whole chat pane, and
          the message box is uncontrolled, so a half-typed message existed only
          in the DOM and died with the component. The same applied to the image
          studio's result and the transcript's scroll position.
        */}
          <div id="main">
            <div className="pane" hidden={activeTab !== "review"}><ImageReview active={activeTab === "review"} onOpenSource={handleLoadSession} /></div>
          <div className="pane" hidden={activeTab !== "queue"}>
            <PromptQueue />
          </div>
          <div className="pane" hidden={activeTab !== "dashboard"}>
            <Dashboard />
          </div>
          <div className="pane" hidden={activeTab !== "chat"}>
            <Header
              onSessionRenamed={handleSessionRenamed}
              onCompactMemory={handleCompactMemory}
            />
            <SettingsPanel />
            <MessageList
              onNewChat={handleNewChat}
              onSessionSaved={handleSessionSaved}
            />
            <WebAccess onOpenSession={handleLoadSession} />
            <InputBar
              active={activeTab === "chat"}
              onNewChat={handleNewChat}
              onSessionSaved={handleSessionSaved}
            />
          </div>

          <div className="pane" hidden={activeTab !== "library"}>
            <PromptIndex active={activeTab === "library"} />
          </div>

          <div className="pane" hidden={activeTab !== "generate"}>
            <ImageStudio
              active={activeTab === "generate"}
              onNewChat={handleNewChat}
              onSessionSaved={handleSessionSaved}
            />
          </div>

          <div className="pane" hidden={activeTab !== "lora"}>
            <LoraStudio active={activeTab === "lora"} />
          </div>

          <div className="pane" hidden={activeTab !== "workflows"}>
            <ImageWorkflows active={activeTab === "workflows"} />
          </div>

          <div className="pane" hidden={activeTab !== "faces"}>
            <FaceStudio active={activeTab === "faces"} />
          </div>
        </div>
      </div>
        <Toast />
        <EmojiPicker />
    </ImageGenerationProvider>
  );
}

export default function App() {
  const [reset, setReset] = useState(false);
  const [resetError, setResetError] = useState("");
  useEffect(() => {
    const cleared = () => flushSync(() => setReset(true));
    window.addEventListener("app-data-reset", cleared);
    const unsubscribe = window.workstationDesktop?.onResetResult?.(result => {
      if (result.ok) window.location.reload();
      else setResetError(result.error || "The backend could not restart.");
    });
    return () => { window.removeEventListener("app-data-reset", cleared); unsubscribe?.(); };
  }, []);
  if (reset) return <section className="dashboard"><h1>App data cleared</h1><p className="dashboard-note">User-created buttons are preserved. Reopening the app…</p>{resetError && <><p role="alert">{resetError}</p><button onClick={() => window.location.reload()}>Return to Dashboard</button></>}</section>;
  return (
    <StoreProvider>
        <PromptQueueProvider><ImagePrivacyProvider><AppInner /></ImagePrivacyProvider></PromptQueueProvider>
    </StoreProvider>
  );
}
