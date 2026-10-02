import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useDispatch, useStore } from "../../src/useStore";
import MessageList from "../../src/components/MessageList";
import AppLayout from "../../src/components/AppLayout";
import InputBar from "../../src/components/InputBar";
import { MarkdownViewer } from "../../src/components/Tools";
import CanvasWorkspace from "../../src/components/CanvasWorkspace";
import CodeViewer from "../../src/components/CodeViewer";
import ChatSideContent from "../../src/components/ChatSideContent";
import { ChatWorkspaceProvider, useChatWorkspace } from "../../src/ChatWorkspace";
import { workspaceVisible } from "../../src/chatPins";
import { ImageGenerationProvider } from "../../src/ImageGenerationContext";
import * as api from "../../src/api";
import "../../src/styles.css";

// Used only by qa-chat-checklists.cjs with temporary session files.
function Fixture() {
  const dispatch = useDispatch(), state = useStore();
  const workspace = useChatWorkspace();
  async function load(id) {
    const saved = await api.loadSession(id);
    dispatch({ type: "SET_SESSION", payload: { id: saved.id, messages: saved.messages, revision: saved.revision,
      title: saved.title, memorySummary: saved.memory_summary, summarizedMessageCount: saved.summarized_message_count } });
  }
  useEffect(() => { void load(new URLSearchParams(location.search).get("chat")); }, []);
  window.checklistQA = { load, dispatch, state, workspace };
  const visible = tab => workspaceVisible(state.activeSidebarTab, workspace.pin, tab);
  const pinnedTab = workspace.pin?.kind === "tool" ? workspace.pin.tab : workspace.pin ? "chat-attachment" : null;
  return <AppLayout activeTab={state.activeSidebarTab} pinnedTab={pinnedTab} pinnedTitle={workspace.title} onUnpin={() => workspace.setPin(null)}
    sidebar={() => <nav id="sidebar" style={{ padding: 16 }}><h2>Chat workspace test</h2>{["chats", "markdown", "canvas", "html-viewer"].map(tab =>
      <button key={tab} onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: tab })}>{tab}</button>)}</nav>}>
    <div className="pane chat-pane" data-capture-tab="chats" hidden={!visible("chats")}><MessageList /><InputBar active={visible("chats")} /></div>
    <div className="pane" data-capture-tab="markdown" hidden={!visible("markdown")}><MarkdownViewer /></div>
    <div className="pane" data-capture-tab="canvas" hidden={!visible("canvas")}><CanvasWorkspace /></div>
    <div className="pane" data-capture-tab="html-viewer" hidden={!visible("html-viewer")}><CodeViewer kind="html" /></div>
    <div className="pane" data-capture-tab="chat-attachment" hidden={state.activeSidebarTab !== "chats" || !workspace.pin || workspace.pin.kind === "tool"}>
      <ChatSideContent active={state.activeSidebarTab === "chats"} />
    </div>
  </AppLayout>;
}
createRoot(document.getElementById("root")).render(<StoreProvider><ChatWorkspaceProvider><ImageGenerationProvider><Fixture /></ImageGenerationProvider></ChatWorkspaceProvider></StoreProvider>);
