import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useDispatch, useStore } from "../../src/useStore";
import { DualChatProvider, ChatPaneProvider, useDualChat } from "../../src/ChatPane";
import { ChatWorkspaceProvider, useChatWorkspace } from "../../src/ChatWorkspace";
import { ImageGenerationProvider } from "../../src/ImageGenerationContext";
import { ImageDestinationsProvider } from "../../src/ImageDestinations";
import AppLayout from "../../src/components/AppLayout";
import SecondChat from "../../src/components/SecondChat";
import Sidebar from "../../src/components/Sidebar";
import Header from "../../src/components/Header";
import SettingsPanel from "../../src/components/SettingsPanel";
import MessageList from "../../src/components/MessageList";
import InputBar from "../../src/components/InputBar";
import ChatActivityNotice from "../../src/components/ChatActivityNotice";
import { PromptQueueProvider } from "../../src/components/PromptQueue";
import { chatSubmissionQueue } from "../../src/chatSubmissionQueue";
import { chatModelChoice } from "../../src/chatModelChoices";
import * as api from "../../src/api";
import "../../src/styles.css";

localStorage.setItem("local-ai-workstation-preferences-v1", JSON.stringify({ selectedModel: "alpha:latest", roleplay: { useDurableMemory: false } }));
function Fixture() {
  const state = useStore(), dispatch = useDispatch(), chats = useDualChat(), workspace = useChatWorkspace();
  const latest = useRef(state); latest.current = state;
  const dual = workspace.pin?.kind === "chat", active = state.activeSidebarTab === "chats";
  useEffect(() => { if (!dual) chats.setFocused("primary"); }, [dual]);
  async function refresh() { dispatch({ type: "SET_SESSIONS", payload: await api.listSessions() }); }
  async function load(id) {
    if (id === chats.secondary.sessionId) { workspace.setPin({ kind: "chat", sessionId: id }); chats.setFocused("secondary"); return; }
    const saved = await api.loadSession(id);
    dispatch({ type: "SET_SESSION", payload: { id, messages: saved.messages, revision: saved.revision, title: saved.title,
      selectedModel: chatModelChoice(id, saved.model, latest.current.selectedModel, latest.current.models) } });
  }
  useEffect(() => {
    dispatch({ type: "SET_CONNECTED", payload: true });
    dispatch({ type: "SET_SERVICE_STATUS", payload: { backend: { ok: true }, ollama: { reachable: true },
      models: { chat_count: 2, embedding_ready: true }, knowledge_base: { ok: true } } });
    dispatch({ type: "SET_MODELS", payload: [{ name: "alpha:latest", contextLength: 32768 }, { name: "beta:latest", contextLength: 32768 }] });
    void load(new URLSearchParams(location.search).get("chat")); void refresh();
  }, []);
  window.dualChatQA = { state, chats, workspace, queue: chatSubmissionQueue, load, dispatch };
  return <ImageGenerationProvider onSessionSaved={refresh}><ImageDestinationsProvider>
    <AppLayout activeTab={state.activeSidebarTab} pinnedTab={dual ? "second-chat" : null} pinnedTitle={workspace.title}
      onUnpin={() => workspace.setPin(null)} sidebar={() => <Sidebar onLoadSession={load} onNewChat={() => dispatch({ type: "START_NEW_CHAT" })} />}>
      <div className="pane chat-pane" data-capture-tab="chats" hidden={!active}>
        <ChatPaneProvider id="primary" dual={dual}>
          {dual && <div className="primary-chat-heading"><strong>Chat A · Main conversation</strong></div>}
          <Header onSessionRenamed={refresh} /><SettingsPanel /><MessageList onSessionSaved={refresh} />
          <InputBar active={active} onSessionSaved={refresh} onOpenSession={load} />
        </ChatPaneProvider>
      </div>
      <div className="pane second-chat-pane" data-capture-tab="second-chat" hidden={!active || !dual}>
        <SecondChat active={active && dual} dual={dual} primarySessionId={state.currentSessionId}
          targetSessionId={dual ? workspace.pin.sessionId : null} onSelection={sessionId => { if (dual) workspace.setPin({ kind: "chat", sessionId }); }}
          onSessionSaved={refresh} />
      </div>
      <div className="pane" data-capture-tab="tools" hidden={state.activeSidebarTab !== "tools"}>Different workspace</div>
    </AppLayout><ChatActivityNotice />
  </ImageDestinationsProvider></ImageGenerationProvider>;
}
createRoot(document.getElementById("root")).render(<StoreProvider><PromptQueueProvider><ChatWorkspaceProvider><DualChatProvider><Fixture /></DualChatProvider></ChatWorkspaceProvider></PromptQueueProvider></StoreProvider>);
