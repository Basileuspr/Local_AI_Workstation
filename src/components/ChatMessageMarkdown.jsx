import { useEffect, useRef, useState } from "react";
import MarkdownMessage from "./MarkdownMessage";
import ChatChecklistEditor from "./ChatChecklistEditor";
import { checklistItems } from "../markdownTasks";
import { useDispatch } from "../useStore";
import { useChatWorkspace } from "../ChatWorkspace";
import * as api from "../api";
import "./ChatWorkspace.css";

export default function ChatMessageMarkdown({ message, sessionId, streaming = false, onImageClick, inSidePane = false }) {
  const dispatch = useDispatch(), workspace = useChatWorkspace();
  const draftKey = `${sessionId}:${message.id}:${inSidePane ? "side" : "chat"}`;
  const [editing, setEditing] = useState(() => workspace?.checklistDrafts.current.get(draftKey) || null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef(false), editButton = useRef(null);
  const editable = !!sessionId && !!message.id && ["user", "assistant"].includes(message.role);
  const hasList = message.checklist_editable || checklistItems(message.content).length > 0;
  useEffect(() => { setError(""); }, [message.content]);
  function closeEditor() {
    workspace?.checklistDrafts.current.delete(draftKey);
    setEditing(null); requestAnimationFrame(() => editButton.current?.focus());
  }
  async function save(request, expectedContent, input, finishEditing = false) {
    if (pending.current || !editable || streaming) return;
    pending.current = true; setBusy(true); setError("");
    const focused = input === document.activeElement;
    try {
      const saved = await request();
      dispatch({ type: "CHECKLIST_ITEM_SAVED", payload: saved, expectedContent });
      if (finishEditing) closeEditor();
    } catch (failure) { setError(failure.message || "Could not save the checklist. Your edits are still here."); }
    finally {
      pending.current = false; setBusy(false);
      requestAnimationFrame(() => { if (focused && input?.isConnected && document.activeElement === document.body) input.focus(); });
    }
  }
  return <div className="chat-message-markdown">
    {busy && <p className="checklist-status" role="status">Saving checklist…</p>}
    {error && <p className="checklist-status error" role="alert">{error}</p>}
    {editing ? <ChatChecklistEditor content={editing.content} initialItems={editing.items}
      onItemsChange={items => workspace?.checklistDrafts.current.set(draftKey, { content: editing.content, items })}
      busy={busy || streaming} onCancel={closeEditor}
      onSave={items => save(() => api.editMessageChecklist(sessionId, message.id, { items, expectedContent: editing.content }), editing.content, null, true)} />
      : <MarkdownMessage onImageClick={onImageClick} onTaskToggle={editable ? (lineIndex, checked, input) =>
        save(() => api.updateChecklistItem(sessionId, message.id, { lineIndex, checked, expectedContent: message.content }), message.content, input) : undefined}
        taskDisabledReason={busy ? "Saving checklist…" : streaming ? "Wait for this reply to finish saving." : undefined}>{message.content}</MarkdownMessage>}
    {editable && hasList && !editing && <div className="checklist-tools">
      <button ref={editButton} type="button" disabled={busy || streaming} onClick={() => {
        setError(""); setEditing(workspace?.checklistDrafts.current.get(draftKey) || { content: message.content });
      }}>Edit list</button>
      {workspace && !inSidePane && <button type="button" onClick={() => workspace.setPin({ kind: "message", messageId: message.id })}>Pin list beside chat</button>}
    </div>}
  </div>;
}
