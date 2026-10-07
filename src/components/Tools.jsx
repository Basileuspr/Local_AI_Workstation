import { memo, useRef, useState } from "react";
import MarkdownMessage from "./MarkdownMessage";
import { useDispatch } from "../useStore";
import { createMessageId } from "../messageIds";
import { functionTargets, desktopActions, utilityActions, captureActions, loadFunctionButtons, saveFunctionButtons } from "../functionButtons";
import "./Tools.css";
import { useDesktopCapabilities } from "./Compatibility";
import FunctionBuilder from './FunctionBuilder';
import {appTabLabels} from '../navigation';

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
  const [actionBusy, setActionBusy] = useState("");
  const [captureTarget, setCaptureTarget] = useState('capture:chats');
  const [notice, setNotice] = useState("");
  const actionLock = useRef(false);
  const registryLocation = 'Computer\\HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';

  async function utilityAction(target, choose = false) {
    if (actionLock.current) return;
    actionLock.current = true; setActionBusy(target); setNotice(''); setError('');
    try {
      const desktop = window.workstationDesktop;
      const method = choose ? desktop?.chooseWindowsUtility : desktop?.openWindowsUtility;
      if (!method) throw new Error('Fully quit and restart the desktop app to load Windows utility buttons.');
      const result = await method(target.slice(8));
      if (result?.error) throw new Error(result.error);
      if (result) setNotice(choose ? 'Program saved. Click its button to open it.' : `${utilityActions.find(item => item.id === target)?.name} opened.`);
    } catch (failure) { setError(failure.message); }
    finally { actionLock.current = false; setActionBusy(''); }
  }

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
    if (target.startsWith('utility:')) return utilityAction(target);
    const feature = actionCapability(target);
    if (feature?.available === false) { setError(feature.detail); return; }
    if (target.startsWith("program:")) {
      try {
        if (!window.workstationDesktop?.openProgram) throw new Error("Restart the desktop app to launch programs.");
        const result = await window.workstationDesktop.openProgram(target.slice(8));
        if (result?.error) throw new Error(result.error);
        setNotice("Program opened."); setError("");
      } catch (failure) { setError(failure.message); }
      return;
    }
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
        : target === "system:update-programs" ? "WinGet terminal opened. Follow update progress there." : target === "system:open-powershell" ? "PowerShell opened." : target === "system:snipping-tool" ? "Snipping Tool opened." : "Graphics reset shortcut sent.");
    } catch (failure) { setError(failure.message); }
    finally { actionLock.current = false; setActionBusy(""); }
  }

  return <>
    <section className="tools-workspace functions-workspace" aria-labelledby="functions-heading">
      <header className="tools-heading">
        <h1 id="functions-heading">Functions</h1>

      </header>
      <section className="functions-utilities" aria-labelledby="windows-utilities-heading">
        <h2 id="windows-utilities-heading">Windows utilities</h2>
        <p className="tools-note">Open a program window, then choose its options yourself.</p>
        <div className="functions-buttons">{utilityActions.map(action => <div className="function-custom" key={action.id}>
          <button type="button" className="function-launcher" disabled={!!actionBusy || !window.workstationDesktop} onClick={() => open(action.id)}>
            <strong>{action.name}</strong><span>{action.description}</span>
          </button>
          {action.configurable && <div className="tools-toolbar"><button type="button" disabled={!!actionBusy || !window.workstationDesktop} aria-label={`Choose program for ${action.name}`} onClick={() => utilityAction(action.id, true)}>Choose program…</button></div>}
        </div>)}</div>
        <label className="functions-registry-location">Registry location from screenshot
          <input readOnly aria-label="User Shell Folders registry location" value={registryLocation} onFocus={event => event.target.select()} />
        </label>
        <div className="tools-toolbar"><button type="button" disabled={!!actionBusy} onClick={async () => {
          try { await navigator.clipboard.writeText(registryLocation); setNotice('Registry location copied. Paste it into Registry Editor’s address bar.'); setError(''); }
          catch { setError('Could not copy the location. Select the location text and copy it.'); }
        }}>Copy registry location</button></div>
        {!window.workstationDesktop && <p className="tools-note">Open the Windows desktop app to use these buttons.</p>}
      </section>
      <FunctionBuilder legacyBusy={!!actionBusy} />
      <div className="tools-toolbar">
        <button type="button" disabled={!!loaded.error || !!draft} onClick={() => setDraft({ id: createMessageId(), name: "", target: "system:snipping-tool" })}>+ Add Button</button>
        {buttons.length > 0 && <button type="button" disabled={!!draft} aria-pressed={managing} onClick={() => setManaging(!managing)}>{managing ? "Done editing" : "Edit buttons"}</button>}
      </div>
      {draft && <form className="functions-editor" onSubmit={save}>
        <label>Button name
          <input autoFocus required maxLength={80} value={draft.name} placeholder="Name your button" onChange={event => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label>Tool or action
          <select value={draft.target} onChange={event => setDraft({ ...draft, target: event.target.value })}>
            <option value="program:choose">Program or shortcut…</option>
            {draft.target.startsWith("program:") && draft.target !== "program:choose" && <option value={draft.target}>{draft.programName || "Selected program"}</option>}
            {functionTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
          </select>
        </label>
        {draft.target.startsWith("program:") && <button type="button" onClick={async () => {
          try {
            if (!window.workstationDesktop?.chooseProgram) throw new Error("Restart the desktop app to browse for programs.");
            const result = await window.workstationDesktop.chooseProgram();
            if (result?.error) throw new Error(result.error);
            if (result) setDraft({ ...draft, target: `program:${result.id}`, programName: result.name, name: draft.name || result.name.replace(/\.(exe|lnk)$/i, "") });
          } catch (failure) { setError(failure.message); }
        }}>Browse for program</button>}
        <div className="tools-toolbar">
          <button type="submit" disabled={!draft.name.trim() || draft.target === "program:choose"}>Save button</button>
          <button type="button" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </form>}
      {error && <p className="functions-error" role="alert">{error}</p>}
      <p role="status" className="tools-note">{actionBusy ? "Preparing action…" : notice}</p>
      <div className="functions-buttons">
        {buttons.map(button => <div className="function-custom" key={button.id}>
          <button type="button" className="function-launcher" disabled={!!actionBusy || actionCapability(button.target)?.available === false} onClick={() => open(button.target)}>
            <strong>{button.name}</strong><span>{actionCapability(button.target)?.available === false ? actionCapability(button.target).detail : button.programName || functionTargets.find(target => target.id === button.target)?.name}</span>
          </button>
          {managing && <div className="tools-toolbar">
            <button type="button" disabled={!!draft} aria-label={`Edit ${button.name}`} onClick={() => setDraft({ ...button })}>Edit</button>
            <button type="button" disabled={!!draft} aria-label={`Remove ${button.name}`} onClick={() => {
              if (window.confirm(`Remove function button "${button.name}"?`)) persist(buttons.filter(item => item.id !== button.id));
            }}>Remove</button>
          </div>}
        </div>)}
      </div>

      <h2>System actions</h2>
      <div className="functions-buttons">{desktopActions.map(action => <button key={action.id} type="button" className="function-launcher" disabled={!!actionBusy || actionCapability(action.id)?.available === false} onClick={() => open(action.id)}><strong>{action.name}</strong><span>{actionCapability(action.id)?.available === false ? actionCapability(action.id).detail : action.description}</span></button>)}</div>
      <h2>Capture a tab</h2>

      <div className="tools-toolbar functions-capture">
        <label>Tab to capture<select aria-label="Tab to capture" value={captureTarget} disabled={!!actionBusy} onChange={event => setCaptureTarget(event.target.value)}>
          {captureActions.map(action => <option key={action.id} value={action.id}>{appTabLabels[action.id.slice(8)]}</option>)}
        </select></label>
        <button type="button" disabled={!!actionBusy || actionCapability(captureTarget)?.available === false} onClick={() => open(captureTarget)}>{actionBusy.startsWith('capture:') ? 'Capturing…' : 'Capture tab'}</button>
      </div>
      <p className="tools-note">{actionCapability(captureTarget)?.available === false ? actionCapability(captureTarget).detail : 'Copy a maximized view of the selected tab to the clipboard.'}</p>
    </section>
  </>;
});

export const MarkdownViewer = memo(function MarkdownViewer() {
  const editor = useRef(null);
  const [preview, setPreview] = useState(false);
  const [markdown, setMarkdown] = useState("");

  function showMarkdown() {
    // Parse only on request so large pastes and typing stay inexpensive.
    setMarkdown(editor.current?.value || "");
    setPreview(true);
  }

  return <section className="tools-workspace" aria-labelledby="tools-heading">
    <header className="tools-heading">
      <h1 id="tools-heading">Markdown Viewer</h1>

    </header>
    <div className="tools-toolbar" role="group" aria-label="Markdown view">
      <button type="button" aria-pressed={!preview} aria-controls="markdown-source" onClick={() => setPreview(false)}>Plain Text</button>
      <button type="button" aria-pressed={preview} aria-controls="markdown-preview" onClick={showMarkdown}>Show Markdown</button>
    </div>
    <textarea ref={editor} id="markdown-source" className="tools-editor" hidden={preview}
      aria-label="Markdown source text" spellCheck={false}
      placeholder={"# Paste your Markdown here\n\nHeadings, **bold**, *italic*, lists, quotes, and code blocks."} />
    <div id="markdown-preview" className="tools-preview" hidden={!preview} role="region" aria-label="Formatted Markdown" tabIndex={0}>
      {preview && (markdown.trim()
        ? <MarkdownMessage>{markdown}</MarkdownMessage>
        : <p className="tools-empty">Select Plain Text and paste some Markdown to preview it here.</p>)}
    </div>

  </section>;
});
