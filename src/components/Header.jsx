import { useState, useEffect, useRef } from "react";
import { useStore, useDispatch } from "../useStore.jsx";
import * as api from "../api";
import { formatModelLabel } from "../modelCatalog";
import { formatTokenEstimate, getContextStatus, getContextUsage } from "../contextMemory";
import { buildRoleplaySystemPrompt } from "../roleplayPrompt";
import { mergeSystemPrompt } from "../responseStyle";
import { describeStatus, statusIndicator } from "../serviceStatus";
import ModelOrder from "./ModelOrder";
import KnowledgeContext from "./KnowledgeContext";

export default function Header({ onSessionRenamed, onCompactMemory }) {
  const state = useStore();
  const dispatch = useDispatch();
  const [exportOpen, setExportOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const exportRef = useRef(null);

  const {
    sessionTitle,
    models,
    selectedModel,
    useKnowledgeBase,
    settingsOpen,
    connected,
    isGenerating,
    responseLength,
    currentSessionId,
    conversationHistory,
    memorySummary,
    summarizedMessageCount,
    systemPrompt,
    responseStyle,
    roleplay,
  } = state;

  const problem = describeStatus(state.serviceStatus);
  const chatStatus = statusIndicator({
    connected,
    isGenerating,
    problem,
    hasModel: models.length > 0 && Boolean(selectedModel),
  });
  // The tooltip carries the explanation and the fix; the label stays short.
  const statusTooltip = problem
    ? [problem.title, problem.detail, problem.action && `Run: ${problem.action}`]
        .filter(Boolean)
        .join("\n")
    : chatStatus.label;

  const selectedModelInfo = models.find((model) => model.name === selectedModel);
  const contextSystemPrompt = mergeSystemPrompt({
    basePrompt: systemPrompt,
    roleplayPrompt: buildRoleplaySystemPrompt("", roleplay),
    responseStyle,
  });
  const contextUsage = getContextUsage({
    messages: conversationHistory,
    memorySummary,
    summarizedMessageCount,
    contextWindow: selectedModelInfo?.contextLength,
    responseLength,
    systemPrompt: contextSystemPrompt,
    useKnowledgeBase,
  });
  const contextStatus = getContextStatus(contextUsage);

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

  function handleThinkingExport() {
    setExportOpen(false);
    const link = document.createElement("a");
    link.href = api.getThinkingExportUrl();
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Thinking trace exported and cleared", "success");
  }

  async function handleOpenThinkingTerminal() {
    try {
      const result = await api.openThinkingTerminal();
      if (result.opened) {
        showToast("Thinking terminal opened", "success");
      } else {
        showToast(result.error || "Could not open terminal", "error");
      }
    } catch (err) {
      showToast("Could not open thinking terminal", "error");
    }
  }

  function openRename() {
    if (!currentSessionId) {
      showToast("Start a chat before naming it", "error");
      return;
    }
    setTitleDraft(sessionTitle === "New Chat" ? "" : sessionTitle);
    setRenaming(true);
  }

  async function handleRename(event) {
    event.preventDefault();
    const title = titleDraft.trim();
    if (!title) {
      showToast("Enter a chat name", "error");
      return;
    }
    try {
      await api.saveSession(currentSessionId, conversationHistory, selectedModel, { title });
      dispatch({ type: "SET_SESSION_TITLE", payload: title });
      await onSessionRenamed?.();
      setRenaming(false);
      showToast("Chat renamed", "success");
    } catch (error) {
      showToast(error.message || "Could not rename chat", "error");
    }
  }

  return (
    <div id="header">
      <div className="header-title-group">
        {renaming ? (
          <form className="session-rename-form" onSubmit={handleRename}>
            <input
              autoFocus
              aria-label="Chat title"
              value={titleDraft}
              maxLength={120}
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenaming(false);
              }}
            />
            <button type="submit">Save</button>
          </form>
        ) : (
          <>
            <div className="title" id="session-title" title={sessionTitle}>{sessionTitle}</div>
            <button id="rename-chat-btn" type="button" title="Rename chat" onClick={openRename}>Rename</button>
          </>
        )}
      </div>
      <div className="status">
        <button
          id="thinking-terminal-btn"
          title="Open thinking terminal"
          onClick={handleOpenThinkingTerminal}
        >
          Thinking
        </button>

        <button
          id="context-compact-btn"
          type="button"
          title="Summarize older turns and retain the four newest messages"
          disabled={isGenerating || conversationHistory.length <= 4}
          onClick={onCompactMemory}
        >
          Compact
        </button>

        <div
          className={`context-meter ${contextStatus.className}`}
          title={`Estimated prompt context: ${Math.round(contextUsage.promptTokens)} of ${Math.round(contextUsage.usableInputTokens)} usable tokens. ${contextStatus.label}.`}
        >
          <span>Ctx</span>
          <strong>{formatTokenEstimate(contextUsage.promptTokens)} / {formatTokenEstimate(contextUsage.usableInputTokens)}</strong>
        </div>

        {/* KB Toggle */}
        <KnowledgeContext />

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
            <button
              className="export-option"
              onClick={(e) => {
                e.stopPropagation();
                handleThinkingExport();
              }}
            >
              Export thinking trace
            </button>
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
        <ModelOrder />
        <select
          id="model-select"
          aria-label="Chat model"
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
                {formatModelLabel(m)}
              </option>
            ))
          )}
        </select>

        {/* Status */}
        <div
          className={`status-dot ${chatStatus.className}`}
          id="status-dot"
          title={statusTooltip}
        ></div>
        <span
          className="status-text"
          id="status-text"
          role="status"
          aria-live="polite"
          title={statusTooltip}
        >
          {chatStatus.label}
        </span>
      </div>
    </div>
  );
}
