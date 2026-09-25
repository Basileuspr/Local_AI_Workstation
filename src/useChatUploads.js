/**
 * Shared implementation behind every "put a file into this chat" entry point.
 *
 * Entry points include clipboard paste and the attachment menu beside the
 * message box, plus "Add file to this chat" and transcript drag-and-drop. Only the
 * work underneath is shared: validation, reading, message construction,
 * persistence, and error handling.
 *
 * Presentation stays with the caller. Each upload accepts onStart/onSuccess/
 * onError callbacks so one surface can raise a toast while the other writes a
 * transient system message into the transcript.
 */

import { useCallback, useRef, useState } from "react";
import { useStore, useDispatch } from "./useStore.jsx";
import * as api from "./api";
import { createMessageId } from "./messageIds";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isImageFile(file) {
  return IMAGE_TYPES.has(file?.type);
}

/**
 * An error whose message is already written for the user.
 *
 * Callers prefix unexpected failures ("Image upload failed: ...") but show
 * these verbatim, which keeps each surface's existing wording intact.
 */
function userFacingError(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}

/** Returns an error message, or null when the file is acceptable. */
export function validateImageFile(file) {
  if (!file) return "No image selected";
  if (!isImageFile(file)) return "Unsupported image format";
  if (file.size > MAX_IMAGE_BYTES) return "Image is larger than 10 MB";
  return null;
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",")[1];
      if (!base64) {
        reject(new Error("Could not read image data"));
        return;
      }
      resolve({ dataUrl, base64 });
    };
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

export function buildImageMessage(file, dataUrl, base64) {
  return {
    id: createMessageId(),
    role: "user",
    content:
      "[Image uploaded: " +
      file.name +
      " (" +
      Math.round(file.size / 1024).toLocaleString() +
      " KB)]",
    // The raw payload is what Ollama consumes; the preview is what the UI draws.
    images: [base64],
    imagePreviews: [
      {
        id: createMessageId(),
        src: dataUrl,
        name: file.name,
        type: file.type,
        size: file.size,
      },
    ],
  };
}

export function buildDocumentMessage(parsed) {
  const ocrSummary = parsed.ocr_pages?.length
    ? `; OCR ${parsed.ocr_pages.length}/${parsed.page_count} pages`
    : "";
  return {
    id: createMessageId(),
    role: "user",
    content:
      "[File uploaded: " +
      parsed.filename +
      " (" +
      parsed.char_count +
      " characters" +
      ocrSummary +
      ")]\n\nContents:\n" +
      parsed.text,
  };
}

export function useChatUploads({ onNewChat, onSessionSaved } = {}) {
  const state = useStore();
  const dispatch = useDispatch();
  const [isUploading, setIsUploading] = useState(false);
  // Guards against a second upload starting while one is mid-flight, which
  // would otherwise race on the same conversation history.
  const busyRef = useRef(false);
  const currentSessionRef = useRef(state.currentSessionId);
  currentSessionRef.current = state.currentSessionId;

  const {
    currentSessionId,
    conversationHistory,
    selectedModel,
    sessionTitle,
  } = state;

  /**
   * Resolve the session to write into, creating one when the app has none.
   *
   * Returns the session's own messages and title rather than the values closed
   * over from render: when a session is created here, the surrounding closure
   * still describes the previous one.
   */
  const resolveTarget = useCallback(async () => {
    if (currentSessionId) {
      return { id: currentSessionId, messages: conversationHistory, title: sessionTitle };
    }
    const session = await onNewChat?.();
    if (!session?.id) return null;
    return { id: session.id, messages: [], title: session.title || "New Chat" };
  }, [currentSessionId, conversationHistory, sessionTitle, onNewChat]);

  const commit = useCallback(
    async (sessionId, message) => {
      // Append on the server so another upload/reply cannot be overwritten by
      // the history captured before a slow clipboard image finished reading.
      const saved = await api.appendSessionMessages(sessionId, [message], selectedModel);
      if (currentSessionRef.current === sessionId) {
        dispatch({
          type: "SET_SESSION",
          payload: {
            id: sessionId,
            messages: saved.messages,
            title: saved.title,
            memorySummary: saved.memory_summary || "",
            summarizedMessageCount: saved.summarized_message_count || 0,
          },
        });
        dispatch({ type: "SET_SCROLL_TARGET", payload: message.id });
      }
      // A sidebar refresh failure must not imply the saved attachment was lost.
      try { await onSessionSaved?.(); }
      catch (error) { console.warn("Could not refresh chats after attaching a file", error); }
      return saved;
    },
    [dispatch, selectedModel, onSessionSaved]
  );

  /**
   * Append one file to `target`, keeping every file in a batch in that chat.
   */
  const appendFile = useCallback(
    async (file, target, { onStart, onSuccess, onError } = {}) => {
      const image = isImageFile(file);

      if (file?.type?.startsWith("image/") && !image) {
        onError?.(userFacingError("Unsupported image format. Paste a PNG, JPEG, or WebP image."), file);
        return null;
      }

      if (image) {
        const problem = validateImageFile(file);
        if (problem) {
          onError?.(userFacingError(problem), file);
          return null;
        }
      }

      try {
        onStart?.(file);
        const message = image
          ? await (async () => {
              const { dataUrl, base64 } = await readImageFile(file);
              return buildImageMessage(file, dataUrl, base64);
            })()
          : buildDocumentMessage(await api.parseFile(file));

        const saved = await commit(target.id, message);
        onSuccess?.(file);
        return { ...target, messages: saved.messages, title: saved.title };
      } catch (error) {
        onError?.(error, file);
        return null;
      }
    },
    [commit]
  );

  const runExclusive = useCallback(async (work, callbacks, file) => {
    if (busyRef.current) {
      callbacks?.onError?.(userFacingError("An attachment is already being saved. Wait for it to finish, then try again."), file);
      return false;
    }
    busyRef.current = true;
    setIsUploading(true);
    try {
      return await work();
    } catch (error) {
      callbacks?.onError?.(error, file);
      return false;
    } finally {
      busyRef.current = false;
      setIsUploading(false);
    }
  }, []);

  /** Upload a single image. Rejects non-images and oversized files. */
  const uploadImage = useCallback(
    (file, callbacks = {}) =>
      runExclusive(async () => {
        const target = await resolveTarget();
        if (!target) {
          callbacks.onError?.(userFacingError("Could not create a session"), file);
          return false;
        }
        return Boolean(await appendFile(file, target, callbacks));
      }, callbacks, file),
    [runExclusive, resolveTarget, appendFile]
  );

  /** Upload a single document, parsed server-side into chat context. */
  const uploadDocument = useCallback(
    (file, callbacks = {}) =>
      runExclusive(async () => {
        const target = await resolveTarget();
        if (!target) {
          callbacks.onError?.(userFacingError("Could not create a session"), file);
          return false;
        }
        return Boolean(await appendFile(file, target, callbacks));
      }, callbacks, file),
    [runExclusive, resolveTarget, appendFile]
  );

  /**
   * Upload several files, routing each by type.
   *
   * Server-side append keeps every file without replacing concurrent replies.
   */
  const uploadFiles = useCallback(
    (files, callbacks = {}) =>
      runExclusive(async () => {
        const list = Array.from(files || []);
        if (list.length === 0) return false;

        let target = await resolveTarget();
        if (!target) {
          callbacks.onError?.(userFacingError("Could not create a session"), list[0]);
          return false;
        }

        let uploaded = 0;
        for (const file of list) {
          const next = await appendFile(file, target, callbacks);
          if (next) {
            target = next;
            uploaded += 1;
          }
        }
        return uploaded > 0;
      }, callbacks, files?.[0]),
    [runExclusive, resolveTarget, appendFile]
  );

  return { uploadImage, uploadDocument, uploadFiles, isUploading };
}
