# Two chats in one tab

In Chats, open **Workspace options → Side pane → Second chat**. Chat A stays in the main pane. In Chat B, choose an existing conversation or use **New Chat B**. Each pane has its own model selector, settings, message history, draft, and attachments. The sidebar marks open conversations as Chat A and Chat B. Opening a conversation that is already in Chat B focuses that pane.

Drag the divider to resize the chats, or focus it and use the arrow keys. Short windows stack the chats and allow the workspace to scroll. Closing Chat B hides its pane and keeps its draft; submitted requests continue and save to their original conversation. The second conversation selection is remembered for Chat A.

Prompts from both panes run in submission order. Follow-ups wait until earlier replies have been saved, so they use the updated history from their own conversation. Model/settings choices are captured when you press Send. A waiting prompt can be cancelled individually; Stop targets the running request in that pane.

When a two-chat request reaches the shared inference queue, the backend checks Ollama's loaded models, unloads other idle models, and loads the requested model. The check runs under the shared GPU lease. It never changes models just because you focus another pane, and it reuses the allocation for successive requests with the same model. Knowledge retrieval finishes before the final chat model handoff. Models are unloaded from memory, not removed from storage.

A floating request notice stays visible through queueing, preparation, model checks, switching/loading, replies, context compaction, and saving. Its × hides the notice without stopping requests. **Requests** reopens it, and new submissions can show it again. Each chat header and the live runtime indicator show the current operation; hovering explains the model being unloaded or loaded. The backend reports these stages in its chat stream, `/queue`, `/runtime/status`, and `/status`.

Validation uses automated queue/cancellation tests and the complete application UI against disposable session storage and a synthetic Ollama HTTP server. `node node_modules/electron/cli.js scripts/qa-dual-chat.cjs` exercises independent histories and model choices, A/B/A ordering, unload/load calls, dismissible status, background persistence, cancellation, two new chat creation, and the stacked layout. This validates the application protocol and UI; it does not measure real GPU loading speed or memory usage.
