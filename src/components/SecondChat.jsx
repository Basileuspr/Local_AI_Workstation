import { useCallback, useEffect, useRef, useState } from "react";
import { ChatStoreProvider, useDispatch, useStore, useRefs } from "../useStore";
import { ChatPaneProvider, useDualChat } from "../ChatPane";
import { ChatWorkspaceProvider, useChatWorkspace } from "../ChatWorkspace";
import { ImageGenerationProvider } from "../ImageGenerationContext";
import { chatModelChoice } from "../chatModelChoices";
import { reconcileChatModel } from "../modelCatalog";
import * as api from "../api";
import Header from "./Header";
import SettingsPanel from "./SettingsPanel";
import MessageList from "./MessageList";
import InputBar from "./InputBar";
import ChatSideContent from "./ChatSideContent";
import "./DualChat.css";

function SecondChatSession({ active, primarySessionId, targetSessionId, onSelection, onSessionSaved }) {
  const state = useStore(), dispatch = useDispatch(), refs = useRefs(), chats = useDualChat();
  const current = useRef(state); current.current = state;
  const primary = useRef(primarySessionId); primary.current = primarySessionId;
  const visible = useRef(active); visible.current = active;
  const navigation = useRef(0), selection = useRef(onSelection); selection.current = onSelection;
  const [loading, setLoading] = useState(false);
  const workspace = useChatWorkspace();
  const load = useCallback(async (id, targetMessageId = "") => {
    if (id === primary.current) {
      chats.setFocused("primary");
      dispatch({ type: "SHOW_TOAST", payload: { message: "That conversation is already open in Chat A. Choose a different chat for Chat B.", type: "" } });
      return false;
    }
    const turn = ++navigation.current;
    setLoading(true);
    try {
      const session = await api.loadSession(id);
      if (turn !== navigation.current || id === primary.current) return false;
      const snapshot = current.current;
      dispatch({ type: "SET_SESSION", payload: { id: session.id, revision: session.revision, messages: session.messages || [],
        title: session.title, memorySummary: session.memory_summary || "", summarizedMessageCount: session.summarized_message_count || 0,
        selectedModel: chatModelChoice(id, session.model, snapshot.selectedModel, snapshot.models) } });
      selection.current(id); if (visible.current) chats.setFocused("secondary");
      if (targetMessageId) dispatch({ type: "SET_SCROLL_TARGET", payload: targetMessageId });
      return true;
    } catch (error) {
      if (turn === navigation.current) dispatch({ type: "SHOW_TOAST", payload: { message: error.message || "Could not open Chat B", type: "error" } });
      return false;
    } finally { if (turn === navigation.current) setLoading(false); }
  }, [dispatch, chats.setFocused]);
  function newChat() {
    ++navigation.current; setLoading(false); refs.pendingChatCreation = null;
    dispatch({ type: "START_NEW_CHAT" }); selection.current(null); if (visible.current) chats.setFocused("secondary");
  }
  async function createChat() {
    const turn = ++navigation.current;
    const session = await api.createSession();
    if (turn === navigation.current) {
      dispatch({ type: "SET_SESSION", payload: { id: session.id, revision: session.revision, messages: session.messages || [], title: session.title } });
      selection.current(session.id); await onSessionSaved?.();
    }
    return session;
  }
  useEffect(() => {
    chats.controller.current = { load, newChat, metadataSaved: saved => dispatch({ type: "SESSION_METADATA_SAVED", payload: saved }) };
    return () => { chats.controller.current = null; };
  }, [load]);
  useEffect(() => {
    const deleted = event => { if (Array.isArray(event.detail) && event.detail.includes(current.current.currentSessionId)) newChat(); };
    window.addEventListener("chat-sessions-deleted", deleted);
    return () => window.removeEventListener("chat-sessions-deleted", deleted);
  }, []);
  useEffect(() => { chats.setSecondary({ sessionId: state.currentSessionId, title: state.sessionTitle }); }, [state.currentSessionId, state.sessionTitle]);
  useEffect(() => {
    if (active && targetSessionId && targetSessionId !== current.current.currentSessionId) void load(targetSessionId);
  }, [targetSessionId, active, load]);
  useEffect(() => {
    if (active && !loading && state.currentSessionId && !targetSessionId) selection.current(state.currentSessionId);
  }, [active, loading, state.currentSessionId, targetSessionId]);
  useEffect(() => {
    if (state.models.length && !state.isGenerating && !state.models.some(model => model.name === state.selectedModel))
      dispatch({ type: "SET_SELECTED_MODEL", payload: reconcileChatModel(state.models, state.selectedModel) });
  }, [state.models, state.selectedModel, state.isGenerating, dispatch]);
  async function compact() {
    const snapshot = current.current, until = snapshot.conversationHistory.length - 4;
    const messages = snapshot.conversationHistory.slice(snapshot.summarizedMessageCount, until);
    if (until <= 0 || !messages.length) return;
    try {
      const result = await api.compactMemory({ model: snapshot.summaryModel || snapshot.selectedModel, sessionId: snapshot.currentSessionId,
        previousSummary: snapshot.memorySummary, messages, targetTokens: 700, exclusiveModel: true });
      const saved = await api.updateSessionMetadata(snapshot.currentSessionId, { memorySummary: result.summary || snapshot.memorySummary,
        summarizedMessageCount: until, expectedRevision: snapshot.sessionRevision });
      dispatch({ type: "SESSION_METADATA_SAVED", payload: saved, expectedRevision: snapshot.sessionRevision });
    } catch (error) { dispatch({ type: "SHOW_TOAST", payload: { message: error.message || "Could not compact Chat B", type: "error" } }); }
  }
  return <>
    <div className="second-chat-picker"><label>Conversation in Chat B
      <select aria-label="Conversation in Chat B" value={state.currentSessionId || ""} disabled={loading}
        onChange={event => event.target.value ? void load(event.target.value) : newChat()}>
        <option value="">New Chat</option>
        {state.currentSessionId && !state.sessions.some(session => session.id === state.currentSessionId) && <option value={state.currentSessionId}>{state.sessionTitle}</option>}
        {state.sessions.filter(session => session.id !== primarySessionId).map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
      </select></label><button type="button" onClick={newChat}>New Chat B</button></div>

    <Header onSessionRenamed={onSessionSaved} onCompactMemory={compact} />
    <SettingsPanel />
    {workspace.pin && <section className="second-chat-document"><button type="button" onClick={() => workspace.setPin(null)}>Close preview ×</button><ChatSideContent active={active} /></section>}
    <MessageList onNewChat={createChat} onSessionSaved={onSessionSaved} />
    <InputBar active={active} onNewChat={createChat} onSessionSaved={onSessionSaved} onOpenSession={load} />
  </>;
}

export default function SecondChat(props) {
  return <ChatStoreProvider><ChatPaneProvider id="secondary" dual={props.dual}>
    <ChatWorkspaceProvider remember={false}><ImageGenerationProvider onSessionSaved={props.onSessionSaved}>
      <SecondChatSession {...props} />
    </ImageGenerationProvider></ChatWorkspaceProvider>
  </ChatPaneProvider></ChatStoreProvider>;
}
