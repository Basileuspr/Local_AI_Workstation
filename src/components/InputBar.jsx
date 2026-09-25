import FreshFileInput from "./FreshFileInput";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chatSubmissionQueue } from "../chatSubmissionQueue";
import { useStore, useDispatch, useRefs } from "../useStore.jsx";
import * as api from "../api";
import { contextDefaults, rotateContextMemory, buildContextMessages } from "../contextMemory";
import { buildRoleplaySystemPrompt } from "../roleplayPrompt";
import { mergeSystemPrompt } from "../responseStyle";
import { createMessageId } from "../messageIds";
import { useChatUploads } from "../useChatUploads";
import { pasteChatFiles } from "../chatClipboard";
import { QueueRequestStatus } from "./PromptQueue";
import ChatImageControls from "./ChatImageControls";
import { useImageGeneration } from "../ImageGenerationContext";
import { useImageDestinations } from "../ImageDestinations";
import { useImagePrivacy } from "../ImagePrivacy";
import { isEditCommand, editCommandSettings } from "../chatEdit";
import { localImageUrl, chatImage } from "../chatImages";
import { readImageFile } from "../useChatUploads";
import ImageEditor from "./ImageEditor";
import { isStoredReference } from "../imageRefs";

export default function InputBar({ active = true, onNewChat, onSessionSaved }) {
  const state = useStore();
  const dispatch = useDispatch();
  const refs = useRefs();
  const imageGeneration = useImageGeneration();
  const destinations = useImageDestinations(), privacy = useImagePrivacy();
  const [editJob, setEditJob] = useState(null), [openingEdit, setOpeningEdit] = useState(false);
  const editLock = useRef(false);
  const chatSubmissions = useSyncExternalStore(chatSubmissionQueue.subscribe, chatSubmissionQueue.getSnapshot);
  const textareaRef = useRef(null);
  const currentSessionRef = useRef(state.currentSessionId);
  currentSessionRef.current = state.currentSessionId;
  const attachmentMenuRef = useRef(null);
  const imageInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const { uploadImage, uploadDocument, uploadFiles, isUploading } = useChatUploads({ onNewChat, onSessionSaved });
  const selectedEdit = destinations?.chatEdit?.sessionId === state.currentSessionId ? destinations.chatEdit : null;
  useEffect(() => {
    const focus = () => { if (active) { textareaRef.current.value = "/Edit "; textareaRef.current.focus(); } };
    window.addEventListener("focus-chat-edit", focus);
    return () => window.removeEventListener("focus-chat-edit", focus);
  }, [active]);
  useEffect(() => { setEditJob(null); }, [state.currentSessionId, privacy.revision]);

  async function startChatEdit(text) {
    if (editLock.current) return;
    editLock.current = true; setOpeningEdit(true);
    const sessionId = currentSessionRef.current;
    try {
      const settings = editCommandSettings(text);
      if (!sessionId) throw new Error("Attach an image to this chat first, then send /Edit.");
      let image = selectedEdit?.image;
      if (!image) {
        const saved = await api.loadSession(sessionId);
        for (const message of [...saved.messages].reverse()) {
          const candidate = [...(message.imagePreviews || []), ...(message.generatedImages || [])].at(-1);
          if (!candidate) continue;
          const value = candidate.src || candidate.url || candidate.data;
          const url = localImageUrl(candidate.id && isStoredReference(value) ? api.getSessionImageUrl(sessionId, message.id, candidate.id) : value);
          if (url) { image = chatImage(candidate, message.id, sessionId, 0, url); break; }
        }
      }
      if (!image) throw new Error("Attach an image or choose Use with /Edit on a chat image first.");
      const file = await destinations.readImage(image);
      if (currentSessionRef.current !== sessionId) return;
      setEditJob({ id: createMessageId(), replyId: createMessageId(), imageId: createMessageId(), file, image, settings, text, sessionId });
      textareaRef.current.value = "";
    } catch (error) { showToast(error.message, "error"); }
    finally { editLock.current = false; setOpeningEdit(false); }
  }
  async function saveChatEdit(blob, name, settings) {
    const job = editJob;
    if (!job) return;
    // Recheck the source's current privacy policy before publishing derived pixels.
    await destinations.readImage(job.image);
    const { dataUrl, base64 } = await readImageFile(blob);
    const lockedStages = settings.stages || [];
    const colorAreas = (settings.colorEdits?.length || 0) + lockedStages.reduce((count, stage) => count + (stage.colorEdits?.length || 0), 0);
    const summary = `Edited with Image Editor: ${lockedStages.length ? `${lockedStages.length} locked stage(s); current pass: ` : ''}red reduction ${settings.red}%, contrast ${settings.contrast}%, exposure ${settings.exposure} EV, saturation ${settings.saturation}%, rotation ${settings.rotation || 0}°.${colorAreas ? ` ${colorAreas} reference-color area(s) applied.` : ''} Original retained.`;
    const saved = await api.appendSessionMessages(job.sessionId, [
      { id: job.id, role: "user", content: job.text },
      { id: job.replyId, role: "assistant", content: summary, images: [base64], imagePreviews: [{ id: job.imageId, src: dataUrl, name, type: "image/png", size: blob.size }] },
    ], selectedModel);
    if (currentSessionRef.current === job.sessionId) dispatch({ type: "SET_SESSION", payload: { id: saved.id, messages: saved.messages, title: saved.title, memorySummary: saved.memory_summary || "", summarizedMessageCount: saved.summarized_message_count || 0 } });
    setEditJob(null); destinations.clearChatEdit();
    if (onSessionSaved) void Promise.resolve(onSessionSaved()).catch(error => showToast(error.message, "error"));
  }

  const {
    isGenerating,
    currentSessionId,
    conversationHistory,
    selectedModel,
    models,
    summaryModel,
    useKnowledgeBase,
    systemPrompt,
    temperature,
    topP,
    topK,
    repeatPenalty,
    responseLength,
    sessionTitle,
    memorySummary,
    summarizedMessageCount,
    roleplay,
    responseStyle,
  } = state;

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  useEffect(() => {
    function closeAttachmentMenu(event) {
      if (!attachmentMenuRef.current?.contains(event.target)) {
        setAttachmentMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", closeAttachmentMenu);
    return () => document.removeEventListener("mousedown", closeAttachmentMenu);
  }, []);

  function getModelOptions() {
    return {
      temperature,
      top_p: topP,
      top_k: topK,
      repeat_penalty: repeatPenalty,
      num_predict: parseInt(responseLength),
    };
  }

  function getSystemPromptValue() {
    const roleplayPrompt = buildRoleplaySystemPrompt("", roleplay);
    const prompt = mergeSystemPrompt({
      basePrompt: systemPrompt,
      roleplayPrompt,
      responseStyle,
    });
    return prompt || null;
  }

  function getSelectedContextWindow() {
    return models.find((model) => model.name === selectedModel)?.contextLength || 8192;
  }

  // Presentation for this surface: toasts, then focus returns to the message box.
  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAttachmentMenuOpen(false);

    await uploadImage(file, {
      onSuccess: () => {
        showToast("Image attached to chat", "success");
        textareaRef.current?.focus();
      },
      onError: (error) =>
        showToast(
          error.userFacing ? error.message : "Image upload failed: " + error.message,
          "error"
        ),
    });
  }

  async function handleDocumentUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAttachmentMenuOpen(false);

    await uploadDocument(file, {
      onStart: () => showToast("Reading " + file.name + "...", ""),
      onSuccess: () => {
        showToast("File loaded into chat", "success");
        textareaRef.current?.focus();
      },
      onError: (error) =>
        showToast(
          error.userFacing ? error.message : "File read failed: " + error.message,
          "error"
        ),
    });
  }

  function handlePaste(event) {
    void pasteChatFiles(event, {
      busy: isUploading || isGenerating,
      onError: message => showToast(message, "error"),
      upload: files => {
        setAttachmentMenuOpen(false);
        return uploadFiles(files, {
          onSuccess: () => showToast("Clipboard attachment saved to chat", "success"),
          onError: error => showToast(error.userFacing ? error.message : "Clipboard attachment failed: " + error.message, "error"),
        });
      },
    });
  }

  function sendMessage() {
    if (isUploading) { showToast("Wait for the attachment to finish saving before sending.", "error"); return; }
    const text = textareaRef.current?.value.trim();
    if (!text) return;
    if (isEditCommand(text)) { void startChatEdit(text); return; }
    const sourceId = currentSessionRef.current;
    // Creating a blank chat is shared by rapid submissions. Navigating away
    // while it is created must not redirect the user when it resolves.
    if (!sourceId && !refs.pendingChatCreation) {
      refs.pendingChatCreation = api.createSession();
      refs.pendingChatCreation.then(session => {
        if (currentSessionRef.current === null) {
          currentSessionRef.current = session.id;
          dispatch({ type: "SET_SESSION", payload: { id: session.id, messages: session.messages || [], title: session.title, memorySummary: "", summarizedMessageCount: 0 } });
        }
      }).catch(() => {}).finally(() => { refs.pendingChatCreation = null; });
    }
    const target = sourceId ? Promise.resolve({ id: sourceId }) : refs.pendingChatCreation;
    // Attach a handler immediately, even if the job waits behind another reply.
    const prepared = target.then(session => ({ session }), error => ({ error }));
    textareaRef.current.value = "";
    textareaRef.current.style.height = "44px";
    const followUpId = createMessageId();
    chatSubmissionQueue.enqueue({ id: followUpId, label: text, session_id: sourceId, onError: error => showToast(error.message, "error"), run: async signal => {
      const { session, error } = await prepared;
      if (signal.aborted) return;
      if (error) { showToast(error.message, "error"); return; }
      await runMessage(text, session.id, signal);
    } });
    void prepared.then(({ session }) => { if (session) chatSubmissionQueue.setSession(followUpId, session.id); });
  }

  async function runMessage(text, sessionId, signal) {
    const requestId = createMessageId();
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    signal.addEventListener("abort", abort, { once: true });
    refs.abortController = abortController;
    refs.generationRequestId = requestId;
    refs.stopRequested = false;
    dispatch({ type: "SET_GENERATING", payload: true });
    let nextMemorySummary = memorySummary;
    let nextSummarizedMessageCount = summarizedMessageCount;
    let fullResponse = "";
    let stopped = false;
    let saved;
    const userMsg = { id: createMessageId(), role: "user", content: text };
    const assistantMsg = { id: createMessageId(), role: "assistant", content: "" };
    const wasStopped = () => stopped || abortController.signal.aborted || (refs.stopRequested && refs.generationRequestId === requestId);
    const showSavedSession = (session) => {
      if (session?.id && currentSessionRef.current === session.id) {
        dispatch({ type: "SET_SESSION", payload: {
          id: session.id, messages: session.messages, title: session.title,
          memorySummary: session.memory_summary || "", summarizedMessageCount: session.summarized_message_count || 0,
        } });
      }
    };
    try {
      const original = await api.loadSession(sessionId);
      nextMemorySummary = original.memory_summary || "";
      nextSummarizedMessageCount = original.summarized_message_count || 0;
      if (wasStopped()) return;
      // Persist the submitted turn before waiting; append cannot overwrite a
      // result arriving from Generate or a different queued request.
      saved = await api.appendSessionMessages(sessionId, [userMsg], selectedModel);
      showSavedSession(saved);
      const updatedHistory = saved.messages;
      const contextWindow = getSelectedContextWindow();
      const systemPromptValue = getSystemPromptValue();
      const effectiveSummaryModel = summaryModel || selectedModel;
      let contextMessages = buildContextMessages(updatedHistory, nextMemorySummary, nextSummarizedMessageCount);
      try {
        const rotatedMemory = await rotateContextMemory({
          api, sessionId, model: effectiveSummaryModel, messages: updatedHistory,
          memorySummary: nextMemorySummary, summarizedMessageCount: nextSummarizedMessageCount,
          contextWindow, responseLength, systemPrompt: systemPromptValue, useKnowledgeBase,
          triggerRatio: contextDefaults.hardTriggerRatio, requestId, signal: abortController.signal,
        });
        nextMemorySummary = rotatedMemory.memorySummary;
        nextSummarizedMessageCount = rotatedMemory.summarizedMessageCount;
        contextMessages = rotatedMemory.contextMessages;
      } catch (error) {
        if (error.name === "AbortError") stopped = true;
        else console.warn("Memory compaction skipped:", error);
      }
      if (wasStopped()) return;
      const res = await api.streamChat({
        model: selectedModel, messages: contextMessages, useKnowledgeBase,
        systemPrompt: systemPromptValue, options: getModelOptions(), sessionId, requestId,
        signal: abortController.signal,
        replyMessageId: assistantMsg.id,
      });
      if (currentSessionRef.current === sessionId) dispatch({ type: "PUSH_MESSAGE", payload: assistantMsg });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          if (event.notice) showToast(event.notice.message, "error");
          if (event.document_status && currentSessionRef.current === sessionId) {
            const node = document.querySelector(`[data-message-id="${assistantMsg.id}"] .message-markdown`);
            if (node) node.textContent = event.document_status;
          }
          if (event.artifacts) assistantMsg.artifacts = event.artifacts;
          if (event.document_text) assistantMsg.document_text = event.document_text;
          if (event.cancelled) stopped = true;
          if (event.token) {
            fullResponse += event.token;
            // Find only this message, never the last message in another chat.
            const contentEl = document.querySelector(`[data-message-id="${assistantMsg.id}"] .message-markdown`);
            if (contentEl && currentSessionRef.current === sessionId) {
              contentEl.textContent = fullResponse;
              const cursor = document.createElement("span");
              cursor.className = "cursor";
              contentEl.appendChild(cursor);
              const messagesEl = document.getElementById("messages");
              if (messagesEl && !refs.imageViewerOpen) messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          }
          if (event.done) done = true;
        }
      }
      // Do not cancel the reader on done: the backend still performs cleanup
      // before releasing the queue slot. Consume the remaining stream to EOF.
      if (done) while (!(await reader.read()).done) { /* drain provider cleanup */ }
    } catch (error) {
      if (error.name === "AbortError" || wasStopped()) stopped = true;
      else {
        const detail = error.message || "Could not reach the backend";
        fullResponse = fullResponse || `[Error: ${detail}]`;
        showToast(detail, "error");
      }
    } finally {
      try {
        if (sessionId && saved) {
          // Streaming text is written outside React; remove it before React
          // replaces the empty assistant placeholder with rendered Markdown.
          document.querySelector(`[data-message-id="${assistantMsg.id}"] .message-markdown`)?.replaceChildren();
          saved = await api.appendSessionMessages(sessionId, fullResponse ? [{ ...assistantMsg, content: fullResponse }] : [], selectedModel, {
            memorySummary: nextMemorySummary, summarizedMessageCount: nextSummarizedMessageCount,
          });
          showSavedSession(saved);
          if (!wasStopped()) {
            try {
              const rotated = await rotateContextMemory({
                api, sessionId, model: summaryModel || selectedModel, messages: saved.messages,
                memorySummary: nextMemorySummary, summarizedMessageCount: nextSummarizedMessageCount,
                contextWindow: getSelectedContextWindow(), responseLength, systemPrompt: getSystemPromptValue(),
                useKnowledgeBase, triggerRatio: contextDefaults.normalTriggerRatio, requestId, signal: abortController.signal,
              });
              if (!wasStopped() && (rotated.memorySummary !== nextMemorySummary || rotated.summarizedMessageCount !== nextSummarizedMessageCount)) {
                saved = await api.appendSessionMessages(sessionId, [], selectedModel, {
                  memorySummary: rotated.memorySummary, summarizedMessageCount: rotated.summarizedMessageCount,
                });
                showSavedSession(saved);
              }
            } catch (error) {
              console.warn("Post-response memory compaction skipped:", error);
            }
          }
          if (onSessionSaved) await onSessionSaved();
        }
      } catch (error) {
        showToast(error.message || "Could not save the reply to its original chat", "error");
      } finally {
        signal.removeEventListener("abort", abort);
        if (refs.generationRequestId === requestId) {
          refs.abortController = null;
          refs.generationRequestId = null;
          refs.stopRequested = false;
          dispatch({ type: "SET_GENERATING", payload: false });
        }
        if (currentSessionRef.current === sessionId) textareaRef.current?.focus();
      }
    }
  }

  function stopGenerating() {
    const requestId = refs.generationRequestId;
    if (!refs.abortController || !requestId) return;
    refs.stopRequested = true;
    dispatch({ type: "SET_GENERATING", payload: false });
    showToast("Stopping generation...", "");
    void api.stopChat(requestId).catch(() => {});
    refs.abortController.abort();
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "44px";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function generateChatImage() {
    const prompt = textareaRef.current?.value.trim() || "";
    const draft = textareaRef.current?.value;
    const sourceSessionId = currentSessionRef.current;
    void imageGeneration.generate({ ...state.imageSettings, prompt }, {
      onSubmitted: (imageSessionId) => {
        if (textareaRef.current?.value === draft && [sourceSessionId, imageSessionId].includes(currentSessionRef.current)) {
          textareaRef.current.value = "";
          textareaRef.current.style.height = "44px";
        }
      },
    });
  }

  return (
    <div id="input-area">
      {active && editJob?.sessionId === currentSessionId && privacy.ready && <ImageEditor key={editJob.id} inlineInput={editJob} onSave={saveChatEdit} onCancel={() => setEditJob(null)} />}
      <div className="chat-edit-command"><button type="button" disabled={openingEdit} onClick={() => { textareaRef.current.value = "/Edit "; textareaRef.current.focus(); }}>/Edit</button><span>{openingEdit ? "Opening image editor…" : selectedEdit ? `Selected: ${selectedEdit.image.name}` : "Edit the latest chat image, or select Use with /Edit on an image."}</span>{selectedEdit && <button onClick={() => destinations.clearChatEdit()}>Clear selection</button>}<details><summary>Edit commands</summary><p>/Edit opens image controls here. Try /Edit reduce red hue, increase contrast, decrease exposure, or /Edit rotate right. Preview, adjust, then send the edited copy.</p></details></div>
      <ChatImageControls active={active} onGenerate={generateChatImage} />
      <div className="chat-document-command"><button type="button" onClick={() => { textareaRef.current.value = "/docx " + (textareaRef.current.value || ""); textareaRef.current.focus(); }}>Create Word document</button><span>Describe the document here, or ask “make this a .docx”.</span></div>
      <QueueRequestStatus requestId={refs.generationRequestId} />
      <small id="chat-clipboard-hint" role="status">{isUploading ? "Saving attachment to chat…" : "Paste screenshots or files here with Ctrl+V. Text pastes normally."}</small>
      {chatSubmissions.some(job => job.status === "waiting") && <div className="chat-pending-requests" aria-label="Waiting chat prompts">
        <small>Follow-ups wait for the earlier reply, then join Prompt Queue with its updated context.</small>
        {chatSubmissions.filter(job => job.status === "waiting").map(job => <div key={job.id}><span>{job.label}</span><button type="button" onClick={() => chatSubmissionQueue.cancel(job.id)}>Cancel waiting prompt</button></div>)}
      </div>}
      <div id="input-row">
        <div className="attachment-menu-wrapper" ref={attachmentMenuRef}>
          <button
            id="attachment-menu-btn"
            type="button"
            title="Add content"
            aria-label="Add content"
            aria-expanded={attachmentMenuOpen}
            aria-controls="attachment-menu"
            disabled={isGenerating || isUploading}
            onClick={() => setAttachmentMenuOpen((open) => !open)}
          >
            +
          </button>
          <div
            id="attachment-menu"
            className={`attachment-menu ${attachmentMenuOpen ? "visible" : ""}`}
          >
            <button
              type="button"
              onClick={() => {
                setAttachmentMenuOpen(false);
                imageInputRef.current?.click();
              }}
            >
              Upload image
            </button>
            <button
              type="button"
              onClick={() => {
                setAttachmentMenuOpen(false);
                documentInputRef.current?.click();
              }}
            >
              Upload document
            </button>
          </div>
        </div>
        <span className="chat-emoji-slot" />
        <textarea
          ref={textareaRef}
          id="chat-input"
          placeholder="Type a message... (Shift+Enter for new line)"
          autoComplete="off"
          rows={1}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          aria-describedby="chat-clipboard-hint"
        />
        <button
          id="send-btn"
          title={chatSubmissions.length ? "Queue message" : "Send"}
          aria-label={chatSubmissions.length ? "Queue message" : "Send"}
          onClick={sendMessage}
          disabled={isUploading}
        >
          &#x2191;
        </button>
        <button
          id="stop-btn"
          title="Stop generating"
          className={isGenerating ? "visible" : ""}
          onClick={stopGenerating}
        >
          &#x25A0;
        </button>
      </div>
      <FreshFileInput
        ref={imageInputRef}
        className="hidden-input"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        onChange={handleImageUpload}
      />
      <FreshFileInput
        ref={documentInputRef}
        className="hidden-input"
        type="file"
        accept=".txt,.md,.pdf,.docx"
        onChange={handleDocumentUpload}
      />
    </div>
  );
}
