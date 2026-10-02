import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useStore, useDispatch } from "./useStore";
import { CHAT_PINS_KEY, loadChatPins, validChatPin, pinnableTabs } from "./chatPins";
import { appTabLabels } from "./navigation";

const Context = createContext(null);
export const useChatWorkspace = () => useContext(Context);

export function ChatWorkspaceProvider({ children }) {
  const state = useStore(), dispatch = useDispatch();
  const [pins, setPins] = useState(loadChatPins), [storageError, setStorageError] = useState("");
  const key = state.currentSessionId || "draft";
  const previous = useRef(state.currentSessionId), seen = useRef(null);
  const checklistDrafts = useRef(new Map());
  const pin = Object.hasOwn(pins, key) ? pins[key] : null;
  function setPin(value) {
    const clean = validChatPin(value);
    setPins(current => { const next = { ...current }; if (clean) next[key] = clean; else delete next[key]; return next; });
  }
  useEffect(() => {
    try { localStorage.setItem(CHAT_PINS_KEY, JSON.stringify(pins)); setStorageError(""); }
    catch { setStorageError("The side pane works, but its selection could not be remembered on this device."); }
  }, [pins]);
  useEffect(() => {
    if (!previous.current && state.currentSessionId) setPins(current => {
      if (!current.draft) return current;
      const next = { ...current, [key]: current[key] || current.draft }; delete next.draft; return next;
    });
    previous.current = state.currentSessionId;
  }, [state.currentSessionId, key]);
  useEffect(() => {
    const artifacts = state.conversationHistory.flatMap(message => (message.artifacts || []).filter(item => item.kind === "docx"));
    const ids = new Set(artifacts.map(item => item.id));
    // Loading a historical chat does not open an old attachment unexpectedly.
    if (seen.current?.key === key && state.activeSidebarTab === "chats") {
      const created = artifacts.filter(item => !seen.current.ids.has(item.id)).at(-1);
      if (created) setPin({ kind: "document", artifactId: created.id });
    }
    seen.current = { key, ids };
  }, [key, state.conversationHistory, state.activeSidebarTab]);
  const artifact = pin?.kind === "document" ? state.conversationHistory.flatMap(message => message.artifacts || []).find(item => item.id === pin.artifactId && item.kind === "docx") : null;
  const message = pin?.kind === "message" ? state.conversationHistory.find(item => item.id === pin.messageId) : null;
  const title = pin?.kind === "tool" ? appTabLabels[pin.tab] : pin?.kind === "document" ? artifact?.name || "Document" : "Checklist";
  function pinTool(tab) { setPin({ kind: "tool", tab }); dispatch({ type: "SET_SIDEBAR_TAB", payload: "chats" }); }
  return <Context.Provider value={{ pin, setPin, pinTool, artifact, message, title, storageError, checklistDrafts }}>{children}</Context.Provider>;
}

export function ChatPinControls({ activeTab }) {
  const workspace = useChatWorkspace();
  if (!workspace) return null;
  if (activeTab !== "chats") return pinnableTabs.includes(activeTab)
    ? <button type="button" onClick={() => workspace.pinTool(activeTab)} title="Keep this tool open beside the current chat">Pin beside chat</button> : null;
  return <label className="chat-pin-picker">Side pane
    <select aria-label="Pin tool beside chat" value={workspace.pin?.kind === "tool" ? workspace.pin.tab : workspace.pin ? "attachment" : ""}
      onChange={event => workspace.setPin(event.target.value ? { kind: "tool", tab: event.target.value } : null)}>
      <option value="">None</option>
      {workspace.pin && workspace.pin.kind !== "tool" && <option value="attachment" disabled>{workspace.title}</option>}
      {pinnableTabs.map(tab => <option value={tab} key={tab}>{appTabLabels[tab]}</option>)}
    </select>
  </label>;
}
