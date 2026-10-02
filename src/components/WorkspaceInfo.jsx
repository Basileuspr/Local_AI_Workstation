import { useEffect, useId, useRef } from "react";
import { appTabLabels } from "../navigation";
import { workspaceHelp } from "../workspaceHelp";
import WorkspaceHelpExtras from "./WorkspaceHelpExtras";
import ImageGenerationHelp from "./ImageGenerationHelp";
import LoraHelp from "./LoraHelp";
import HelpSections from "./HelpSections";
import "./WorkspaceInfo.css";

export function WorkspaceHelpContent({ tab, learningRate }) {
  const guide = workspaceHelp[tab];
  if (!guide) return null;
  return <div className="workspace-info-content">
    <div className="workspace-info-purpose">{guide.purpose}</div>
    <HelpSections sections={guide.sections} />
    {tab === "generate" && <ImageGenerationHelp />}
    {tab === "lora" && <LoraHelp learningRate={learningRate} />}
    <HelpSections sections={[["Example", [["Try it", guide.example]]]]} />
    <WorkspaceHelpExtras tab={tab} />
  </div>;
}

export default function WorkspaceInfo({ tab, learningRate }) {
  const dialog = useRef(null), trigger = useRef(null), titleId = useId();
  const label = tab === "chats" ? "Chats" : appTabLabels[tab];
  // Routes change while panes stay mounted. Do not carry an open guide into
  // another workspace, and do not remount the work surface to display help.
  useEffect(() => { dialog.current?.close(); }, [tab]);
  if (!workspaceHelp[tab]) return null;
  function closeOnBackdrop(event) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current.close();
  }
  return <div className="workspace-info">
    <button ref={trigger} type="button" className="workspace-info-button" aria-label={`${label} information`} title={`${label}: information, settings & examples`}
      aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M12 10v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="7" r="1" fill="currentColor" /></svg>
    </button>
    <dialog ref={dialog} className="workspace-info-dialog" aria-labelledby={titleId} onClick={closeOnBackdrop} onClose={() => trigger.current?.focus()}>
      <header className="workspace-info-heading"><h2 id={titleId}>{label} · information</h2><button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label={`Close ${label} information`}>Close</button></header>
      <WorkspaceHelpContent tab={tab} learningRate={learningRate} />
    </dialog>
  </div>;
}
