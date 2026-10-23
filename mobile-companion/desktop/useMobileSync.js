import { useEffect, useRef, useState } from "react";
import * as api from "../../src/api";
import { createPollingObserver, readPollingJson } from "../../src/polling";
import { canReloadGeneratedSession } from "../../src/imageTaskState";

const observer = createPollingObserver({ read: options => readPollingJson(api.apiUrl("/mobile/activity"), options),
  interval: (_value, { hidden, failures }) => hidden ? 15000 : failures ? 15000 : 3000 });

export function canApplyMobileSession(before, current, incoming) {
  if (!canReloadGeneratedSession(before, current) || current.currentSessionId !== incoming.id) return false;
  const saved = new Map((incoming.messages || []).map(message => [message.id, message]));
  // Only additive server changes may replace this view automatically. Preserve
  // local optimistic edits, unsaved turns and in-flight desktop streams.
  return current.conversationHistory.every(message => JSON.stringify(saved.get(message.id)) === JSON.stringify(message));
}

export function useMobileSync(state, dispatch) {
  const latest = useRef(state); latest.current = state;
  const seen = useRef(null); const [pending, setPending] = useState(null);
  useEffect(() => observer.subscribe({ data(value) { if (value?.revision && value.revision !== seen.current) { seen.current = value.revision; setPending(value.revision); } } }), []);
  useEffect(() => {
    if (!pending || state.isGenerating) return;
    let disposed = false;
    const before = latest.current;
    async function sync() {
      try {
        const [sessions, images, session] = await Promise.all([api.listSessions(), api.listSessionImages(),
          before.currentSessionId ? api.loadSession(before.currentSessionId) : Promise.resolve(null)]);
        if (disposed) return;
        dispatch({ type: "SET_SESSIONS", payload: sessions });
        dispatch({ type: "SET_SESSION_IMAGES", payload: images });
        if (session && session.revision !== before.sessionRevision && canApplyMobileSession(before, latest.current, session)) {
          dispatch({ type: "SET_SESSION", payload: { id: session.id, revision: session.revision, messages: session.messages,
            title: session.title, memorySummary: session.memory_summary || "", summarizedMessageCount: session.summarized_message_count || 0 } });
        }
        setPending(null);
      } catch { if (!disposed) { seen.current = null; setPending(null); } }
    }
    sync();
    return () => { disposed = true; };
  }, [pending, state.isGenerating, state.currentSessionId, dispatch]);
}
