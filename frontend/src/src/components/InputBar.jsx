import { useRef, useCallback } from "react";
import { useStore, useDispatch, useRefs } from "../useStore";
import * as api from "../api";

export default function InputBar({ onNewChat, onSessionSaved }) {
  const state = useStore();
  const dispatch = useDispatch();
  const refs = useRefs();
  const textareaRef = useRef(null);

  const {
    isGenerating,
    currentSessionId,
    conversationHistory,
    selectedModel,
    useKnowledgeBase,
    systemPrompt,
    temperature,
    topP,
    topK,
    repeatPenalty,
    responseLength,
    sessionTitle,
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
    const val = systemPrompt.trim();
    return val || null;
  }

  async function sendMessage() {
    const text = textareaRef.current?.value.trim();
    if (!text || isGenerating) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      await onNewChat();
      // Wait for state to settle — onNewChat sets the session
      // We'll use the returned value instead
      return;
    }

    // Clear input
    textareaRef.current.value = "";
    textareaRef.current.style.height = "44px";

    // Add user message
    const userMsg = { role: "user", content: text };
    dispatch({ type: "PUSH_MESSAGE", payload: userMsg });

    const updatedHistory = [...conversationHistory, userMsg];

    dispatch({ type: "SET_GENERATING", payload: true });

    // Create abort controller
    const abortController = new AbortController();
    refs.abortController = abortController;

    let fullResponse = "";

    try {
      const res = await api.streamChat({
        model: selectedModel,
        messages: updatedHistory.map((m) => ({ role: m.role, content: m.content })),
        useKnowledgeBase,
        systemPrompt: getSystemPromptValue(),
        options: getModelOptions(),
        signal: abortController.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Add empty assistant message that we'll update via DOM for streaming
      const assistantMsg = { role: "assistant", content: "" };
      dispatch({ type: "PUSH_MESSAGE", payload: assistantMsg });

      // We need to stream tokens into the last message element
      // Using a ref approach: find the last .message.assistant .content element
      await new Promise((resolve) => setTimeout(resolve, 50)); // Let React render

      const allContents = document.querySelectorAll(".message.assistant .content");
      const contentEl = allContents[allContents.length - 1];

      if (contentEl) {
        // Add cursor
        const cursor = document.createElement("span");
        cursor.className = "cursor";
        contentEl.appendChild(cursor);

        while (true) {
          const result = await reader.read();
          if (result.done) break;
          buffer += decoder.decode(result.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop();
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.token) {
                  fullResponse += data.token;
                  contentEl.textContent = fullResponse;
                  contentEl.appendChild(cursor);
                  // Scroll
                  const messagesEl = document.getElementById("messages");
                  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
                }
                if (data.done) break;
              } catch {}
            }
          }
        }

        // Remove cursor
        const cursorEl = contentEl.querySelector(".cursor");
        if (cursorEl) cursorEl.remove();
      }
    } catch (e) {
      if (e.name === "AbortError") {
        showToast("Generation stopped", "");
      } else {
        fullResponse = "[Error: Could not reach the backend. Is it running?]";
      }
    }

    // Save the assistant response to state properly
    if (fullResponse) {
      // Replace the empty assistant message with the real content
      // We need to rebuild history with the actual response
      const finalHistory = [
        ...updatedHistory,
        { role: "assistant", content: fullResponse },
      ];

      dispatch({
        type: "SET_SESSION",
        payload: {
          id: sessionId,
          messages: finalHistory,
          title: sessionTitle,
        },
      });

      // Auto-title: use first user message
      if (sessionTitle === "New Chat" && finalHistory.length >= 2) {
        const firstUserMsg = finalHistory.find(
          (m) => m.role === "user" && !m.content.startsWith("[File uploaded:")
        );
        if (firstUserMsg) {
          const newTitle =
            firstUserMsg.content.length > 50
              ? firstUserMsg.content.slice(0, 50) + "..."
              : firstUserMsg.content;
          dispatch({ type: "SET_SESSION_TITLE", payload: newTitle });
        }
      }

      // Save to backend
      await api.saveSession(sessionId, finalHistory, selectedModel);
      if (onSessionSaved) onSessionSaved();
    }

    dispatch({ type: "SET_GENERATING", payload: false });
    refs.abortController = null;
    textareaRef.current?.focus();
  }

  function stopGenerating() {
    if (refs.abortController) {
      refs.abortController.abort();
    }
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

  return (
    <div id="input-area">
      <div id="input-row">
        <textarea
          ref={textareaRef}
          id="chat-input"
          placeholder="Type a message... (Shift+Enter for new line)"
          autoComplete="off"
          rows={1}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
        />
        <button
          id="send-btn"
          title="Send"
          disabled={isGenerating}
          onClick={sendMessage}
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
    </div>
  );
}