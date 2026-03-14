import { useRef } from "react";
import { useStore, useDispatch } from "../useStore";
import * as api from "../api";

export default function Sidebar({ onLoadSession, onNewChat }) {
  const state = useStore();
  const dispatch = useDispatch();
  const kbFileRef = useRef(null);

  const {
    activeSidebarTab,
    sessions,
    kbDocuments,
    currentSessionId,
  } = state;

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  async function handleDeleteSession(sessionId, e) {
    e.stopPropagation();
    try {
      await api.deleteSession(sessionId);
      if (sessionId === currentSessionId) {
        await onNewChat();
      }
      const updated = await api.listSessions();
      dispatch({ type: "SET_SESSIONS", payload: updated });
      showToast("Session deleted", "success");
    } catch (err) {
      console.error("Failed to delete session:", err);
    }
  }

  async function handleKBUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    kbFileRef.current.value = "";

    showToast("Processing " + file.name + "...", "");

    try {
      const data = await api.addToKnowledgeBase(file);
      showToast(`Added ${data.filename} (${data.chunks} chunks)`, "success");
    } catch (err) {
      showToast("Failed: " + err.message, "error");
    }

    const docs = await api.listKnowledgeBase();
    dispatch({ type: "SET_KB_DOCUMENTS", payload: docs });
  }

  async function handleKBRemove(doc) {
    try {
      await api.removeFromKnowledgeBase(doc.doc_id);
      showToast("Removed " + doc.filename, "success");
      const docs = await api.listKnowledgeBase();
      dispatch({ type: "SET_KB_DOCUMENTS", payload: docs });
    } catch (err) {
      showToast("Failed to remove document", "error");
    }
  }

  return (
    <div id="sidebar">
      <div id="sidebar-header">
        <button id="new-chat-btn" onClick={onNewChat}>
          + New Chat
        </button>
      </div>

      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${activeSidebarTab === "chats" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" })}
        >
          Chats
        </button>
        <button
          className={`sidebar-tab ${activeSidebarTab === "knowledge" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "knowledge" })}
        >
          Knowledge Base
        </button>
      </div>

      <div id="sidebar-content">
        {activeSidebarTab === "chats" ? (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === currentSessionId ? "active" : ""}`}
              onClick={() => onLoadSession(s.id)}
            >
              <div className="session-info">
                <div className="session-title">{s.title}</div>
                <div className="session-meta">{s.message_count} msgs</div>
              </div>
              <button
                className="delete-btn"
                onClick={(e) => handleDeleteSession(s.id, e)}
              >
                &times;
              </button>
            </div>
          ))
        ) : (
          <>
            <button
              id="kb-upload-btn"
              onClick={() => kbFileRef.current?.click()}
            >
              + Add Document to Knowledge Base
            </button>
            {kbDocuments.length === 0 ? (
              <div className="kb-empty">
                No documents yet. Add files to make them searchable across all chats.
              </div>
            ) : (
              kbDocuments.map((doc) => (
                <div key={doc.doc_id} className="kb-doc-item">
                  <div>
                    <div className="kb-doc-name">{doc.filename}</div>
                    <div className="kb-doc-meta">{doc.chunks} chunks</div>
                  </div>
                  <button
                    className="kb-remove-btn"
                    onClick={() => handleKBRemove(doc)}
                  >
                    &times;
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>

      <div id="sidebar-footer">Local AI Workstation</div>

      <input
        type="file"
        ref={kbFileRef}
        className="hidden-input"
        accept=".txt,.md,.pdf,.docx"
        onChange={handleKBUpload}
      />
    </div>
  );
}