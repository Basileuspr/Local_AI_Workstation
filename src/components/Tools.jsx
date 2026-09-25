import { memo, useCallback, useRef, useState } from "react";
import MarkdownMessage from "./MarkdownMessage";
import { useDispatch } from "../useStore";
import { createMessageId } from "../messageIds";
import { functionTargets, desktopActions, captureActions, loadFunctionButtons, saveFunctionButtons } from "../functionButtons";
import "./Tools.css";
import { useDesktopCapabilities } from "./Compatibility";

export default memo(function Tools() {
  const dispatch = useDispatch();
  const capabilities = useDesktopCapabilities();
  const actionCapability = target => capabilities?.features?.[
    target === "system:update-programs" ? "program_updates" : target === "system:refresh-graphics" ? "graphics_reset" : target.startsWith("capture:") ? "tab_capture" : ""];
  const [loaded] = useState(() => {
    try { return { buttons: loadFunctionButtons(), error: "" }; }
    catch { return { buttons: [], error: "Could not load saved function buttons. Reload the app to try again." }; }
  });
  const [buttons, setButtons] = useState(loaded.buttons);
  const [error, setError] = useState(loaded.error);
  const [draft, setDraft] = useState(null);
  const [managing, setManaging] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [notice, setNotice] = useState("");
  const actionLock = useRef(false);
  const closeViewer = useCallback(() => setViewerOpen(false), []);

  function persist(next) {
    try { setButtons(saveFunctionButtons(next)); setError(""); return true; }
    catch { setError("Could not save buttons locally. Your changes have not been saved."); return false; }
  }

  function save(event) {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const entry = { ...draft, name: draft.name.trim() };
    const next = buttons.some(button => button.id === entry.id)
      ? buttons.map(button => button.id === entry.id ? entry : button)
      : [...buttons, entry];
    if (persist(next)) setDraft(null);
  }

  async function open(target) {
    const feature = actionCapability(target);
    if (feature?.available === false) { setError(feature.detail); return; }
    if (target === "markdown") { setViewerOpen(true); return; }
    if (!target.startsWith("capture:") && !target.startsWith("system:")) { dispatch({ type: "SET_SIDEBAR_TAB", payload: target }); return; }
    if (actionLock.current) return;
    actionLock.current = true; setActionBusy(target); setNotice(""); setError("");
    try {
      const desktop = window.workstationDesktop;
      if (!desktop?.captureTab || !desktop?.runAction) throw new Error("Restart the desktop app to load the new Functions actions.");
      const capture = target.startsWith("capture:");
      const result = await (capture ? desktop.captureTab(target.slice(8)) : desktop.runAction(target.slice(7)));
      if (result?.error) throw new Error(result.error);
      setNotice(capture ? `Screenshot copied to clipboard (${result.width} × ${result.height}).${result.warnings?.length ? ` ${result.warnings.join(" ")}` : ""}`
        : target === "system:update-programs" ? "WinGet terminal opened. Follow update progress there." : "Graphics reset shortcut sent.");
    } catch (failure) { setError(failure.message); }
    finally { actionLock.current = false; setActionBusy(""); }
  }

  return <>
    <section className="tools-workspace functions-workspace" hidden={viewerOpen} aria-labelledby="functions-heading">
      <header className="tools-heading">
        <h1 id="functions-heading">Functions</h1>
        <p>Open a tool, or add your own shortcut button.</p>
      </header>
      <div className="tools-toolbar">
        <button type="button" disabled={!!loaded.error || !!draft} onClick={() => setDraft({ id: createMessageId(), name: "", target: "markdown" })}>+ Add Button</button>
        {buttons.length > 0 && <button type="button" disabled={!!draft} aria-pressed={managing} onClick={() => setManaging(!managing)}>{managing ? "Done editing" : "Edit buttons"}</button>}
      </div>
      {draft && <form className="functions-editor" onSubmit={save}>
        <label>Button name
          <input autoFocus required maxLength={80} value={draft.name} placeholder="Name your button" onChange={event => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label>Tool or action
          <select value={draft.target} onChange={event => setDraft({ ...draft, target: event.target.value })}>
            {functionTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
          </select>
        </label>
        <div className="tools-toolbar">
          <button type="submit" disabled={!draft.name.trim()}>Save button</button>
          <button type="button" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </form>}
      {error && <p className="functions-error" role="alert">{error}</p>}
      <p role="status" className="tools-note">{actionBusy ? "Preparing action…" : notice}</p>
      <div className="functions-buttons">
        <button type="button" className="function-launcher" onClick={() => open("markdown")}>
          <strong>Markdown Viewer</strong><span>Paste text and view formatted Markdown.</span>
        </button>
        {buttons.map(button => <div className="function-custom" key={button.id}>
          <button type="button" className="function-launcher" disabled={!!actionBusy || actionCapability(button.target)?.available === false} onClick={() => open(button.target)}>
            <strong>{button.name}</strong><span>{actionCapability(button.target)?.available === false ? actionCapability(button.target).detail : functionTargets.find(target => target.id === button.target)?.name}</span>
          </button>
          {managing && <div className="tools-toolbar">
            <button type="button" disabled={!!draft} aria-label={`Edit ${button.name}`} onClick={() => setDraft({ ...button })}>Edit</button>
            <button type="button" disabled={!!draft} aria-label={`Remove ${button.name}`} onClick={() => {
              if (window.confirm(`Remove function button "${button.name}"?`)) persist(buttons.filter(item => item.id !== button.id));
            }}>Remove</button>
          </div>}
        </div>)}
      </div>
      <p className="tools-note">Custom buttons are saved on this device and sorted alphabetically.</p>
      <h2>System actions</h2>
      <div className="functions-buttons">{desktopActions.map(action => <button key={action.id} type="button" className="function-launcher" disabled={!!actionBusy || actionCapability(action.id)?.available === false} onClick={() => open(action.id)}><strong>{action.name}</strong><span>{actionCapability(action.id)?.available === false ? actionCapability(action.id).detail : action.description}</span></button>)}</div>
      <h2>Capture a tab</h2>
      <p className="tools-note">Copy the tab's current content at maximized window size while staying here. Captures keep its current selections and scroll position.</p>
      <div className="functions-buttons">{captureActions.map(action => <button key={action.id} type="button" className="function-launcher" disabled={!!actionBusy || actionCapability(action.id)?.available === false} onClick={() => open(action.id)}><strong>{action.name}</strong><span>{actionCapability(action.id)?.available === false ? actionCapability(action.id).detail : action.description}</span></button>)}</div>
    </section>
    <MarkdownViewer hidden={!viewerOpen} onBack={closeViewer} />
  </>;
});

const MarkdownViewer = memo(function MarkdownViewer({ hidden, onBack }) {
  const editor = useRef(null);
  const [preview, setPreview] = useState(false);
  const [markdown, setMarkdown] = useState("");

  function showMarkdown() {
    // Parse only on request so large pastes and typing stay inexpensive.
    setMarkdown(editor.current?.value || "");
    setPreview(true);
  }

  return <section className="tools-workspace" hidden={hidden} aria-labelledby="tools-heading">
    <div className="tools-toolbar"><button type="button" onClick={onBack}>← Functions</button></div>
    <header className="tools-heading">
      <p className="tools-eyebrow">Functions</p>
      <h1 id="tools-heading">Markdown Viewer</h1>
      <p id="markdown-help">Paste Markdown text below, then select Show Markdown to read the formatted version.</p>
    </header>
    <div className="tools-toolbar" role="group" aria-label="Markdown view">
      <button type="button" aria-pressed={!preview} aria-controls="markdown-source" onClick={() => setPreview(false)}>Plain Text</button>
      <button type="button" aria-pressed={preview} aria-controls="markdown-preview" onClick={showMarkdown}>Show Markdown</button>
    </div>
    <textarea ref={editor} id="markdown-source" className="tools-editor" hidden={preview}
      aria-label="Markdown source text" aria-describedby="markdown-help" spellCheck={false}
      placeholder={"# Paste your Markdown here\n\nHeadings, **bold**, *italic*, lists, quotes, and code blocks."} />
    <div id="markdown-preview" className="tools-preview" hidden={!preview} role="region" aria-label="Formatted Markdown" tabIndex={0}>
      {preview && (markdown.trim()
        ? <MarkdownMessage>{markdown}</MarkdownMessage>
        : <p className="tools-empty">Select Plain Text and paste some Markdown to preview it here.</p>)}
    </div>
    <p className="tools-note">Text stays here while you switch tabs. Refreshing or closing the app clears it.</p>
  </section>;
});
