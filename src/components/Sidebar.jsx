import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, useDispatch, useRefs } from "../useStore.jsx";
import * as api from "../api";
import { chatSubmissionQueue } from "../chatSubmissionQueue";
import PromptPhraseButtons from "./PromptPhraseButtons";
import ImageGallery from "./ImageGallery";
import BulkActions, { SelectionCheckbox } from "./BulkActions";
import { useSelection, useBatchAction } from "../useSelection";

export default function Sidebar({ onLoadSession, onNewChat }) {
  const state = useStore();
  const dispatch = useDispatch();
  const refs = useRefs();
  const kbFileRef = useRef(null);
  const [deleted, setDeleted] = useState([]);
  const [runtimeStatus, setRuntimeStatus] = useState(null);
  const [isResetting, setIsResetting] = useState(false);

  const {
    activeSidebarTab,
    sessions,
    sessionImages,
    kbDocuments,
    currentSessionId,
  } = state;
  const latest = useRef(state);
  latest.current = state;
  const chatSelection = useSelection(sessions);
  const trashSelection = useSelection(deleted, item => item.file);
  const kbSelection = useSelection(kbDocuments, item => item.doc_id);
  const chatBatch = useBatchAction(), trashBatch = useBatchAction(), kbBatch = useBatchAction();

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  // Only shown when something is actually recoverable, so the sidebar stays
  // quiet in normal use.
  const refreshDeleted = useCallback(async () => {
    try {
      setDeleted(await api.listDeletedSessions());
    } catch {
      setDeleted([]);
    }
  }, []);

  useEffect(() => {
    if (activeSidebarTab === "chats") refreshDeleted();
  }, [activeSidebarTab, sessions, refreshDeleted]);

  const refreshRuntime = useCallback(async () => {
    try {
      setRuntimeStatus(await api.fetchRuntimeStatus());
    } catch {
      setRuntimeStatus({ unavailable: true });
    }
  }, []);

  useEffect(() => {
    refreshRuntime();
    const timer = window.setInterval(refreshRuntime, 3000);
    return () => window.clearInterval(timer);
  }, [refreshRuntime]);

  async function handleGlobalReset() {
    if (isResetting) return;
    setIsResetting(true);

    // Clear both mounted panes immediately; the backend call below performs
    // the authoritative cancellation and memory unload.
    refs.stopRequested = true;
    chatSubmissionQueue.cancelAll();
    refs.abortController?.abort();
    refs.imageResetUi?.();
    dispatch({ type: "SET_GENERATING", payload: false });

    try {
      const result = await api.resetRuntime();
      const unloaded = result.ollama_models_unloaded?.length || 0;
      const stopped = (result.chat_requests_stopped || 0) + (result.image_requests_stopped || 0);
      const summary = `Runtime reset complete: ${stopped} task${stopped === 1 ? "" : "s"} stopped, ${unloaded} Ollama model${unloaded === 1 ? "" : "s"} unloaded`;
      showToast(summary, result.reset ? "success" : "error");
    } catch (error) {
      showToast(error.message || "Could not reset local runtimes", "error");
    } finally {
      setIsResetting(false);
      await refreshRuntime();
    }
  }

  const runtimeActivities = [];
  if (runtimeStatus?.active_chat_requests) runtimeActivities.push("chat");
  if (runtimeStatus?.gpu_owner?.startsWith("workflow:")) runtimeActivities.push("image workflow");
  if (runtimeStatus?.gpu_owner?.startsWith("image-generation")) runtimeActivities.push("image generation");
  else if (runtimeStatus?.gpu_owner === "pdf-ocr") runtimeActivities.push("PDF OCR");
  else if (runtimeStatus?.gpu_owner?.startsWith("lora")) runtimeActivities.push("LoRA");
  const loadedRuntimeCount = new Set([
    ...(runtimeStatus?.ollama_loaded_models || []),
    ...(runtimeStatus?.image?.loaded_model ? [`image:${runtimeStatus.image.loaded_model}`] : []),
  ]).size;
  const runtimeLabel = runtimeStatus?.unavailable
    ? "Runtime status unavailable"
    : runtimeActivities.length
      ? `Running: ${runtimeActivities.join(" + ")}`
      : loadedRuntimeCount
        ? `Idle; ${loadedRuntimeCount} model runtime${loadedRuntimeCount === 1 ? "" : "s"} loaded`
        : "GPU/model runtimes idle";

  async function handleRestore(item) {
    try {
      const restored = await api.restoreDeletedSession(item.file);
      const updated = await api.listSessions();
      dispatch({ type: "SET_SESSIONS", payload: updated });
      await refreshDeleted();
      await onLoadSession(restored.id);
      showToast("Chat restored", "success");
    } catch (error) {
      showToast(error.message || "Could not restore the chat", "error");
    }
  }

  async function handlePermanentlyDeleteSession(item) {
    return deleteTrashed([item]);
  }

  function deleteTrashed(items) {
    return trashBatch.run({items, key:item => item.file, selection:trashSelection, verb:"Permanently deleted",
      confirm:`Permanently delete ${items.length} selected chat(s) from disk? This cannot be undone.`,
      action:item => api.permanentlyDeleteSession(item.file), after:async result => {
        const removed = new Set(result.succeeded.map(item => item.file));
        setDeleted(current => current.filter(item => !removed.has(item.file)));
      }});
  }

  function deleteChats(items) {
    return chatBatch.run({items, selection:chatSelection, verb:"Moved to Recently deleted:",
      confirm:`Delete ${items.length} selected chat(s)? You can restore them from Recently deleted.`,
      action:item => {
        if (latest.current.isGenerating && latest.current.currentSessionId === item.id) throw new Error("Stop this chat's generation before deleting it.");
        return api.deleteSession(item.id);
      }, after:async result => {
        const removed = new Set(result.succeeded.map(item => item.id));
        const remaining = latest.current.sessions.filter(item => !removed.has(item.id));
        dispatch({type:"SET_SESSIONS", payload:remaining});
        dispatch({type:"SET_SESSION_IMAGES", payload:latest.current.sessionImages.filter(image => !removed.has(image.session_id))});
        if (removed.has(latest.current.currentSessionId)) {
          if (remaining.length) await onLoadSession(remaining[0].id);
          else dispatch({type:"SET_SESSION", payload:{id:null, messages:[], title:"New Chat", memorySummary:"", summarizedMessageCount:0}});
        }
        setDeleted(await api.listDeletedSessions());
      }});
  }

  async function handleDeleteSession(sessionId, e) {
    e.stopPropagation();
    return deleteChats(sessions.filter(item => item.id === sessionId));
  }

  async function handleKBUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    kbFileRef.current.value = "";

    showToast("Processing " + file.name + "...", "");

    try {
      const data = await api.addToKnowledgeBase(file);
      const ocrSummary = data.ocr_pages?.length
        ? `; OCR ${data.ocr_pages.length}/${data.page_count} pages`
        : "";
      showToast(`Added ${data.filename} (${data.chunks} chunks${ocrSummary})`, "success");
    } catch (err) {
      showToast("Failed: " + err.message, "error");
    }

    const docs = await api.listKnowledgeBase();
    dispatch({ type: "SET_KB_DOCUMENTS", payload: docs });
  }

  async function handleKBRemove(doc) {
    return removeDocuments([doc]);
  }

  function removeDocuments(items) {
    return kbBatch.run({items, key:item => item.doc_id, selection:kbSelection,
      confirm:`Remove ${items.length} selected document(s) from Knowledge? Their indexed chunks will be removed; original files are unchanged.`,
      action:item => api.removeFromKnowledgeBase(item.doc_id), after:result => {
        const removed = new Set(result.succeeded.map(item => item.doc_id));
        dispatch({type:"SET_KB_DOCUMENTS", payload:latest.current.kbDocuments.filter(item => !removed.has(item.doc_id))});
      }});
  }

  async function galleryImagesRemoved(result, permanent) {
    const removed = new Set(result.succeeded.map(item => item.id));
    dispatch({type:"SET_SESSION_IMAGES", payload:latest.current.sessionImages.filter(item => !removed.has(item.id))});
    if (permanent && result.succeeded.some(item => item.session_id === latest.current.currentSessionId)) {
      await onLoadSession(latest.current.currentSessionId);
    }
  }

  async function handleRemoveGalleryImage(image, event) {
    event.stopPropagation();
    if (!window.confirm(`Remove "${image.name}" from the gallery? The image will stay in its chat.`)) {
      return;
    }
    try {
      await api.removeSessionImage(image.session_id, image.image_id);
      dispatch({
        type: "SET_SESSION_IMAGES",
        payload: sessionImages.filter((item) => item.id !== image.id),
      });
      showToast("Removed from gallery", "success");
    } catch (error) {
      showToast(error.message || "Could not remove image from gallery", "error");
    }
  }

  async function handlePermanentlyDeleteGalleryImage(image, event) {
    event.stopPropagation();
    if (!window.confirm(`Permanently delete "${image.name}" from this chat and disk? This cannot be undone.`)) {
      return;
    }
    try {
      await api.permanentlyDeleteSessionImage(image.session_id, image.image_id);
      dispatch({
        type: "SET_SESSION_IMAGES",
        payload: sessionImages.filter((item) => item.id !== image.id),
      });
      if (image.session_id === currentSessionId) await onLoadSession(image.session_id);
      showToast("Image permanently deleted from disk", "success");
    } catch (error) {
      showToast(error.message || "Could not permanently delete the image", "error");
    }
  }

  return (
    <div id="sidebar">
      <div id="sidebar-header">
        <button id="new-chat-btn" onClick={onNewChat}>
          + New Chat
        </button>
      </div>

      <div className="sidebar-secondary-tabs sidebar-dashboard-tabs">
        <button type="button" className={`sidebar-tab ${activeSidebarTab === "dashboard" ? "active" : ""}`} aria-current={activeSidebarTab === "dashboard" ? "page" : undefined} onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "dashboard" })}>Dashboard</button>
      </div>
      <div className="sidebar-secondary-tabs sidebar-dashboard-tabs">
        <button type="button" className={`sidebar-tab ${activeSidebarTab === "queue" ? "active" : ""}`} aria-current={activeSidebarTab === "queue" ? "page" : undefined} onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "queue" })}>Prompt Queue</button>
      </div>

      <div className="sidebar-secondary-tabs">
        <button type="button" className={`sidebar-tab ${activeSidebarTab === "review" ? "active" : ""}`} onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "review" })}>Image Review</button>
      </div>
      <div className="sidebar-secondary-tabs">
        <button
          className={`sidebar-tab ${activeSidebarTab === "workflows" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "workflows" })}
        >
          Image Workflows
        </button>
        <button
          className={`sidebar-tab ${activeSidebarTab === "lora" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "lora" })}
        >
          LoRA
        </button>
        <button
          type="button"
          className={`sidebar-tab ${activeSidebarTab === "faces" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "faces" })}
        >
          Faces
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
          className={`sidebar-tab ${activeSidebarTab === "images" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "images" })}
        >
          Images
        </button>
        <button
          className={`sidebar-tab ${activeSidebarTab === "generate" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "generate" })}
        >
          Generate
        </button>
        <button
          className={`sidebar-tab ${activeSidebarTab === "library" ? "active" : ""}`}
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "library" })}
        >
          Index
        </button>
        <button
          className={`sidebar-tab ${activeSidebarTab === "knowledge" ? "active" : ""}`}
          title="Knowledge Base"
          onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "knowledge" })}
        >
          Knowledge
        </button>
      </div>

      <div id="sidebar-content">
        <div hidden={activeSidebarTab !== "generate"}>
          <PromptPhraseButtons />
        </div>
        {activeSidebarTab === "chats" && deleted.length > 0 && (
          <details className="trash-section">
            <summary>Recently deleted ({deleted.length})</summary>
            <BulkActions selection={trashSelection} items={deleted} label="deleted chats" batch={trashBatch}
              actions={[{label:"Delete selected forever", danger:true, onClick:deleteTrashed}]} />
            {deleted.map((item) => (
              <div className="session-item trashed" key={item.file}>
                <SelectionCheckbox selection={trashSelection} item={item} label={`deleted chat ${item.title}`} disabled={trashBatch.busy} />
                <div className="session-info">
                  <div className="session-title">{item.title}</div>
                  <div className="session-meta">{item.message_count} msgs</div>
                </div>
                <button
                  className="restore-btn"
                  disabled={trashBatch.busy}
                  title="Restore this chat"
                  onClick={() => handleRestore(item)}
                >
                  Restore
                </button>
                <button
                  className="purge-btn"
                  disabled={trashBatch.busy}
                  title="Permanently delete this chat from disk"
                  onClick={() => handlePermanentlyDeleteSession(item)}
                >
                  Delete forever
                </button>
              </div>
            ))}
          </details>
        )}

        {activeSidebarTab === "chats" && <BulkActions selection={chatSelection} items={sessions} label="chats" batch={chatBatch}
          actions={[{label:"Delete selected chats", danger:true, onClick:deleteChats}]} />}
        {activeSidebarTab === "chats" && (
          sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === currentSessionId ? "active" : ""}`}
              onClick={() => { if (!chatBatch.busy) { if (chatSelection.enabled) chatSelection.toggle(s); else onLoadSession(s.id); } }}
            >
              <SelectionCheckbox selection={chatSelection} item={s} label={`chat ${s.title}`} disabled={chatBatch.busy} />
              <div className="session-info">
                <div className="session-title">{s.title}</div>
                <div className="session-meta">{s.message_count} msgs</div>
              </div>
              <button
                className="delete-btn"
                disabled={chatBatch.busy}
                aria-label={`Delete chat ${s.title}`}
                onClick={(e) => handleDeleteSession(s.id, e)}
              >
                &times;
              </button>
            </div>
          ))
        )}

        <div hidden={activeSidebarTab !== "images"}>
          <ImageGallery images={sessionImages} onOpen={onLoadSession} active={activeSidebarTab === "images"}
            onImagesRemoved={galleryImagesRemoved}
            onRemove={handleRemoveGalleryImage} onDelete={handlePermanentlyDeleteGalleryImage} />
        </div>

        {activeSidebarTab === "library" && (
          <div className="library-sidebar-note">Prompt Index</div>
        )}

        {activeSidebarTab === "lora" && (
          <div className="library-sidebar-note">Local LoRA projects</div>
        )}

        {activeSidebarTab === "knowledge" && (
          <>
            <button
              id="kb-upload-btn"
              onClick={() => kbFileRef.current?.click()}
            >
              + Add Document to Knowledge Base
            </button>
            <BulkActions selection={kbSelection} items={kbDocuments} label="documents" batch={kbBatch}
              actions={[{label:"Remove selected documents", danger:true, onClick:removeDocuments}]} />
            {kbDocuments.length === 0 ? (
              <div className="kb-empty">
                No documents yet. Add files to make them searchable across all chats.
              </div>
            ) : (
              kbDocuments.map((doc) => (
                <div key={doc.doc_id} className="kb-doc-item">
                  <SelectionCheckbox selection={kbSelection} item={doc} label={`document ${doc.filename}`} disabled={kbBatch.busy} />
                  <div>
                    <div className="kb-doc-name">{doc.filename}</div>
                    <div className="kb-doc-meta">{doc.chunks} chunks</div>
                  </div>
                  <button
                    className="kb-remove-btn"
                    disabled={kbBatch.busy}
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

      <div id="sidebar-footer">
        <span className={`runtime-indicator ${runtimeActivities.length ? "busy" : ""}`} title="Live local model and GPU activity">
          <span className="runtime-dot" aria-hidden="true" />
          {runtimeLabel}
        </span>
        <button type="button" className="runtime-reset-btn" onClick={handleGlobalReset} disabled={isResetting}>
          {isResetting ? "Resetting..." : "Reset / Unload"}
        </button>
      </div>

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
