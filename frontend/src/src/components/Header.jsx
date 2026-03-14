import { useState, useEffect, useRef } from "react";
import { useStore, useDispatch } from "../useStore";
import * as api from "../api";

export default function Header() {
  const state = useStore();
  const dispatch = useDispatch();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  const {
    sessionTitle,
    models,
    selectedModel,
    useKnowledgeBase,
    settingsOpen,
    connected,
    responseLength,
    currentSessionId,
  } = state;

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  // Close export menu when clicking elsewhere
  useEffect(() => {
    function handleClick(e) {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  function handleExport(format) {
    setExportOpen(false);
    if (!currentSessionId) {
      showToast("No conversation to export", "error");
      return;
    }
    const url = api.getExportUrl(currentSessionId, format);
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Exported as ." + format, "success");
  }

  function handleKBToggle() {
    dispatch({ type: "TOGGLE_KNOWLEDGE_BASE" });
    showToast(
      useKnowledgeBase ? "Knowledge base context OFF" : "Knowledge base context ON",
      useKnowledgeBase ? "" : "success"
    );
  }

  return (
    <div id="header">
      <div className="title" id="session-title">
        {sessionTitle}
      </div>
      <div className="status">
        {/* KB Toggle */}
        <div
          className={`kb-toggle ${useKnowledgeBase ? "active" : ""}`}
          id="kb-toggle"
          title="Toggle knowledge base context"
          onClick={handleKBToggle}
        >
          <div className="kb-toggle-dot"></div>
          <span className="kb-toggle-label">KB</span>
        </div>

        {/* Export */}
        <div className="export-wrapper" ref={exportRef}>
          <button
            id="export-btn"
            title="Export conversation"
            onClick={(e) => {
              e.stopPropagation();
              setExportOpen(!exportOpen);
            }}
          >
            Export
          </button>
          <div className={`export-menu ${exportOpen ? "visible" : ""}`}>
            {["txt", "md", "json"].map((fmt) => (
              <button
                key={fmt}
                className="export-option"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExport(fmt);
                }}
              >
                Export as .{fmt}
              </button>
            ))}
          </div>
        </div>

        {/* Response Length */}
        <select
          id="response-length"
          title="Response length"
          value={responseLength}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            dispatch({ type: "SET_RESPONSE_LENGTH", payload: val });
          }}
        >
          <option value={256}>Short</option>
          <option value={512}>Brief</option>
          <option value={1024}>Medium</option>
          <option value={2048}>Long</option>
          <option value={4096}>Very Long</option>
          <option value={-1}>Unlimited</option>
        </select>

        {/* Settings Toggle */}
        <button
          id="settings-toggle"
          className={settingsOpen ? "active" : ""}
          title="Model settings"
          onClick={() =>
            dispatch({ type: "SET_SETTINGS_OPEN", payload: !settingsOpen })
          }
        >
          Settings
        </button>

        {/* Model Select */}
        <select
          id="model-select"
          value={selectedModel}
          onChange={(e) =>
            dispatch({ type: "SET_SELECTED_MODEL", payload: e.target.value })
          }
        >
          {models.length === 0 ? (
            <option>Loading...</option>
          ) : (
            models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} ({(m.size / 1e9).toFixed(1)}GB)
              </option>
            ))
          )}
        </select>

        {/* Status */}
        <div
          className={`status-dot ${connected ? "connected" : "error"}`}
          id="status-dot"
        ></div>
        <span className="status-text" id="status-text">
          {connected ? "connected" : "backend offline"}
        </span>
      </div>
    </div>
  );
}