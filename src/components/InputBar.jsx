import FreshFileInput from "./FreshFileInput";
import {ChatAudio} from './AudioWorkspace';
import {chatSpeech} from '../chatSpeech';
import {useImageRemoval} from "./ImageRemovalControls";
import {validateImageFile} from "../useChatUploads";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chatSubmissionQueue } from "../chatSubmissionQueue";
import { invalidatePolling } from "../polling";
import { useChatPane } from "../ChatPane";
import { useStore, useDispatch, useRefs } from "../useStore.jsx";
import * as api from "../api";
import { persistSessionSummary } from "../sessionPersistence";
import { contextDefaults, rotateContextMemory, buildContextMessages } from "../contextMemory";
import {chatInfluences} from '../chatInfluences';
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
import WebAccess from "./WebAccess";
import { isStoredReference } from "../imageRefs";
import { canvasContext, applyCanvasEdit } from "../canvasStore";
import "./ChatComposer.css";
import { useDismissiblePopup } from '../useDismissiblePopup';

export default function InputBar({ active = true, onNewChat, onSessionSaved, onOpenSession }) {
  const state = useStore();
  const pane = useChatPane();
  const focusState = useRef({ active, focused: pane.focused }); focusState.current = { active, focused: pane.focused };
  const receivesExternalEvents = active && pane.focused;
  const dispatch = useDispatch();
  const refs = useRefs();
  const imageGeneration = useImageGeneration();
  const destinations = useImageDestinations(), privacy = useImagePrivacy();
  const [editJob, setEditJob] = useState(null), [openingEdit, setOpeningEdit] = useState(false);
  const editLock = useRef(false);
  const chatSubmissions = useSyncExternalStore(chatSubmissionQueue.subscribe, chatSubmissionQueue.getSnapshot, chatSubmissionQueue.getSnapshot);
  const textareaRef = useRef(null);
  const currentSessionRef = useRef(state.currentSessionId);
  const draftVersionRef = useRef(state.chatDraftVersion);
  draftVersionRef.current = state.chatDraftVersion;
  const voiceOutputRef = useRef(state.voiceOutput);
  voiceOutputRef.current = state.voiceOutput;
  currentSessionRef.current = state.currentSessionId;
  const attachmentMenuRef = useRef(null);
  const imageInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [openTool, setOpenTool] = useState(null);
  const [steerOpen, setSteerOpen] = useState(false), [steerDraft, setSteerDraft] = useState('');
  const steerDialog = useRef(null);
  const steeringJob = chatSubmissions.find(job => job.id === refs.generationRequestId && job.status === 'running'
    && job.pane_id === pane.id && job.session_id === state.currentSessionId);
  const canSteer = Boolean(steeringJob && !['saving', 'cancelling', 'compacting'].includes(steeringJob.stage) && refs.abortController && !refs.abortController.signal.aborted);
  useEffect(() => {
    if (steerOpen && active) steerDialog.current?.showModal();
    else steerDialog.current?.close();
  }, [steerOpen, active]);
  useEffect(() => { setSteerOpen(false); setSteerDraft(''); }, [state.currentSessionId]);
  const [webActivity, setWebActivity] = useState({});
  const toolBarRef = useRef(null);
  useDismissiblePopup({ open: attachmentMenuOpen && active, container: attachmentMenuRef,
    onDismiss: () => setAttachmentMenuOpen(false), returnFocus: () => attachmentMenuRef.current?.querySelector('button') });
  useDismissiblePopup({ open: !!openTool && active, container: toolBarRef,
    onDismiss: () => setOpenTool(null), returnFocus: () => toolBarRef.current?.querySelector('[aria-expanded="true"]') });
  const toggleTool = tool => {
    if (openTool === tool) toolBarRef.current?.querySelector('[aria-expanded="true"]')?.focus();
    setOpenTool(current => current === tool ? null : tool);
  };
  useEffect(() => { if (!active) setOpenTool(null); }, [active]);
  const { uploadFiles, isUploading } = useChatUploads({ onNewChat, onSessionSaved });
  const [pendingImages,setPendingImages]=useState([]);
  const pendingImagesRef=useRef([]), attaching=useRef(false);
  useEffect(()=>()=>pendingImagesRef.current.forEach(item=>{if(item.url)URL.revokeObjectURL(item.url);}),[]);
  function removePendingImages(items) {
    const ids=new Set(items.map(item=>item.id));
    items.forEach(item=>{if(item.url)URL.revokeObjectURL(item.url);});
    pendingImagesRef.current=pendingImagesRef.current.filter(item=>!ids.has(item.id));
    setPendingImages(pendingImagesRef.current);
  }
  const pendingRemoval=useImageRemoval(pendingImages,removePendingImages,{label:'pending attachments',disabled:isUploading});
  function stageAttachments(files) {
    if(attaching.current || isUploading)return;
    const added=[];
    for(const file of files){
      const image=file.type.startsWith('image/');
      const problem=image?validateImageFile(file):null;
      if(problem){showToast(`${file.name}: ${problem}`,'error');continue;}
      added.push({id:createMessageId(),file,url:image?URL.createObjectURL(file):null});
    }
    pendingImagesRef.current=[...pendingImagesRef.current,...added];
    setPendingImages(pendingImagesRef.current);
    setAttachmentMenuOpen(false);
  }
  useEffect(() => {
    if (!state.chatDraftVersion) return;
    removePendingImages([...pendingImagesRef.current]);
    if (textareaRef.current) { textareaRef.current.value = ""; textareaRef.current.style.height = "44px"; }
    setAttachmentMenuOpen(false); setOpenTool(null); setEditJob(null);
    textareaRef.current?.focus();
  }, [state.chatDraftVersion]);
  useEffect(() => {
    const stage = event => {
      if (!receivesExternalEvents) return;
      event.preventDefault();
      if (attaching.current || isUploading) { showToast('Wait for the attachment save to finish, then add these images again.', 'error'); return; }
      stageAttachments(event.detail);
    };
    window.addEventListener('stage-chat-images', stage);
    return () => window.removeEventListener('stage-chat-images', stage);
  }, [receivesExternalEvents, isUploading]);
  useEffect(() => {
    const stage = event => {
      if (!receivesExternalEvents || attaching.current || isUploading || !Array.isArray(event.detail) || !event.detail.length) return;
      if (event.detail.some(file => file.type.startsWith('image/') && validateImageFile(file))) return;
      stageAttachments(event.detail);
      event.preventDefault();
    };
    window.addEventListener('stage-function-result', stage);
    return () => window.removeEventListener('stage-function-result', stage);
  }, [receivesExternalEvents, isUploading]);

  const selectedEdit = destinations?.chatEdit?.sessionId === state.currentSessionId ? destinations.chatEdit : null;
  useEffect(() => {
    const focus = () => { if (receivesExternalEvents) { textareaRef.current.value = "/Edit "; textareaRef.current.focus(); } };
    window.addEventListener("focus-chat-edit", focus);
    return () => window.removeEventListener("focus-chat-edit", focus);
  }, [receivesExternalEvents]);
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
    if (currentSessionRef.current === job.sessionId) dispatch({ type: "SET_SESSION", payload: { id: saved.id, revision: saved.revision, messages: saved.messages, title: saved.title, memorySummary: saved.memory_summary || "", summarizedMessageCount: saved.summarized_message_count || 0 } });
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
    knowledgeDocIds,
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
    return chatInfluences(state).systemPrompt || null;
  }

  function getSelectedContextWindow() {
    return models.find((model) => model.name === selectedModel)?.contextLength || 8192;
  }

  // Presentation for this surface: toasts, then focus returns to the message box.
  function handleImageUpload(event) {
    const files=Array.from(event.target.files || []);event.target.value='';
    stageAttachments(files);
  }

  function handleDocumentUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    stageAttachments([file]);
    textareaRef.current?.focus();
  }

  function handlePaste(event) {
    void pasteChatFiles(event, {
      busy: isUploading || isGenerating,
      onError: message => showToast(message, "error"),
      upload: files => {stageAttachments(files);return Promise.resolve(true);},
    });
  }

  async function sendMessage() {
    if(attaching.current || isUploading)return;
    if (!currentSessionRef.current && !textareaRef.current?.value.trim()) {
      if (pendingImagesRef.current.length) showToast("Enter a prompt before sending attachments in a new chat.", "error");
      return;
    }
    if(!pendingImagesRef.current.length){sendTextMessage();return;}
    attaching.current=true;
    const text=textareaRef.current?.value.trim() || '';
    let failed=false, targetId=null;
    try {
      const uploaded=await uploadFiles(pendingImagesRef.current.map(item=>item.file),{
        onTarget:id=>{targetId=id;},
        onSuccess:file=>{const item=pendingImagesRef.current.find(item=>item.file===file);if(item)removePendingImages([item]);},
        onError:error=>{failed=true;showToast(error.message,'error');}
      });
      if(uploaded && !failed && currentSessionRef.current===targetId)sendTextMessage(text);
    } finally {attaching.current=false;}
  }

  function sendTextMessage(submittedText, { steerAfter = null, steerReceipt = null } = {}) {
    if (isUploading) { showToast("Wait for the attachment to finish saving before sending.", "error"); return; }
    const text = submittedText ?? textareaRef.current?.value.trim();
    if (!text) return;
    let submittedCanvas;
    try { submittedCanvas = !steerAfter && /\b(canvas|whiteboard)\b/i.test(text) ? canvasContext() : undefined; }
    catch (failure) { showToast(failure.message, "error"); return; }
    if (!steerAfter && isEditCommand(text)) { void startChatEdit(text); return; }
    const sourceId = currentSessionRef.current;
    // Creating a blank chat is shared by rapid submissions. Navigating away
    // while it is created must not redirect the user when it resolves.
    if (!sourceId && !refs.pendingChatCreation) {
      const draftVersion = draftVersionRef.current;
      const creation = api.createSession();
      refs.pendingChatCreation = creation;
      creation.then(session => {
        if (currentSessionRef.current === null && draftVersionRef.current === draftVersion) {
          currentSessionRef.current = session.id;
          dispatch({ type: "SET_SESSION", payload: { id: session.id, revision: session.revision, messages: session.messages || [], title: session.title, memorySummary: "", summarizedMessageCount: 0 } });
        }
        if (onSessionSaved) void Promise.resolve(onSessionSaved()).catch(error => showToast(error.message, "error"));
      }).catch(() => {}).finally(() => { if (refs.pendingChatCreation === creation) refs.pendingChatCreation = null; });
    }
    const target = sourceId ? Promise.resolve({ id: sourceId }) : refs.pendingChatCreation;
    // Attach a handler immediately, even if the job waits behind another reply.
    const prepared = target.then(session => ({ session }), error => ({ error }));
    if (!steerAfter && textareaRef.current.value.trim() === text) { textareaRef.current.value = ""; textareaRef.current.style.height = "44px"; }
    const followUpId = createMessageId();
    const queued = chatSubmissionQueue.enqueue({ id: followUpId, label: text, session_id: sourceId, session_title: sessionTitle, model: selectedModel, afterId: steerAfter,
      pane_id: pane.id, pane_label: pane.label, onError: error => {
        if (steerAfter && currentSessionRef.current === sourceId) setSteerDraft(text);
        showToast(error.message, "error");
      }, run: async signal => {
      const { session, error } = await prepared;
      if (signal.aborted) return;
      if (error) { showToast(error.message, "error"); return; }
      if (steerAfter && (!steerReceipt?.saved || steerReceipt.requestId !== steerAfter || steerReceipt.sessionId !== session.id)) {
        throw new Error('The partial reply could not be saved. Your steering instruction was kept; copy it from Steer and send it after resolving the save error.');
      }
      await runMessage(text, session.id, signal, submittedCanvas, followUpId);
    } });
    void prepared.then(({ session }) => { if (session) chatSubmissionQueue.setSession(followUpId, session.id); });
    return queued;
  }

  async function runMessage(text, sessionId, signal, submittedCanvas, requestId) {
    const progress = (stage, stage_detail) => {
      chatSubmissionQueue.update(requestId, { request_id: requestId, stage, stage_detail });
      invalidatePolling("runtime", "queue");
    };
    progress("preparing", `Preparing ${pane.label}`);
    let savingReply = false;
    const requestApi = { ...api, compactMemory: async options => {
      progress("compacting", "Compacting conversation context");
      const result = await api.compactMemory({ ...options, exclusiveModel: pane.dual });
      progress(savingReply ? "saving" : "preparing", savingReply ? "Saving conversation context" : "Preparing chat");
      return result;
    } };
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    signal.addEventListener("abort", abort, { once: true });
    refs.abortController = abortController;
    refs.generationRequestId = requestId;
    const saveReceipt = { requestId, sessionId, saved: false };
    refs.replySaveReceipt = saveReceipt;
    refs.stopRequested = false;
    dispatch({ type: "SET_GENERATING", payload: true });
    let nextMemorySummary = memorySummary;
    let nextSummarizedMessageCount = summarizedMessageCount;
    let fullResponse = "";
    let stopped = false;
    let responseCompleted = false, responseFailed = false, replySaved = false;
    let saved;
    const userMsg = { id: createMessageId(), role: "user", content: text };
    const influencePlan=chatInfluences(state);
    const assistantMsg = { id: createMessageId(), role: "assistant", content: "",influence_settings:influencePlan.summary };
    const wasStopped = () => stopped || abortController.signal.aborted || (refs.stopRequested && refs.generationRequestId === requestId);
    const showSavedSession = (session) => {
      if (session?.id && currentSessionRef.current === session.id) {
        dispatch({ type: "SET_SESSION", payload: {
          id: session.id, revision: session.revision, messages: session.messages, title: session.title,
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
      chatSubmissionQueue.update(requestId, { session_title: saved.title });
      nextMemorySummary = saved.memory_summary || "";
      nextSummarizedMessageCount = saved.summarized_message_count || 0;
      showSavedSession(saved);
      const updatedHistory = saved.messages;
      const contextWindow = getSelectedContextWindow();
      const systemPromptValue = getSystemPromptValue();
      const canvasData = submittedCanvas;
      const budgetPrompt = canvasData ? systemPromptValue + "\n" + JSON.stringify(canvasData) + " ".repeat(3500) : systemPromptValue;
      const effectiveSummaryModel = summaryModel || selectedModel;
      let contextMessages = buildContextMessages(updatedHistory, nextMemorySummary, nextSummarizedMessageCount);
      try {
        const rotatedMemory = await rotateContextMemory({
          api: requestApi, sessionId, model: effectiveSummaryModel, messages: updatedHistory,
          useDurableMemory: influencePlan.useDurableMemory,
          memorySummary: nextMemorySummary, summarizedMessageCount: nextSummarizedMessageCount,
          contextWindow, responseLength: canvasData ? Math.max(4096, responseLength) : responseLength, systemPrompt: budgetPrompt, useKnowledgeBase,
          triggerRatio: contextDefaults.hardTriggerRatio, requestId, signal: abortController.signal,
        });
        saved = await persistSessionSummary(api, saved, rotatedMemory.memorySummary, rotatedMemory.summarizedMessageCount);
        nextMemorySummary = saved.memory_summary || "";
        nextSummarizedMessageCount = saved.summarized_message_count || 0;
        showSavedSession(saved);
        contextMessages = rotatedMemory.contextMessages;
      } catch (error) {
        if (error.name === "AbortError") stopped = true;
        else { console.warn("Memory compaction skipped:", error); showToast(error.message || "Memory compaction was not saved", "error"); }
      }
      if (wasStopped()) return;
      progress("queued", "Waiting for the shared model queue");
      const res = await api.streamChat({
        exclusiveModel: pane.dual,
        model: selectedModel, messages: contextMessages, useKnowledgeBase,
        knowledgeDocIds,
        canvasContext: canvasData,
        systemPrompt: systemPromptValue, options: getModelOptions(), sessionId, requestId,
        useDurableMemory:influencePlan.useDurableMemory,
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
          if (event.runtime_status) progress(event.runtime_status.stage, event.runtime_status.detail);
          if (event.document_status) progress("creating_document", event.document_status);
          if (event.notice) showToast(event.notice.message, "error");
          if (event.document_status && currentSessionRef.current === sessionId) {
            const node = document.querySelector(`[data-message-id="${assistantMsg.id}"] .message-markdown`);
            if (node) node.textContent = event.document_status;
          }
          if (event.thinking && !fullResponse && currentSessionRef.current === sessionId) {
            const node = document.querySelector(`[data-message-id="${assistantMsg.id}"] .message-markdown`);
            if (node) node.textContent = "Thinking… Open Chat options → Thinking trace to view the live output.";
          }
          if (event.artifacts) assistantMsg.artifacts = event.artifacts;
          if (event.knowledge_sources) assistantMsg.knowledge_sources = event.knowledge_sources;
          if (event.influence_receipt) assistantMsg.influence_receipt = event.influence_receipt;
          if (event.context_usage) assistantMsg.context_usage = event.context_usage;
          if (event.canvas_edit) {
            try { applyCanvasEdit(event.canvas_edit); assistantMsg.canvas_applied = true; }
            catch (failure) { fullResponse += `\nCanvas was not changed: ${failure.message}\n`; showToast(failure.message, "error"); }
          }
          if (event.document_text) assistantMsg.document_text = event.document_text;
          if (event.cancelled) stopped = true;
          if (event.error || /^\[Error:/.test(event.token || '')) responseFailed = true;
          if (event.token) {
            fullResponse += event.token;
            // Find only this message, never the last message in another chat.
            const contentEl = document.querySelector(`[data-message-id="${assistantMsg.id}"] .message-markdown`);
            if (contentEl && currentSessionRef.current === sessionId) {
              contentEl.textContent = fullResponse;
              const cursor = document.createElement("span");
              cursor.className = "cursor";
              contentEl.appendChild(cursor);
              const messagesEl = contentEl.closest(".chat-messages");
              if (messagesEl && messagesEl.dataset.followBottom !== 'false' && !refs.imageViewerOpen) messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          }
          if (event.done) {done = true;responseCompleted = true;}
        }
      }
      // Do not cancel the reader on done: the backend still performs cleanup
      // before releasing the queue slot. Consume the remaining stream to EOF.
      if (done) while (!(await reader.read()).done) { /* drain provider cleanup */ }
    } catch (error) {
      if (error.name === "AbortError" || wasStopped()) stopped = true;
      else {
        responseFailed = true;
        const detail = error.message || "Could not reach the backend";
        fullResponse = fullResponse || `[Error: ${detail}]`;
        showToast(detail, "error");
      }
    } finally {
      savingReply = true;
      progress("saving", stopped ? "Saving the partial reply" : "Saving the reply to its original conversation");
      try {
        if (sessionId && saved) {
          // Streaming text is written outside React; remove it before React
          // replaces the empty assistant placeholder with rendered Markdown.
          document.querySelector(`[data-message-id="${assistantMsg.id}"] .message-markdown`)?.replaceChildren();
          saved = await api.appendSessionMessages(sessionId, fullResponse ? [{ ...assistantMsg, content: fullResponse }] : [], selectedModel);
          saveReceipt.saved = true;
          nextMemorySummary = saved.memory_summary || "";
          nextSummarizedMessageCount = saved.summarized_message_count || 0;
          replySaved = Boolean(fullResponse);
          showSavedSession(saved);
          if (!wasStopped()) {
            try {
              const rotated = await rotateContextMemory({
                api: requestApi, sessionId, model: summaryModel || selectedModel, messages: saved.messages,
                memorySummary: nextMemorySummary, summarizedMessageCount: nextSummarizedMessageCount,
                contextWindow: getSelectedContextWindow(), responseLength, systemPrompt: getSystemPromptValue(),
                useKnowledgeBase, useDurableMemory: influencePlan.useDurableMemory, triggerRatio: contextDefaults.normalTriggerRatio, requestId, signal: abortController.signal,
              });
              if (!wasStopped() && (rotated.memorySummary !== nextMemorySummary || rotated.summarizedMessageCount !== nextSummarizedMessageCount)) {
                saved = await persistSessionSummary(api, saved, rotated.memorySummary, rotated.summarizedMessageCount);
                showSavedSession(saved);
              }
            } catch (error) {
              console.warn("Post-response memory compaction skipped:", error);
              showToast(error.message || "Memory compaction was not saved", "error");
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
        if (currentSessionRef.current === sessionId && focusState.current.active && focusState.current.focused) textareaRef.current?.focus();
        chatSpeech.completed({message:{...assistantMsg,content:fullResponse},sessionId,preferences:voiceOutputRef.current,
          completed:replySaved && responseCompleted && !responseFailed && !wasStopped() && !/^\[Error:/.test(fullResponse)});
      }
    }
  }

  function stopGenerating() {
    const requestId = refs.generationRequestId;
    if (!refs.abortController || !requestId) return;
    refs.stopRequested = true;
    chatSubmissionQueue.update(requestId, { stage: "cancelling", stage_detail: "Stopping the request and retaining any partial reply" });
    dispatch({ type: "SET_GENERATING", payload: false });
    showToast("Stopping generation...", "");
    void api.stopChat(requestId).catch(() => {});
    refs.abortController.abort();
  }

  function steerReply(event) {
    event.preventDefault();
    if (!canSteer || !steerDraft.trim()) return;
    if (!sendTextMessage(steerDraft.trim(), { steerAfter: refs.generationRequestId, steerReceipt: refs.replySaveReceipt })) return;
    stopGenerating(); setSteerOpen(false); setSteerDraft('');
    showToast('Steering queued after saving the partial reply.', 'success');
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
    <div id={pane.domId("input-area")}>
      {active && editJob?.sessionId === currentSessionId && privacy.ready && <ImageEditor key={editJob.id} inlineInput={editJob} onSave={saveChatEdit} onCancel={() => setEditJob(null)} />}
      {(openingEdit || selectedEdit) && <div className="chat-edit-selection" role="status"><span>{openingEdit ? "Opening image editor…" : `Edit: ${selectedEdit.image.name}`}</span>{selectedEdit && <button type="button" onClick={() => destinations.clearChatEdit()}>Clear selection</button>}</div>}
      {pendingImages.length>0 && <section aria-label="Pending attachments">{pendingRemoval.toolbar}<div className="pending-chat-images">{pendingImages.map(item=><article key={item.id}>{item.url && <img src={item.url} alt={item.file.name}/>}<span>{item.file.name}</span>{pendingRemoval.controls(item,item.file.name)}</article>)}</div></section>}
      <QueueRequestStatus requestId={refs.generationRequestId} />
      <small id={pane.domId("chat-clipboard-hint")} className={isUploading ? "chat-upload-status" : "composer-sr-only"} role="status">{isUploading ? "Saving attachment to chat…" : "Paste screenshots or files here with Ctrl+V. Review attachments, then Send."}</small>
      {chatSubmissions.some(job => job.status === "waiting" && job.pane_id === pane.id && job.session_id === currentSessionId) && <div className="chat-pending-requests" aria-label="Waiting chat prompts">
        {chatSubmissions.filter(job => job.status === "waiting" && job.pane_id === pane.id && job.session_id === currentSessionId).map(job => <div key={job.id}><span>{job.label}</span><button type="button" onClick={() => chatSubmissionQueue.cancel(job.id)}>Cancel waiting prompt</button></div>)}
      </div>}
      <div className="chat-composer-tools" ref={toolBarRef} role="group" aria-label="Chat tools">
        <ChatImageControls active={active} open={openTool === 'images'} onToggle={() => toggleTool('images')} onGenerate={generateChatImage} />
        <button className="chat-tool-button" type="button" disabled={openingEdit} title="Edit the latest or selected chat image" onClick={() => { setOpenTool(null); textareaRef.current.value = "/Edit "; textareaRef.current.focus(); }}>/Edit</button>
        <ChatAudio active={active} sessionId={currentSessionId} open={openTool === 'audio'} onToggle={() => toggleTool('audio')} onInsert={text => {
          const input = textareaRef.current;
          input.value = [input.value.trimEnd(), text].filter(Boolean).join('\n');
          handleInput(); input.focus(); setOpenTool(null);
        }}/>
        <button className="chat-tool-button" type="button" title="Create a Word document from your message" aria-label="Create Word document" onClick={() => { setOpenTool(null); textareaRef.current.value = "/docx " + (textareaRef.current.value || ""); handleInput(); textareaRef.current.focus(); }}>Word</button>
        <button className="chat-tool-button" type="button" aria-label="Internet / page import" aria-expanded={openTool === 'web'} aria-controls={pane.domId("chat-web-import")}
          title={webActivity.error || webActivity.message || "Import a public page"} onClick={() => toggleTool('web')}>
          Internet{webActivity.active ? ' •' : webActivity.error ? ' !' : webActivity.complete ? ' ✓' : ''}
        </button>
        <section id={pane.domId("chat-web-import")} className="chat-tool-panel chat-web-import" aria-label="Public page import" hidden={openTool !== 'web'}>
          <header><strong>Import a public page</strong><button type="button" className="chat-tool-button" onClick={() => { setOpenTool(null); toolBarRef.current?.querySelector('[aria-label="Internet / page import"]')?.focus(); }}>Close</button></header>
          <WebAccess embedded onOpenSession={onOpenSession} onActivity={setWebActivity} />
        </section>

      </div>
      {webActivity.active && openTool !== 'web' && <small className="chat-import-progress" role="status">{webActivity.message || 'Importing page…'} <button type="button" onClick={() => setOpenTool('web')}>View / stop</button></small>}
      <div id={pane.domId("input-row")} className="chat-input-row">
        <div className="attachment-menu-wrapper" ref={attachmentMenuRef}>
          <button
            id={pane.domId("attachment-menu-btn")}
            type="button"
            title="Add content"
            aria-label="Add content"
            aria-expanded={attachmentMenuOpen}
            aria-controls={pane.domId("attachment-menu")}
            disabled={isGenerating || isUploading}
            onClick={() => setAttachmentMenuOpen((open) => !open)}
          >
            +
          </button>
          <div
            id={pane.domId("attachment-menu")}
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
          id={pane.domId("chat-input")}
          aria-label="Message"
          placeholder="Type a message... (Shift+Enter for new line)"
          autoComplete="off"
          rows={1}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
        />
        <button
          id={pane.domId("send-btn")}
          title={chatSubmissions.length ? "Queue message" : "Send"}
          aria-label={chatSubmissions.length ? "Queue message" : "Send"}
          onClick={sendMessage}
          disabled={isUploading}
        >
          &#x2191;
        </button>
        {(steeringJob || steerDraft) && <button type="button" className="chat-steer-button" disabled={(!canSteer && !steerDraft) || isUploading}
          title="Save the partial reply, then continue with a new instruction" onClick={() => setSteerOpen(true)}>Steer</button>}
        <button
          id={pane.domId("stop-btn")}
          title="Stop generating"
          className={isGenerating ? "visible" : ""}
          onClick={stopGenerating}
        >
          &#x25A0;
        </button>
      </div>
      <dialog ref={steerDialog} className="chat-steer-dialog" aria-label="Steer reply" onCancel={event => { event.preventDefault(); setSteerOpen(false); }}>
        <form onSubmit={steerReply}>
          <h2>Steer reply</h2>
          <p>The current reply will stop and its text will be saved. Your instruction runs next in this chat; queued messages stay queued.</p>
          <label>New direction<textarea autoFocus aria-label="Steering instruction" value={steerDraft} maxLength={12000} onChange={event => setSteerDraft(event.target.value)} /></label>
          {!canSteer && <p role="status">This reply has finished or is saving. Close this window and send a follow-up message.</p>}
          <div><button type="submit" disabled={!canSteer || !steerDraft.trim() || isUploading}>Stop &amp; steer</button>
            <button type="button" onClick={() => setSteerOpen(false)}>Cancel</button></div>
        </form>
      </dialog>
      <FreshFileInput
        ref={imageInputRef}
        className="hidden-input"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        multiple
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
