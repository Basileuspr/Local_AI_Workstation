import { createContext, useContext, useRef, useState } from "react";

const PaneContext = createContext({ id: "primary", label: "Chat A", dual: false, focused: true,
  domId: value => value, focus: () => {} });
const DualContext = createContext(null);
export const useChatPane = () => useContext(PaneContext);
export const useDualChat = () => useContext(DualContext);

export function DualChatProvider({ children }) {
  const [focused, setFocused] = useState("primary");
  const [secondary, setSecondary] = useState({ sessionId: null, title: "New Chat" });
  const controller = useRef(null);
  return <DualContext.Provider value={{ focused, setFocused, secondary, setSecondary, controller }}>{children}</DualContext.Provider>;
}

export function ChatPaneProvider({ id, dual = false, children }) {
  const chats = useDualChat();
  const focused = !chats || chats.focused === id;
  const value = { id, label: id === "primary" ? "Chat A" : "Chat B", dual, focused,
    domId: name => id === "primary" ? name : `${name}-secondary`,
    focus: () => chats?.setFocused(id) };
  return <PaneContext.Provider value={value}>
    <section className={`chat-session-surface${focused ? " focused-chat" : ""}`} data-chat-pane={id}
      aria-label={value.label} onFocusCapture={value.focus} onPointerDownCapture={value.focus}>{children}</section>
  </PaneContext.Provider>;
}
