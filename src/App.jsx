import { useEffect, useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { StoreProvider, useStore, useDispatch } from "./useStore.jsx";
import * as api from "./api";
import { mergeKnownModels, reconcileChatModel, modelInventoryKey } from "./modelCatalog";
import { pickPreferences, savePreferences } from "./preferences";
import { loadNavigation, saveNavigation } from "./navigation";

import { ImageGenerationProvider } from "./ImageGenerationContext";
import { AnalyzeIterateProvider } from "./AnalyzeIterateContext";
import { ImagePrivacyProvider } from "./ImagePrivacy";
import EmojiPicker from "./components/EmojiPicker";
import ImageReview from "./components/ImageReview";
import Sidebar from "./components/Sidebar";
import AppLayout from "./components/AppLayout";
import MediaManager from "./components/MediaManager";
import ImageEditor from "./components/ImageEditor";
import { ImageDestinationsProvider } from "./ImageDestinations";
import Header from "./components/Header";
import SettingsPanel from "./components/SettingsPanel";
import MessageList from "./components/MessageList";
import InputBar from "./components/InputBar";
import PromptIndex from "./components/PromptIndex";
import ImageStudio from "./components/ImageStudio";
import LoraStudio from "./components/LoraStudio";
import ImageWorkflows from "./components/ImageWorkflows";
import FaceStudio from "./components/FaceStudio";
import CharacterStudio from "./components/CharacterStudio";
import Toast from "./components/Toast";
import WebAccess from "./components/WebAccess";
import Dashboard from "./components/Dashboard";
import PromptQueue, { PromptQueueProvider } from "./components/PromptQueue";
import KnowledgeVault from "./components/KnowledgeVault";
import Tools from "./components/Tools";
import { get as getWorkflow } from "./imageWorkflowApi";

function AppInner() {
  const state = useStore();
  const latestState = useRef(state);
  latestState.current = state;
  const dispatch = useDispatch();
  const sessionNavigation = useRef(0);
  const [startupNavigation] = useState(loadNavigation);
  const [refreshing, setRefreshing] = useState(false);
  const [imageLibraryTarget, setImageLibraryTarget] = useState(null);
  const [queueDataset, setQueueDataset] = useState(null);
  useEffect(() => {
    saveNavigation(state.activeSidebarTab, state.currentSessionId || startupNavigation.sessionId);
  }, [state.activeSidebarTab, state.currentSessionId, startupNavigation]);

  async function refreshCurrentView() {
    setRefreshing(true);
    saveNavigation(state.activeSidebarTab, state.currentSessionId || startupNavigation.sessionId);
    try {
      if (state.activeSidebarTab === "media-manager" && window.workstationDesktop?.refreshMediaManager) {
        const result = await window.workstationDesktop.refreshMediaManager();
        if (result?.error) throw new Error(result.error);
      }
      window.location.reload();
    } catch (error) {
      setRefreshing(false);
      dispatch({ type: "SHOW_TOAST", payload: { message: error.message || "Could not refresh this view", type: "error" } });
    }
  }
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
    let stopped = false;
    let refreshingStatus = false;
    let initialized = false;
    let catalogKey = null;
    async function refreshStatus() {
      if (refreshingStatus || stopped) return;
      refreshingStatus = true;
      try {
        const status = await api.fetchStatus();
        if (stopped) return;
        dispatch({ type: "SET_SERVICE_STATUS", payload: status });
        dispatch({ type: "SET_CONNECTED", payload: Boolean(status?.backend?.ok) });
        if (status?.backend?.ok) {
          if (!initialized) {
            await init();
            initialized = true;
          }
          const nextKey = modelInventoryKey(status);
          if (!status.ollama?.reachable) catalogKey = null;
          else if (catalogKey !== nextKey && !latestState.current.isGenerating) {
            if (await refreshModels(status)) catalogKey = nextKey;
          }
        } else catalogKey = null;
      } catch (error) {
        if (!stopped) dispatch({ type: "SET_MODELS_ERROR", payload: error.message || "Local services are still loading." });
      } finally { refreshingStatus = false; }
    }

    async function refreshModels(status) {
        const { models: rawModels, error } = await api.loadModels();
        if (stopped) return;
        if (error) {
          dispatch({ type: "SET_MODELS_ERROR", payload: error });
          return false;
        }
        const models = mergeKnownModels(rawModels);
        dispatch({ type: "SET_MODELS", payload: models });
        dispatch({ type: "SET_MODELS_ERROR", payload: error });

        if (models.length > 0 && !latestState.current.isGenerating) {
          dispatch({
            type: "SET_SELECTED_MODEL",
            payload: reconcileChatModel(models, latestState.current.selectedModel, {
              preferSmall: status.capabilities?.prefer_small_chat_model === true,
            }),
          });
        }
        return true;
    }

    async function init() {
        // Restore the selected chat without changing the active workspace. A new session is created only when the
        // user explicitly chooses New Chat or sends/attaches content with none open.
        const sessions = await api.listSessions();
        if (stopped) return;
        dispatch({ type: "SET_SESSIONS", payload: sessions });
        if (sessions.length > 0 && sessionNavigation.current === 0) {
          const savedSession = sessions.find(session => session.id === startupNavigation.sessionId);
          await handleLoadSession((savedSession || sessions[0]).id);
        }
    }

    void refreshStatus();

    const interval = setInterval(refreshStatus, 5000);
    return () => { stopped = true; clearInterval(interval); };
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
        return false;
      }
      return true;
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

  async function openQueueDestination(destination) {
    if (destination.sessionId && destination.sessionId !== state.currentSessionId) {
      if (!await handleLoadSession(destination.sessionId)) throw new Error("The source chat could not be opened. It may have been removed.");
    }
    if (destination.workflowId) {
      const workflow = await getWorkflow(destination.workflowId);
      dispatch({ type: workflow.mode === "scene" ? "OPEN_ITERATIVE_SCENE" : "OPEN_IMAGE_WORKFLOW", payload: destination.workflowId });
      return;
    }
    if (destination.projectId) dispatch({ type: "SET_ACTIVE_LORA_PROJECT", payload: destination.projectId });
    if (destination.datasetId) setQueueDataset({ id: destination.datasetId, request: Date.now() });
    dispatch({ type: "SET_SIDEBAR_TAB", payload: destination.tab });
  }

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
        sessionId: state.currentSessionId,
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

  // Keep chat mounted while dedicated workspaces occupy the main pane.
  const activeTab =
    state.activeSidebarTab === "tools" ||
    state.activeSidebarTab === "knowledge" || state.activeSidebarTab === "image-editor" || state.activeSidebarTab === "media-manager" || state.activeSidebarTab === "images" || state.activeSidebarTab === "review" || state.activeSidebarTab === "library" || state.activeSidebarTab === "generate" || state.activeSidebarTab === "lora" || state.activeSidebarTab === "workflows" || state.activeSidebarTab === "dashboard" || state.activeSidebarTab === "queue" || state.activeSidebarTab === "faces" || state.activeSidebarTab === "character-parts"
      ? state.activeSidebarTab
      : "chat";

  return (
    <ImageGenerationProvider onSessionSaved={handleSessionSaved}>
    <AnalyzeIterateProvider>
    <ImageDestinationsProvider>
      <AppLayout activeTab={state.activeSidebarTab} onRefresh={refreshCurrentView} refreshing={refreshing} sidebar={closeNavigation => <Sidebar
        imageLibraryTarget={imageLibraryTarget}
        onNavigate={closeNavigation}
        onNewChat={() => { closeNavigation(); return handleNewChat(); }}
        onLoadSession={(...args) => { closeNavigation(); return handleLoadSession(...args); }}
      />}>
        {/*
          Every pane stays mounted and is hidden with CSS rather than being
          swapped out. Switching tabs used to unmount the whole chat pane, and
          the message box is uncontrolled, so a half-typed message existed only
          in the DOM and died with the component. The same applied to the image
          studio's result and the transcript's scroll position.
        */}
          <div className="pane" data-capture-tab="media-manager" hidden={activeTab !== "media-manager"}><MediaManager active={activeTab === "media-manager"} /></div>
          <div className="pane" data-capture-tab="knowledge" hidden={activeTab !== "knowledge"}><KnowledgeVault active={activeTab === "knowledge"} /></div>
          <div className="pane" data-capture-tab="tools" hidden={activeTab !== "tools"}><Tools /></div>
          <div className="pane" data-capture-tab="image-editor" hidden={activeTab !== "image-editor"}><ImageEditor /></div>
          <div className="pane image-library-pane" data-capture-tab="images" hidden={activeTab !== "images"} ref={setImageLibraryTarget} />
          <div className="pane" data-capture-tab="review" hidden={activeTab !== "review"}><ImageReview active={activeTab === "review"} onOpenSource={handleLoadSession} /></div>
          <div className="pane" data-capture-tab="queue" hidden={activeTab !== "queue"}>
            <PromptQueue onOpenDestination={openQueueDestination} />
          </div>
          <div className="pane" data-capture-tab="dashboard" hidden={activeTab !== "dashboard"}>
            <Dashboard />
          </div>
          <div className="pane chat-pane" data-capture-tab="chats" hidden={activeTab !== "chat"}>
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

          <div className="pane" data-capture-tab="library" hidden={activeTab !== "library"}>
            <PromptIndex active={activeTab === "library"} />
          </div>

          <div className="pane" data-capture-tab="generate" hidden={activeTab !== "generate"}>
            <ImageStudio
              active={activeTab === "generate"}
              onNewChat={handleNewChat}
              onSessionSaved={handleSessionSaved}
            />
          </div>

          <div className="pane" data-capture-tab="lora" hidden={activeTab !== "lora"}>
            <LoraStudio active={activeTab === "lora"} />
          </div>

          <div className="pane" data-capture-tab="workflows" hidden={activeTab !== "workflows"}>
            <ImageWorkflows active={activeTab === "workflows"} />
          </div>

          <div className="pane" data-capture-tab="faces" hidden={activeTab !== "faces"}>
            <FaceStudio active={activeTab === "faces"} />
          </div>
          <div className="pane" data-capture-tab="character-parts" hidden={activeTab !== "character-parts"}>
            <CharacterStudio active={activeTab === "character-parts"} openDataset={queueDataset} />
          </div>
      </AppLayout>
        <Toast />
        <EmojiPicker />
    </ImageDestinationsProvider>
    </AnalyzeIterateProvider>
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
  if (reset) return <section className="dashboard"><h1>Updating app data</h1><p className="dashboard-note">Applying desktop settings and reopening the app…</p>{resetError && <><p role="alert">{resetError}</p><button onClick={() => { localStorage.setItem("app-reset-notice", resetError); window.location.reload(); }}>Return to Dashboard</button></>}</section>;
  return (
    <StoreProvider>
        <PromptQueueProvider><ImagePrivacyProvider><AppInner /></ImagePrivacyProvider></PromptQueueProvider>
    </StoreProvider>
  );
}
