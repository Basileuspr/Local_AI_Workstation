import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useStore, useDispatch } from "../../src/useStore";
import { ChatWorkspaceProvider, useChatWorkspace } from "../../src/ChatWorkspace";
import { workspaceVisible } from "../../src/chatPins";
import { resolveActiveTab } from "../../src/navigation";
import AppLayout from "../../src/components/AppLayout";
import SidebarNavigation from "../../src/components/SidebarNavigation";
import ShortcutRegistry from "../../src/components/ShortcutRegistry";
import "../../src/styles.css";

function Fixture() {
  const state = useStore(), dispatch = useDispatch(), workspace = useChatWorkspace();
  const tab = resolveActiveTab(state.activeSidebarTab);
  useEffect(() => { dispatch({ type: "SET_SIDEBAR_TAB", payload: "shortcuts" }); }, [dispatch]);
  return <AppLayout activeTab={tab} pinnedTab={workspace.pin?.tab} pinnedTitle={workspace.title} onUnpin={() => workspace.setPin(null)} onRefresh={() => location.reload()}
    sidebar={() => <SidebarNavigation activeTab={tab} onSelect={value => dispatch({ type: "SET_SIDEBAR_TAB", payload: value })} />}>
    <div className="pane chat-pane" data-capture-tab="chats" hidden={!workspaceVisible(tab, workspace.pin, "chats")}><section className="tools-workspace"><h1>Chat fixture</h1><p>No backend requests are made by this fixture.</p><textarea aria-label="Chat draft" placeholder="Keep a draft here while reading the reference" /></section></div>
    <div className="pane" data-capture-tab="shortcuts" hidden={!workspaceVisible(tab, workspace.pin, "shortcuts")}><ShortcutRegistry /></div>
  </AppLayout>;
}
function IconUploadProbe() {
  if (!new URLSearchParams(location.search).has("icons-check")) return null;
  function upload(invalid = false) {
    const input = document.querySelector('.registry-icon-editor input[type="file"]');
    if (!input) return;
    const bytes = invalid ? '<svg onload="alert(1)"/>' : Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII="), character => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "fixture-icon.png", { type: "image/png" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return <aside style={{position:"fixed",bottom:8,right:8,zIndex:1000,display:"flex",gap:8}}>
    <button onClick={() => upload()}>Upload fixture icon</button>
    <button onClick={() => upload(true)}>Upload invalid fixture icon</button>
  </aside>;
}
createRoot(document.getElementById("root")).render(<StoreProvider><ChatWorkspaceProvider><Fixture /><IconUploadProbe /></ChatWorkspaceProvider></StoreProvider>);
