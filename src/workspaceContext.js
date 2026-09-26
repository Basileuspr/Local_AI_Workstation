import * as api from "./api";
import { createMessageId } from "./messageIds";

export async function attachWorkspaceContext(state, dispatch, content) {
  const session = state.currentSessionId ? { id: state.currentSessionId } : await api.createSession();
  const saved = await api.appendSessionMessages(session.id, [{ id: createMessageId(), role: "user", content }], state.selectedModel);
  dispatch({ type: "SET_SESSION", payload: { id: saved.id, messages: saved.messages, title: saved.title,
    memorySummary: saved.memory_summary || "", summarizedMessageCount: saved.summarized_message_count || 0 } });
  dispatch({ type: "SET_SESSIONS", payload: await api.listSessions() });
  dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" });
}
