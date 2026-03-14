import { useEffect, useCallback } from "react";
import { StoreProvider, useStore, useDispatch } from "./useStore";
import * as api from "./api";

import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import SettingsPanel from "./components/SettingsPanel";
import MessageList from "./components/MessageList";
import InputBar from "./components/InputBar";
import Toast from "./components/Toast";

function AppInner() {
  const state = useStore();
  const dispatch = useDispatch();

  // --- Initialize on mount ---
  useEffect(() => {
    async function init() {
      const healthy = await api.checkHealth();
      dispatch({ type: "SET_CONNECTED", payload: healthy });

      if (healthy) {
        // Load models
        const models = await api.loadModels();
        dispatch({ type: "SET_MODELS", payload: models });

        // Default to mistral if available
        if (models.length > 0) {
          const mistral = models.find((m) => m.name.includes("mistral"));
          dispatch({
            type: "SET_SELECTED_MODEL",
            payload: mistral ? mistral.name : models[0].name,
          });
        }

        // Load sidebar
        await refreshSidebar();

        // Create initial session
        await handleNewChat();
      }
    }

    init();

    // Health check interval
    const interval = setInterval(async () => {
      const healthy = await api.checkHealth();
      dispatch({ type: "SET_CONNECTED", payload: healthy });
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // --- Sidebar refresh ---
  async function refreshSidebar() {
    try {
      if (state.activeSidebarTab === "chats") {
        const sessions = await api.listSessions();
        dispatch({ type: "SET_SESSIONS", payload: sessions });
      } else {
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
    try {
      const session = await api.createSession();
      dispatch({
        type: "SET_SESSION",
        payload: { id: session.id, messages: [], title: "New Chat" },
      });
      const sessions = await api.listSessions();
      dispatch({ type: "SET_SESSIONS", payload: sessions });
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  }, [dispatch]);

  const handleLoadSession = useCallback(
    async (sessionId) => {
      try {
        const session = await api.loadSession(sessionId);
        dispatch({
          type: "SET_SESSION",
          payload: {
            id: session.id,
            messages: session.messages || [],
            title: session.title,
          },
        });
        const sessions = await api.listSessions();
        dispatch({ type: "SET_SESSIONS", payload: sessions });
      } catch (err) {
        console.error("Failed to load session:", err);
      }
    },
    [dispatch]
  );

  const handleSessionSaved = useCallback(async () => {
    const sessions = await api.listSessions();
    dispatch({ type: "SET_SESSIONS", payload: sessions });
  }, [dispatch]);

  return (
    <>
      <div id="app">
        <Sidebar
          onNewChat={handleNewChat}
          onLoadSession={handleLoadSession}
        />
        <div id="main">
          <Header />
          <SettingsPanel />
          <MessageList onNewChat={handleNewChat} />
          <InputBar
            onNewChat={handleNewChat}
            onSessionSaved={handleSessionSaved}
          />
        </div>
      </div>
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppInner />
    </StoreProvider>
  );
}