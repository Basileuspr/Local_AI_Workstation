import FreshFileInput from "./FreshFileInput";
import ProtectedImage from "../ImagePrivacy";
import { useEffect, useRef, useState } from "react";
import { useStore, useDispatch } from "../useStore.jsx";
import MarkdownMessage from "./MarkdownMessage";
import { createMessageId } from "../messageIds";
import { isImageFile, useChatUploads } from "../useChatUploads";
import { SEVERITY, describeStatus } from "../serviceStatus";
import * as api from "../api";
import { isStoredReference } from "../imageRefs";

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
  const dispatch = useDispatch();
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState("");
  const messageNodes = useRef(new Map());
  const { uploadFiles } = useChatUploads({ onNewChat, onSessionSaved });

  const { conversationHistory, scrollTargetMessageId } = state;
  const problem = describeStatus(state.serviceStatus);
  const { currentSessionId } = state;

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
        node.scrollIntoView({ behavior: "smooth", block: "center" });
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
    <div
      id="messages"
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
      <div id="drop-overlay" className={dragActive ? "visible" : ""}>
        <div className="drop-icon">+</div>
        <div className="drop-text">Drop a file or image</div>
        <div className="drop-hint">txt, md, pdf, docx, png, jpg, webp</div>
      </div>

      {conversationHistory.length === 0 ? (
        <div id="welcome">
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
              {problem.severity === SEVERITY.blocked && (
                <p className="setup-hint">
                  The app will pick this up automatically once it is running.
                </p>
              )}
            </div>
          ) : (
            <p>Choose a model, type a message, or drop a document into the chat.</p>
          )}
          <button
            id="kb-upload-btn"
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
              id="kb-upload-btn"
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
              className={`message-wrapper ${highlightedMessageId === messageId ? "message-target" : ""}`}
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
                  {(message.imagePreviews?.length > 0 || message.generatedImages?.length > 0) && (
                    <div className="image-preview-grid">
                      {[...(message.imagePreviews || []), ...(message.generatedImages || [])].map((image, imageIndex) => (
                        <figure className="image-preview" key={image.id || imageIndex}>
                          <ProtectedImage
                            src={imageSourceFor(image, messageId)}
                            alt={image.name || "Generated image"}
                            loading="lazy"
                          />
                          <figcaption>{image.name || "Generated image"}</figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
                  <MarkdownMessage>{summarizeContent(message)}</MarkdownMessage>
                </div>
              </div>
              <div className="message-actions">
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
    </div>
  );
}
