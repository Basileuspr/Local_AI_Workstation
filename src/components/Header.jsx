import { useState, useEffect, useRef } from "react";
import { useStore, useDispatch } from "../useStore.jsx";
import * as api from "../api";
import { formatModelLabel } from "../modelCatalog";
import { formatTokenEstimate, getContextStatus, getContextUsage, recentTurnStart } from "../contextMemory";
import {chatInfluences} from '../chatInfluences';
import { describeStatus, statusIndicator } from "../serviceStatus";
import { useChatPane } from "../ChatPane";
import { useChatActivities } from "./ChatActivityNotice";
import { saveChatModelChoice } from "../chatModelChoices";
import ModelOrder from "./ModelOrder";
import KnowledgeContext from "./KnowledgeContext";
import ThinkingTrace from "./ThinkingTrace";
import { exportThinkingTrace } from "../thinkingTrace";
import ChatInfluences from "./ChatInfluences";
import DisclosurePanel from "./DisclosurePanel";
import "./ChatHeader.css";
import { applySessionRename } from '../sessionPersistence';

export default function Header({ onSessionRenamed, onCompactMemory }) {
  const state = useStore();
  const pane = useChatPane();
  const activities = useChatActivities();
  const activity = activities.find(job => job.pane_id === pane.id && job.session_id === state.currentSessionId);
  const headerRef = useRef(null);
  const dispatch = useDispatch();
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [exportingThinking, setExportingThinking] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

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
  } = state;

  const problem = describeStatus(state.serviceStatus);
  const chatStatus = statusIndicator({
    connected,
    isGenerating,
    problem,
    hasModel: models.length > 0 && Boolean(selectedModel),
    activity,
  });
  // The tooltip carries the explanation and the fix; the label stays short.
  const statusTooltip = activity ? `${activity.statusLabel}\n${activity.detail}\n${activity.model}` : problem
    ? [problem.title, problem.detail, problem.action && `Run: ${problem.action}`]
        .filter(Boolean)
        .join("\n")
    : chatStatus.label;

  const selectedModelInfo = models.find((model) => model.name === selectedModel);
  const influencePlan = chatInfluences(state);
  const contextSystemPrompt = influencePlan.systemPrompt;
  const contextUsage = getContextUsage({
    messages: conversationHistory,
    memorySummary,
    summarizedMessageCount,
    contextWindow: selectedModelInfo?.contextLength,
    responseLength,
    systemPrompt: contextSystemPrompt,
    useKnowledgeBase,
    useDurableMemory: influencePlan.useDurableMemory,
    model: selectedModel,
  });
  const contextStatus = getContextStatus(contextUsage);

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  useEffect(() => { setRenaming(false); }, [currentSessionId]);
  useEffect(() => { saveChatModelChoice(currentSessionId, selectedModel); }, [currentSessionId, selectedModel]);

  function handleExport(format) {
    if (!currentSessionId) { showToast("No conversation to export", "error"); return; }
    const link = document.createElement("a");
    link.href = api.getExportUrl(currentSessionId, format); link.download = "";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    showToast("Exported as ." + format, "success");
  }

  async function handleThinkingExport() {
    setExportingThinking(true);
    try { await exportThinkingTrace(); showToast("Thinking trace download started; history preserved", "success"); }
    catch (error) { showToast(error.message || "Could not export thinking trace", "error"); }
    finally { setExportingThinking(false); }
  }

  function openRename() {
    if (!currentSessionId) { showToast("Start a chat before naming it", "error"); return; }
    setTitleDraft(sessionTitle === "New Chat" ? "" : sessionTitle); setRenaming(true);
  }

  async function handleRename(event) {
    event.preventDefault();
    const title = titleDraft.trim();
    if (!title) { showToast("Enter a chat name", "error"); return; }
    try {
      const saved = await api.updateSessionMetadata(currentSessionId, { title });
      applySessionRename(dispatch, saved);
      await onSessionRenamed?.(); setRenaming(false); showToast("Chat renamed", "success");
    } catch (error) { showToast(error.message || "Could not rename chat", "error"); }
  }

  return (
    <div id={pane.domId("header")} ref={headerRef} className="chat-header">
      <div className="header-title-group">
        {renaming ? (
          <form className="session-rename-form" onSubmit={handleRename}>
            <input autoFocus aria-label="Chat title" value={titleDraft} maxLength={120}
              onChange={event => setTitleDraft(event.target.value)}
              onKeyDown={event => { if (event.key === "Escape") { setRenaming(false); headerRef.current?.querySelector('[aria-label="Chat options"]')?.focus(); } }} />
            <button type="submit">Save</button>
            <button type="button" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : <div className="title" id={pane.domId("session-title")} title={sessionTitle}>{sessionTitle}</div>}
      </div>
      <div className="chat-model-picker">
        <select id={pane.domId("model-select")} aria-label="Chat model" value={selectedModel}
          onChange={event => dispatch({ type: "SET_SELECTED_MODEL", payload: event.target.value })}>
          {models.length === 0 ? <option value="">Loading...</option> : models.map(model =>
            <option key={model.name} value={model.name}>{formatModelLabel(model)}</option>)}
        </select>
        <span className="chat-model-status" title={statusTooltip}>
          <span className={`status-dot ${chatStatus.className}`} id={pane.domId("status-dot")} />
          <span className="status-text" id={pane.domId("status-text")} role="status" aria-live="polite">{chatStatus.label}</span>
        </span>
      </div>
      <span className="chat-context-summary" title="Estimated prompt tokens / effective context window. Open Chat options for reserves and last-request counts.">
        Context ~{formatTokenEstimate(contextUsage.promptTokens)} / {formatTokenEstimate(contextUsage.windowTokens)}
      </span>
      {contextStatus.className !== "healthy" && <span className={`chat-context-warning ${contextStatus.className}`}
        title={`Estimated prompt context: ${Math.round(contextUsage.promptTokens)} of ${Math.round(contextUsage.usableInputTokens)} usable tokens.`}>
        {contextStatus.label}
      </span>}
      <DisclosurePanel label="Chat options" className="chat-options"
        indicator={influencePlan.warnings.length ? "!" : null}
        title={`Response length, Knowledge, model settings, context, thinking, rename, and exports. Roleplay ${influencePlan.summary.roleplay?.name || 'off'}; Knowledge ${influencePlan.summary.knowledge}; saved memories ${influencePlan.useDurableMemory ? 'on' : 'off'}.${influencePlan.warnings.length ? ` ${influencePlan.warnings.length} potential instruction overlaps.` : ''}`}>
        {close => <>
          <div className="chat-options-grid">
            <section className="chat-option-group" aria-label="Response options">
              <h3>Response</h3>
              <label>Response length
                <select id={pane.domId("response-length")} aria-label="Response length" value={responseLength}
                  onChange={event => dispatch({ type: "SET_RESPONSE_LENGTH", payload: parseInt(event.target.value) })}>
                  <option value={256}>Short</option><option value={512}>Brief</option><option value={1024}>Medium</option>
                  <option value={2048}>Long</option><option value={4096}>Very Long</option><option value={-1}>Unlimited</option>
                </select>
              </label>
              <KnowledgeContext />
              <ModelOrder />
              <button id={pane.domId("settings-toggle")} type="button" className={settingsOpen ? "active" : ""}
                aria-expanded={settingsOpen} aria-controls={pane.domId("settings-panel")}
                onClick={() => { close(); dispatch({ type: "SET_SETTINGS_OPEN", payload: !settingsOpen }); }}>
                {settingsOpen ? "Close model / roleplay settings" : "Model / roleplay settings"}
              </button>
            </section>
            <section className="chat-option-group" aria-label="Conversation options">
              <h3>Conversation</h3>
              <div className={`context-meter ${contextStatus.className}`}
                title={`Estimated prompt context: ${Math.round(contextUsage.promptTokens)} of ${Math.round(contextUsage.usableInputTokens)} usable tokens. ${contextStatus.label}.`}>
                <span>Context estimate</span><strong>~{formatTokenEstimate(contextUsage.promptTokens)} / {formatTokenEstimate(contextUsage.windowTokens)}</strong>
              </div>
              <div className="chat-context-status">{selectedModel || "No model selected"} · ~{formatTokenEstimate(contextUsage.inputBudgetRemaining)} input tokens available
                {contextUsage.summarizationOccurred ? ` · ${summarizedMessageCount} messages summarized` : " · No summary"}</div>
              <details><summary>Context budget details</summary>
                <p>Effective request window: {contextUsage.windowTokens.toLocaleString()} tokens.
                  {selectedModelInfo?.trained_context_length ? ` Model metadata limit: ${selectedModelInfo.trained_context_length.toLocaleString()} tokens.` : ' Model metadata limit is unknown; the application fallback applies.'}
                  {' '}The smaller of the configured application limit and known model limit is used. Counts before a reply are estimates.</p>
                <dl>{[["Configured window",contextUsage.windowTokens],["System estimate",contextUsage.systemTokens],["Summary estimate",contextUsage.summaryTokens],["Recent messages estimate",contextUsage.unsummarizedTokens],["Output reserve",contextUsage.outputReserve],["Other reserves",contextUsage.fixedReserve-contextUsage.outputReserve]].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value} tokens</dd></div>)}</dl>
                {(() => { const record = [...conversationHistory].reverse().find(message => message.context_usage || message.influence_receipt?.context_usage);
                  const usage = record?.context_usage || record?.influence_receipt?.context_usage;
                  return usage && <><p>Last request ({usage.model}): {usage.prompt_tokens} prompt tokens ({usage.count_kind.replaceAll('_', ' ')}), {usage.generated_tokens ?? "unknown"} generated. This describes that processed request.</p>
                    {usage.adjustments?.length > 0 && <ul>{usage.adjustments.map((notice, index) => <li key={index}>{notice}</li>)}</ul>}</>; })()}
                <p>Older turns compact automatically before sending. The backend reserves room for the reply and bounds working memory. Images use resized inference copies; groups are analyzed separately. Original uploads and the full transcript stay saved.</p>
              </details>
              {memorySummary && <details><summary>Working memory · {summarizedMessageCount} messages summarized</summary><p style={{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}}>{memorySummary}</p></details>}
              <button id={pane.domId("context-compact-btn")} type="button" title="Summarize older turns while retaining the newest request and its attachments"
                disabled={isGenerating || recentTurnStart(conversationHistory) <= summarizedMessageCount} onClick={() => { close(); onCompactMemory?.(); }}>Compact memory</button>
              <button id={pane.domId("thinking-terminal-btn")} type="button" title="View full thinking trace" aria-haspopup="dialog"
                onClick={() => { close(); setThinkingOpen(true); }}>Thinking trace</button>
              <button id={pane.domId("rename-chat-btn")} type="button" title="Rename chat" onClick={() => { close(); openRename(); }}>Rename chat</button>
              <details className="chat-export-options">
                <summary>Export conversation</summary>
                <div className="chat-export-buttons">
                  {["txt", "md", "json"].map(format => <button key={format} type="button" onClick={() => { close(); handleExport(format); }}>Export as .{format}</button>)}
                  <button type="button" disabled={exportingThinking} title="Export all recorded thinking without clearing it"
                    onClick={() => { close(); void handleThinkingExport(); }}>Export thinking trace</button>
                </div>
              </details>
            </section>
          </div>
          <ChatInfluences onOpenSettings={close} />
        </>}
      </DisclosurePanel>
      {thinkingOpen && <ThinkingTrace onClose={() => setThinkingOpen(false)} />}
    </div>
  );
}
