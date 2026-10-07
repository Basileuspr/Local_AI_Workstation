import { lazy, Suspense, useEffect, useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { StoreProvider, useStore, useDispatch, useRefs } from "./useStore.jsx";
import * as api from "./api";
import { statusObserver } from "./appPolling";
import { mergeKnownModels, reconcileChatModel, modelInventoryKey } from "./modelCatalog";
import { pickPreferences, savePreferences } from "./preferences";
import { clearRefreshNavigation, rememberRefreshNavigation, saveNavigation, resolveActiveTab } from "./navigation";
import { ChatWorkspaceProvider, useChatWorkspace } from "./ChatWorkspace";
import { workspaceVisible } from "./chatPins";
import ChatSideContent from "./components/ChatSideContent";
import SecondChat from "./components/SecondChat";
import ChatActivityNotice from "./components/ChatActivityNotice";
import { DualChatProvider, ChatPaneProvider, useDualChat } from "./ChatPane";
import { chatModelChoice } from "./chatModelChoices";
import { recentTurnStart } from './contextMemory';

import { ImageGenerationProvider } from "./ImageGenerationContext";
import { AnalyzeIterateProvider } from "./AnalyzeIterateContext";
import { ImagePrivacyProvider } from "./ImagePrivacy";
import EmojiPicker from "./components/EmojiPicker";
import ImageReview from "./components/ImageReview";
import Sidebar from "./components/Sidebar";
import AppLayout from "./components/AppLayout";
import MediaManager from "./components/MediaManager";
import ImageManager from "./components/ImageManager";
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
import Dashboard from "./components/Dashboard";
import InfoCenter from "./components/InfoCenter";
import PromptQueue, { PromptQueueProvider } from "./components/PromptQueue";
import KnowledgeVault from "./components/KnowledgeVault";
import Tools, { MarkdownViewer } from "./components/Tools";
import ShortcutRegistry from "./components/ShortcutRegistry";
import CodeViewer from "./components/CodeViewer";
import ViewerBrowser from './components/ViewerBrowser';
const ModelViewer = lazy(() => import('./components/ModelViewer'));
const LocalFiles = lazy(() => import('./components/LocalFiles'));
const DocumentEditor = lazy(() => import('./components/DocumentEditor'));
const Slicer = lazy(() => import('./components/Slicer'));
const AppIntegrations = lazy(() => import('./components/AppIntegrations'));
const StylingLibrary = lazy(() => import('./components/StylingLibrary'));
const SoundMixer = lazy(() => import('./components/SoundMixer'));
import SpreadsheetViewer from "./components/SpreadsheetViewer";
import CanvasWorkspace from "./components/CanvasPaintWorkspace";
import FileConverter from "./components/FileConverter";
import FilePackager from "./components/FilePackager";
import HashAuditor from "./components/HashAuditor";
import FolderReview from "./components/FolderReview";
import { GifMakerWorkspace } from "./components/GifMaker";
import AudioWorkspace from "./components/AudioWorkspace";
import LearningUniversity from './components/LearningUniversity';
import NeuralNetworkVisualizer from './components/NeuralNetworkVisualizer';
import BreakRoom from './components/BreakRoom';
import CharacterCreator from './components/CharacterCreator';
import {CharacterWorkspaceProvider} from './CharacterWorkspace';
import { get as getWorkflow } from "./imageWorkflowApi";
import { useAppPopupDismissal } from './useDismissiblePopup';

function AppInner() {
  useAppPopupDismissal();
  const state = useStore();
  const chatWorkspace = useChatWorkspace();
  const chats = useDualChat();
  const chatState = useRef(chats); chatState.current = chats;
  const dualChat = chatWorkspace.pin?.kind === "chat";
  const [secondChatUsed, setSecondChatUsed] = useState(dualChat);
  useEffect(() => { if (dualChat) setSecondChatUsed(true); }, [dualChat]);
  useEffect(() => { if (!dualChat) chats.setFocused("primary"); }, [dualChat, chats.setFocused]);
  const latestState = useRef(state);
  latestState.current = state;
  const dispatch = useDispatch();
  const refs = useRefs();
  const sessionNavigation = useRef(0);
  const [startupNavigation] = useState(state.startupNavigation);
  useEffect(() => { clearRefreshNavigation(); }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [imageLibraryTarget, setImageLibraryTarget] = useState(null);
  const [queueDataset, setQueueDataset] = useState(null);
  const [viewerInputs,setViewerInputs] = useState({});
  function openBrowserSource(source) {
    if(!['html','css','js'].includes(source.kind))return;
    setViewerInputs(current=>({...current,[source.kind]:source}));
    dispatch({type:'SET_SIDEBAR_TAB',payload:`${source.kind}-viewer`});
  }
  useEffect(() => {
    saveNavigation(state.activeSidebarTab, state.currentSessionId);
  }, [state.activeSidebarTab, state.currentSessionId]);

  async function refreshCurrentView() {
    setRefreshing(true);
    saveNavigation(state.activeSidebarTab, state.currentSessionId);
    try {
      if (state.activeSidebarTab === "media-manager" && window.workstationDesktop?.refreshMediaManager) {
        const result = await window.workstationDesktop.refreshMediaManager();
        if (result?.error) throw new Error(result.error);
      }
      rememberRefreshNavigation(state.activeSidebarTab, state.currentSessionId);
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
    state.appearance,
    state.startupBehavior,
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
    state.modelOrder,
    state.knowledgeScopes,
    state.summaryModel,
    state.useKnowledgeBase,
    state.roleplay,
    state.imageSettings,
    state.voiceOutput,
    state.soundOutput,
    state.soundMixer,
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
    async function refreshStatus(status) {
      if (refreshingStatus || stopped) return;
      refreshingStatus = true;
      try {
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
        // Populate the sidebar without opening or creating a conversation.
        // A one-time explicit Refresh may reopen its selected session.
        const sessions = await api.listSessions();
        if (stopped) return;
        dispatch({ type: "SET_SESSIONS", payload: sessions });
        if (startupNavigation.sessionId && sessionNavigation.current === 0) {
          const savedSession = sessions.find(session => session.id === startupNavigation.sessionId);
          if (savedSession) await handleLoadSession(savedSession.id);
        }
    }

    const detach = statusObserver().subscribe({ data: status => { void refreshStatus(status); },
      error: error => { if (!stopped) {
        dispatch({ type: "SET_SERVICE_STATUS", payload: { backend: { ok: false }, ollama: { reachable: false, error: "backend_unreachable" } } });
        dispatch({ type: "SET_CONNECTED", payload: false });
        dispatch({ type: "SET_MODELS_ERROR", payload: error.message || "Local services are still loading." });
      } } });
    return () => { stopped = true; detach(); };
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
  const handleNewChat = useCallback(() => {
    ++sessionNavigation.current;
    refs.pendingChatCreation = null;
    dispatch({ type: "START_NEW_CHAT" });
  }, [dispatch, refs]);

  // Used only by explicit submissions that need a persistent session.
  const handleCreateChat = useCallback(async () => {
    const navigation = ++sessionNavigation.current;
    try {
      const session = await api.createSession();
      if (navigation !== sessionNavigation.current) return session;
      dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" });
      dispatch({
        type: "SET_SESSION",
        payload: {
          id: session.id, revision: session.revision,
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
        if (sessionId === chatState.current.secondary.sessionId) {
          chatWorkspace.setPin({ kind: "chat", sessionId });
          dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" });
          chats.setFocused("secondary");
          if (targetMessageId) await chats.controller.current?.load(sessionId, targetMessageId);
          return true;
        }
        const navigation = ++sessionNavigation.current;
        try {
          const session = await api.loadSession(sessionId);
          if (navigation !== sessionNavigation.current) return;
          if (sessionId === chatState.current.secondary.sessionId) {
            chatWorkspace.setPin({ kind: "chat", sessionId }); chats.setFocused("secondary"); return true;
          }
        dispatch({
          type: "SET_SESSION",
          payload: {
            id: session.id, revision: session.revision,
            messages: session.messages || [],
            title: session.title,
            memorySummary: session.memory_summary || "",
            summarizedMessageCount: session.summarized_message_count || 0,
            selectedModel: chatModelChoice(session.id, session.model, latestState.current.selectedModel, latestState.current.models),
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
    [dispatch, chatWorkspace.setPin, chats.setFocused]
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
    if (!state.currentSessionId || recentTurnStart(state.conversationHistory) <= state.summarizedMessageCount) {
      dispatch({ type: "SHOW_TOAST", payload: { message: "More chat history is needed before compaction", type: "" } });
      return;
    }

    const compactUntil = recentTurnStart(state.conversationHistory);
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
        exclusiveModel: dualChat,
      });
      const memorySummary = result.summary || state.memorySummary;
      const saved = await api.updateSessionMetadata(state.currentSessionId, {
        memorySummary,
        summarizedMessageCount: result.summary?.trim() ? compactUntil : state.summarizedMessageCount,
        expectedRevision: state.sessionRevision,
      });
      dispatch({ type: "SESSION_METADATA_SAVED", payload: saved, expectedRevision: state.sessionRevision });
      dispatch({ type: "SHOW_TOAST", payload: { message: "Conversation context compacted", type: "success" } });
    } catch (error) {
      dispatch({ type: "SHOW_TOAST", payload: { message: error.message || "Could not compact context", type: "error" } });
    }
  }, [dispatch, state]);

  // Keep chat mounted while dedicated workspaces occupy the main pane.
  const activeTab = resolveActiveTab(state.activeSidebarTab);
  const visible = tab => workspaceVisible(activeTab, chatWorkspace.pin, tab);
  const pinnedTab = dualChat ? "second-chat" : chatWorkspace.pin?.kind === "tool" ? chatWorkspace.pin.tab : chatWorkspace.pin ? "chat-attachment" : null;

  return (
    <ImageGenerationProvider onSessionSaved={handleSessionSaved}>
    <AnalyzeIterateProvider>
    <ImageDestinationsProvider>
    <CharacterWorkspaceProvider onNavigate={tab => dispatch({type:'SET_SIDEBAR_TAB',payload:tab})} onOpenDestination={openQueueDestination}>
      <AppLayout activeTab={state.activeSidebarTab} onRefresh={refreshCurrentView} refreshing={refreshing}
        pinnedTab={pinnedTab} pinnedTitle={chatWorkspace.title} onUnpin={() => chatWorkspace.setPin(null)} pinNotice={chatWorkspace.storageError}
        sidebar={closeNavigation => <Sidebar
        imagesActive={visible("images")}
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
          <div className="pane" data-capture-tab="media-manager" hidden={!visible("media-manager")}><MediaManager active={visible("media-manager")} /></div>
          <div className="pane" data-capture-tab="image-manager" hidden={!visible("image-manager")}><ImageManager active={visible("image-manager")} /></div>
          <div className="pane" data-capture-tab="knowledge" hidden={!visible("knowledge")}><KnowledgeVault active={visible("knowledge")} /></div>
          <div className="pane" data-capture-tab="tools" hidden={!visible("tools")}><Tools /></div>
          <div className="pane" data-capture-tab="shortcuts" hidden={!visible("shortcuts")}><ShortcutRegistry /></div>
          <div className="pane" data-capture-tab="markdown" hidden={!visible("markdown")}><MarkdownViewer /></div>
          <div className="pane" data-capture-tab="browser" hidden={!visible("browser")}><ViewerBrowser active={visible("browser")} onOpenSource={openBrowserSource}/></div>
          <div className="pane" data-capture-tab="3d-viewer" hidden={!visible("3d-viewer")}>{visible("3d-viewer") && <Suspense fallback={<p>Opening 3D Viewer & Editor…</p>}><ModelViewer /></Suspense>}</div>
          <div className="pane" data-capture-tab="local-files" hidden={!visible("local-files")}><Suspense fallback={<p>Opening Local Files…</p>}><LocalFiles active={visible("local-files")}/></Suspense></div>
          <div className="pane" data-capture-tab="document-editor" hidden={!visible("document-editor")}><Suspense fallback={<p>Opening Document Editor…</p>}><DocumentEditor active={visible("document-editor")}/></Suspense></div>
          <div className="pane" data-capture-tab="html-viewer" hidden={!visible("html-viewer")}><CodeViewer kind="html" incoming={viewerInputs.html}/></div>
          <div className="pane" data-capture-tab="css-viewer" hidden={!visible("css-viewer")}><CodeViewer kind="css" incoming={viewerInputs.css}/></div>
          <div className="pane" data-capture-tab="styling-library" hidden={!visible("styling-library")}><Suspense fallback={<p>Opening Styling Library…</p>}><StylingLibrary active={visible("styling-library")} onEdit={openBrowserSource}/></Suspense></div>
          <div className="pane" data-capture-tab="sound-mixer" hidden={!visible("sound-mixer")}><Suspense fallback={<p>Opening Sound Mixer…</p>}><SoundMixer active={visible("sound-mixer")}/></Suspense></div>
          <div className="pane" data-capture-tab="js-viewer" hidden={!visible("js-viewer")}><CodeViewer kind="js" incoming={viewerInputs.js}/></div>
          <div className="pane" data-capture-tab="spreadsheets" hidden={!visible("spreadsheets")}><SpreadsheetViewer /></div>
          <div className="pane" data-capture-tab="canvas" hidden={!visible("canvas")}><CanvasWorkspace /></div>
          <div className="pane" data-capture-tab="converter" hidden={!visible("converter")}><FileConverter /></div>
          <div className="pane" data-capture-tab="slicer" hidden={!visible("slicer")}><Suspense fallback={<p>Opening Slicer…</p>}><Slicer active={visible("slicer")}/></Suspense></div>
          <div className="pane" data-capture-tab="integrations" hidden={!visible("integrations")}><Suspense fallback={<p>Opening linked applications…</p>}><AppIntegrations active={visible("integrations")}/></Suspense></div>
          <div className="pane" data-capture-tab="packager" hidden={!visible("packager")}><FilePackager /></div>
          <div className="pane" data-capture-tab="hash-auditor" hidden={!visible("hash-auditor")}><HashAuditor active={visible("hash-auditor")} /></div>
          <div className="pane" data-capture-tab="folder-review" hidden={!visible("folder-review")}><FolderReview active={visible("folder-review")} models={state.models} defaultModel={state.summaryModel || state.selectedModel} /></div>
          <div className="pane" data-capture-tab="gif-maker" hidden={!visible("gif-maker")}><GifMakerWorkspace active={visible("gif-maker")}/></div>
          <div className="pane" data-capture-tab="audio" hidden={!visible("audio")}><AudioWorkspace active={visible("audio")}/></div>
          <div className="pane" data-capture-tab="university" hidden={!visible("university")}><LearningUniversity course="university" onOpenWorkspace={tab => dispatch({type:'SET_SIDEBAR_TAB',payload:tab})} /></div>
          <div className="pane" data-capture-tab="agent-university" hidden={!visible("agent-university")}><LearningUniversity course="agent-university" onOpenWorkspace={tab => dispatch({type:'SET_SIDEBAR_TAB',payload:tab})} /></div>
          <div className="pane" data-capture-tab="neural-network" hidden={!visible("neural-network")}><NeuralNetworkVisualizer /></div>
          <div className="pane" data-capture-tab="break-room" hidden={!visible("break-room")}><BreakRoom active={visible("break-room")} /></div>
          <div className="pane" data-capture-tab="image-editor" hidden={!visible("image-editor")}><ImageEditor /></div>
          <div className="pane image-library-pane" data-capture-tab="images" hidden={!visible("images")} ref={setImageLibraryTarget} />
          <div className="pane" data-capture-tab="review" hidden={!visible("review")}><ImageReview active={visible("review")} onOpenSource={handleLoadSession} /></div>
          <div className="pane" data-capture-tab="queue" hidden={!visible("queue")}>
            <PromptQueue onOpenDestination={openQueueDestination} />
          </div>
          <div className="pane" data-capture-tab="info-center" hidden={!visible("info-center")}>
            <InfoCenter onOpenWorkspace={tab => dispatch({ type: 'SET_SIDEBAR_TAB', payload: tab })} />
          </div>
          <div className="pane" data-capture-tab="dashboard" hidden={!visible("dashboard")}>
            <Dashboard active={visible("dashboard")} />
          </div>
          <div className="pane chat-pane" data-capture-tab="chats" hidden={!visible("chats")}>
            <ChatPaneProvider id="primary" dual={dualChat}>
            {dualChat && <div className="primary-chat-heading"><strong>Chat A · Main conversation</strong><small>Separate history · shared request queue</small></div>}
            <Header
              onSessionRenamed={handleSessionRenamed}
              onCompactMemory={handleCompactMemory}
            />
            <SettingsPanel />
            <MessageList
              onNewChat={handleCreateChat}
              onSessionSaved={handleSessionSaved}
            />
            <InputBar
              active={visible("chats")}
              onNewChat={handleCreateChat}
              onSessionSaved={handleSessionSaved}
              onOpenSession={handleLoadSession}
            />
            </ChatPaneProvider>
          </div>
          <div className="pane second-chat-pane" data-capture-tab="second-chat" hidden={activeTab !== "chats" || !dualChat}>
            {(dualChat || secondChatUsed) && <SecondChat active={activeTab === "chats" && dualChat} dual={dualChat} primarySessionId={state.currentSessionId}
              targetSessionId={dualChat ? chatWorkspace.pin.sessionId : null}
              onSelection={sessionId => { if (dualChat) chatWorkspace.setPin({ kind: "chat", sessionId }); }}
              onSessionSaved={handleSessionSaved} />}
          </div>

          <div className="pane" data-capture-tab="library" hidden={!visible("library")}>
            <PromptIndex active={visible("library")} />
          </div>

          <div className="pane" data-capture-tab="generate" hidden={!visible("generate")}>
            <ImageStudio
              active={visible("generate")}
              onNewChat={handleNewChat}
              onSessionSaved={handleSessionSaved}
            />
          </div>

          <div className="pane" data-capture-tab="lora" hidden={!visible("lora")}>
            <LoraStudio active={visible("lora")} />
          </div>

          <div className="pane" data-capture-tab="workflows" hidden={!visible("workflows")}>
            <ImageWorkflows active={visible("workflows")} />
          </div>

          <div className="pane" data-capture-tab="faces" hidden={!visible("faces")}>
            <FaceStudio active={visible("faces")} />
          </div>
          <div className="pane" data-capture-tab="characters" hidden={!visible("characters")}><CharacterCreator active={visible("characters")}/></div>
          <div className="pane" data-capture-tab="character-parts" hidden={!visible("character-parts")}>
            <CharacterStudio active={visible("character-parts")} openDataset={queueDataset} />
          </div>
          <div className="pane" data-capture-tab="chat-attachment" hidden={activeTab !== "chats" || !chatWorkspace.pin || ["tool", "chat"].includes(chatWorkspace.pin.kind)}>
            <ChatSideContent active={activeTab === "chats"} />
          </div>
      </AppLayout>
      <ChatActivityNotice />
        <Toast />
        <EmojiPicker />
    </CharacterWorkspaceProvider>
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
        <PromptQueueProvider><ImagePrivacyProvider><ChatWorkspaceProvider><DualChatProvider><AppInner /></DualChatProvider></ChatWorkspaceProvider></ImagePrivacyProvider></PromptQueueProvider>
    </StoreProvider>
  );
}
