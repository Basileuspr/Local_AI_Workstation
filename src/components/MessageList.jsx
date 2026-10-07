import FreshFileInput from "./FreshFileInput";
import ChatSpeak from './ChatSpeak';
import {chatSpeech} from '../chatSpeech';
import ProtectedImage from "../ImagePrivacy";
import ImageItemActions from "./ImageItemActions";
import { useEffect, useRef, useState } from "react";
import { useStore, useDispatch } from "../useStore.jsx";
import MarkdownMessage from "./MarkdownMessage";
import ChatMessageMarkdown from "./ChatMessageMarkdown";
import { useChatWorkspace } from "../ChatWorkspace";
import { useChatPane } from "../ChatPane";
import { createMessageId } from "../messageIds";
import { isImageFile, useChatUploads } from "../useChatUploads";
import { describeStatus } from "../serviceStatus";
import * as api from "../api";
import { isStoredReference } from "../imageRefs";
import ImageViewer from "./ImageViewer";
import DocumentViewer, { DocumentAttachment } from "./DocumentViewer";
import { chatImage } from "../chatImages";
import { ConvertedAttachment } from "./FileConverter";
import WebImageReader from "./WebImageReader";
import {ReplyInfluences} from './ChatInfluences';
import './ChatTranscript.css';

function summarizeContent(message) {
  const content = String(message.content || "");
  if (
    message.role === "user" &&
    content.startsWith("[File uploaded:")
  ) {
    return content.split("\n")[0];
  }
  if (
    message.role === "user" &&
    content.startsWith("[Image uploaded:")
  ) {
    return content.split("\n")[0];
  }
  return content;
}

function avatarFor(role) {
  if (role === "user") return "U";
  if (role === "assistant") return "AI";
  return "i";
}

export default function MessageList({ onNewChat, onSessionSaved }) {
  const state = useStore();
  const pane = useChatPane();
  const dispatch = useDispatch();
  const chatWorkspace = useChatWorkspace();
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [documentPreview, setDocumentPreview] = useState(null);
  useEffect(() => setDocumentPreview(null), [state.currentSessionId]);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const messageNodes = useRef(new Map());
  const transcript = useRef(null);
  const pinRequests = useRef(new Set());
  const [pinBusy, setPinBusy] = useState([]);
  const [pinsOpen, setPinsOpen] = useState(false);
  const { uploadFiles } = useChatUploads({ onNewChat, onSessionSaved });

  const { conversationHistory, scrollTargetMessageId } = state;
  const problem = describeStatus(state.serviceStatus);
  const { currentSessionId } = state;
  const pinnedMessages = conversationHistory.filter(message => message.pinned === true);
  useEffect(() => {
    setPinsOpen(false);
    if (transcript.current) transcript.current.dataset.followBottom = 'true';
  }, [currentSessionId]);
  function scrollToEnd(end) {
    const node = transcript.current;
    if (!node) return;
    node.dataset.followBottom = end === 'bottom' ? 'true' : 'false';
    node.scrollTo({ top: end === 'bottom' ? node.scrollHeight : 0, behavior: 'instant' });
  }
  async function togglePin(message) {
    if (!currentSessionId || !message.id || pinRequests.current.has(message.id)) return;
    const sessionId = currentSessionId;
    pinRequests.current.add(message.id); setPinBusy([...pinRequests.current]);
    try {
      const saved = await api.pinMessage(sessionId, message.id, !message.pinned);
      dispatch({ type: 'MESSAGE_PIN_SAVED', payload: saved });
      void Promise.resolve(onSessionSaved?.()).catch(() => {});
    } catch (error) { showToast(error.message || 'Could not save the message pin', 'error'); }
    finally { pinRequests.current.delete(message.id); setPinBusy([...pinRequests.current]); }
  }
  useEffect(() => {
    if (!pane.focused) return;
    chatSpeech.configure({sessionId:currentSessionId,active:state.activeSidebarTab === 'chats',preferences:state.voiceOutput});
  },[currentSessionId,state.activeSidebarTab,state.voiceOutput,pane.focused]);
  useEffect(() => () => chatSpeech.stop(),[]);

  /**
   * Where to load a message image from.
   *
   * Saved images are references, fetched from the backend on demand instead of
   * being carried inline. A just-attached image is still a data URL until the
   * save round-trip completes, so both forms render.
   */
  function imageSourceFor(image, messageId) {
    const value = image.src || image.url || image.data || "";
    if (isStoredReference(value) && currentSessionId && image.id) {
      return api.getSessionImageUrl(currentSessionId, messageId, image.id);
    }
    return value;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Command copied", "success");
    } catch {
      showToast("Copy failed", "error");
    }
  }

  useEffect(() => {
    if (!scrollTargetMessageId) return undefined;
    const timer = window.setTimeout(() => {
      const node = messageNodes.current.get(scrollTargetMessageId);
      if (node) {
        if (transcript.current) transcript.current.dataset.followBottom = 'false';
        node.scrollIntoView({ behavior: "instant", block: "center" });
        setHighlightedMessageId(scrollTargetMessageId);
        window.setTimeout(() => setHighlightedMessageId(""), 1500);
      }
      dispatch({ type: "CLEAR_SCROLL_TARGET" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dispatch, scrollTargetMessageId, conversationHistory]);

  function showToast(message, type) {
    dispatch({ type: "SHOW_TOAST", payload: { message, type } });
  }

  async function copyMessage(message, index) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedIndex(index);
      showToast("Copied", "success");
      window.setTimeout(() => setCopiedIndex(null), 1200);
    } catch {
      showToast("Copy failed", "error");
    }
  }

  // Presentation for this surface: progress appears inline in the transcript
  // rather than as a toast, since the user's attention is on the message list.
  async function handleFiles(files) {
    setDragActive(false);
    if (!currentSessionId) {
      window.dispatchEvent(new CustomEvent('stage-chat-images', { detail: Array.from(files), cancelable: true }));
      return;
    }
    const images = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (images.length) {
      const staged = new CustomEvent('stage-chat-images', {detail:images,cancelable:true});
      window.dispatchEvent(staged);
      if (staged.defaultPrevented) files = Array.from(files).filter(file => !images.includes(file));
    }
    if (!files.length) return;

    await uploadFiles(files, {
      onStart: (file) => {
        if (isImageFile(file)) return;
        // Transient: the save that follows replaces history without it.
        dispatch({
          type: "PUSH_MESSAGE",
          payload: {
            id: createMessageId(),
            role: "system",
            content: "Reading " + file.name + "...",
          },
        });
      },
      onSuccess: (file) =>
        showToast(
          isImageFile(file) ? "Image attached to chat" : "File loaded into chat",
          "success"
        ),
      onError: (error, file) => {
        if (isImageFile(file)) {
          showToast(
            error.userFacing ? error.message : "Image upload failed: " + error.message,
            "error"
          );
          return;
        }
        dispatch({
          type: "PUSH_MESSAGE",
          payload: {
            id: createMessageId(),
            role: "system",
            content: "Error reading file: " + error.message,
          },
        });
        showToast(error.userFacing ? error.message : "File read failed", "error");
      },
    });
  }

  return (
    <>
    <div className="chat-transcript-tools" aria-label="Chat navigation">
      <button type="button" disabled={!conversationHistory.length} onClick={() => scrollToEnd('top')} aria-label="Scroll to top of chat">↑ Top</button>
      <button type="button" disabled={!conversationHistory.length} onClick={() => scrollToEnd('bottom')} aria-label="Scroll to bottom of chat">↓ Bottom</button>
      <button type="button" disabled={!pinnedMessages.length} aria-expanded={pinsOpen} aria-controls={pane.domId('pinned-messages')}
        onClick={() => setPinsOpen(value => !value)}>Pinned ({pinnedMessages.length})</button>
    </div>
    {pinsOpen && <nav id={pane.domId('pinned-messages')} className="chat-pinned-messages" aria-label="Pinned messages">
      {pinnedMessages.map(message => <button type="button" key={message.id} onClick={() => {
        dispatch({ type: 'SET_SCROLL_TARGET', payload: message.id }); setPinsOpen(false);
      }}>{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'AI' : 'Info'} · {String(message.content || 'Image / attachment').replace(/\s+/g, ' ').slice(0, 100)}</button>)}
    </nav>}
    <div
      ref={transcript}
      id={pane.domId("messages")} className="chat-messages"
      onScroll={event => {
        const node = event.currentTarget;
        node.dataset.followBottom = String(node.scrollHeight - node.scrollTop - node.clientHeight < 64);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div id={pane.domId("drop-overlay")} className={dragActive ? "visible" : ""}>
        <div className="drop-icon">+</div>
        <div className="drop-text">Drop a file or image</div>
        <div className="drop-hint">txt, md, pdf, docx, png, jpg, webp</div>
      </div>

      {conversationHistory.length === 0 ? (
        <div id={pane.domId("welcome")}>
          <div className="icon">Local</div>
          <h2>Local AI Workstation</h2>
          {problem ? (
            // A first launch on an unfamiliar machine lands here. Say what is
            // wrong and exactly how to fix it, rather than "almost ready".
            <div className={`setup-notice ${problem.severity}`} role="status">
              <h3>{problem.title}</h3>
              <p>{problem.detail}</p>
              {problem.action && (
                <div className="setup-command">
                  <code>{problem.action}</code>
                  <button
                    type="button"
                    onClick={() => copyText(problem.action)}
                    title="Copy command"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p>Choose a model, type a message, or drop a document into the chat.</p>
          )}
          <button
            id={pane.domId("kb-upload-btn")}
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Add file to this chat
          </button>
        </div>
      ) : (
        <>
          <div className="chat-upload-control">
            <button
              id={pane.domId("kb-upload-btn")}
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              Add file to this chat
            </button>
          </div>

          {conversationHistory.map((message, index) => {
            const messageId = message.id || `legacy-${index}`;
            return (
              <div
              className={`message-wrapper ${message.pinned ? 'message-pinned' : ''} ${highlightedMessageId === messageId ? "message-target" : ""}`}
              key={messageId}
              data-message-id={messageId}
              ref={(node) => {
                if (node) messageNodes.current.set(messageId, node);
                else messageNodes.current.delete(messageId);
              }}
            >
              <div className={`message ${message.role}`}>
                <div className="avatar">{avatarFor(message.role)}</div>
                <div className="content">
                  {message.webSource && <WebImageReader images={message.imagePreviews}
                    sourceFor={image => imageSourceFor(image, messageId)} />}
                  {(message.imagePreviews?.length > 0 || message.generatedImages?.length > 0) && (
                    <div className="image-preview-grid">
                      {[...(message.imagePreviews || []), ...(message.generatedImages || [])].map((image, imageIndex) => (
                        <figure className="image-preview" key={image.id || imageIndex}>
                          <button type="button" className="chat-image-open" aria-label={`Enlarge ${image.name || "chat image"}`} onClick={() => setImagePreview(chatImage(image, messageId, currentSessionId, imageIndex, imageSourceFor(image, messageId)))}><ProtectedImage
                            src={imageSourceFor(image, messageId)}
                            alt={image.name || "Generated image"}
                            loading="lazy"
                          /></button>
                          <figcaption>{image.name || "Generated image"}</figcaption>
                          <ImageItemActions chat image={chatImage(image, messageId, currentSessionId, imageIndex, imageSourceFor(image, messageId))} />
                        </figure>
                      ))}
                    </div>
                  )}
                  {summarizeContent(message) === message.content
                    ? <ChatMessageMarkdown key={`${currentSessionId}:${messageId}`} message={message} sessionId={currentSessionId}
                        streaming={state.isGenerating && index === conversationHistory.length - 1}
                        onImageClick={image => setImagePreview({ ...image, chat_session_id: currentSessionId, id: `${messageId}:inline:${image.url}` })} />
                    : <MarkdownMessage>{summarizeContent(message)}</MarkdownMessage>}
                  {message.role==='assistant'&&message.content&&<ReplyInfluences message={message}/>}
                  {message.knowledge_sources && <details className="knowledge-sources"><summary>Knowledge supplied: {message.knowledge_sources.length} excerpts</summary>
                    {message.knowledge_sources.length ? <ul>{message.knowledge_sources.map((source, i) => <li key={i}>{source.filename} — excerpt {source.chunk_index + 1}, {source.characters} characters</li>)}</ul> : <p>No Knowledge excerpts were supplied for this reply.</p>}
                  </details>}
                  {(message.artifacts || []).filter(artifact => artifact.kind === "docx").map(artifact => <DocumentAttachment key={artifact.id} artifact={artifact}
                    onView={chatWorkspace ? item => chatWorkspace.setPin({ kind: "document", artifactId: item.id }) : setDocumentPreview}
                    besideChat={!!chatWorkspace} />)}
                  {(message.artifacts || []).filter(artifact => artifact.kind === "converted-image").map(artifact => <ConvertedAttachment key={artifact.id} artifact={artifact} />)}
                  {!!message.tool_activity?.length && <details className="chat-tool-history"><summary>Tool activity</summary>
                    <ul>{message.tool_activity.filter(item => item.status !== 'validating').map((item, toolIndex) =>
                      <li key={toolIndex}>{item.name || item.tool_id}: {item.status}</li>)}</ul>
                  </details>}
                  {message.canvas_applied && <button type="button" onClick={() => dispatch({ type: "SET_SIDEBAR_TAB", payload: "canvas" })}>Open Canvas</button>}
                </div>
              </div>
              <div className="message-actions">
                <button type="button" className="message-pin-btn" aria-pressed={message.pinned === true}
                  disabled={!currentSessionId || !message.id || pinBusy.includes(message.id) || (state.isGenerating && index === conversationHistory.length - 1)}
                  title={message.pinned ? 'Remove this message from pinned messages' : 'Pin this message in this conversation'}
                  onClick={() => togglePin(message)}>{message.pinned ? 'Unpin' : 'Pin'}</button>
                {message.role === 'assistant' && message.content && <ChatSpeak message={{...message,id:messageId}} sessionId={currentSessionId} active={state.activeSidebarTab === 'chats'} streaming={state.isGenerating && index === conversationHistory.length - 1}/>}
                <button
                  className={`copy-btn ${copiedIndex === index ? "copied" : ""}`}
                  type="button"
                  onClick={() => copyMessage(message, index)}
                >
                  {copiedIndex === index ? "Copied" : "Copy"}
                </button>
              </div>
              </div>
            );
          })}
        </>
      )}

      <FreshFileInput
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <ImageViewer images={imagePreview ? [imagePreview] : []} selectedId={imagePreview?.id} onSelect={() => {}} onClose={() => setImagePreview(null)} active={["chats", "knowledge"].includes(state.activeSidebarTab)} />
      <DocumentViewer artifact={documentPreview} onClose={() => setDocumentPreview(null)} active={["chats", "knowledge"].includes(state.activeSidebarTab)} />
    </div>
    </>
  );
}
