import { useEffect, useState } from "react";
import { useChatWorkspace } from "../ChatWorkspace";
import { useStore } from "../useStore";
import { useImagePrivacy } from "../ImagePrivacy";
import { DocumentPage, documentUrl, downloadDocument } from "./DocumentViewer";
import ChatMessageMarkdown from "./ChatMessageMarkdown";

function SideDocument({ artifact, active }) {
  const privacy = useImagePrivacy();
  const [value, setValue] = useState(null), [error, setError] = useState(""), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue(null); setError("");
    if (!active || !privacy.ready) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(documentUrl(artifact.id), { signal: controller.signal });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(typeof data.detail === "string" ? data.detail : "Document preview unavailable. Try again.");
        }
        const data = await response.json(); if (!controller.signal.aborted) setValue(data);
      } catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
    })();
    return () => controller.abort();
  }, [artifact.id, active, privacy.ready, privacy.revision, retry]);
  return <>
    <div className="chat-side-document-tools document-attachment"><button type="button" disabled={busy || !privacy.ready} onClick={async () => {
      setBusy(true); try { await downloadDocument(artifact); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    }}>{busy ? "Preparing…" : "Download .docx"}</button></div>
    {error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>Retry preview</button></p>}
    {!value && !error && <p role="status">Loading document…</p>}
    {value?.id === artifact.id && privacy.ready && <DocumentPage document={value} />}
  </>;
}

export default function ChatSideContent({ active }) {
  const workspace = useChatWorkspace(), state = useStore();
  if (!workspace?.pin || workspace.pin.kind === "tool") return null;
  return <section className="chat-side-content" aria-label={workspace.title}>
    {workspace.pin.kind === "document" ? workspace.artifact
      ? <SideDocument key={workspace.artifact.id} artifact={workspace.artifact} active={active} />
      : <p>This document is no longer attached to this chat.</p>
      : workspace.message ? <ChatMessageMarkdown key={`${state.currentSessionId}:${workspace.message.id}`} inSidePane
          message={workspace.message} sessionId={state.currentSessionId} streaming={state.isGenerating && workspace.message === state.conversationHistory.at(-1)} />
        : <p>This checklist is no longer available in this chat.</p>}
  </section>;
}
