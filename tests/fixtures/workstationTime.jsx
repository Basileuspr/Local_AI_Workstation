import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AppLayout from "../../src/components/AppLayout";
import ViewerBrowser from "../../src/components/ViewerBrowser";
import MediaManager from "../../src/components/MediaManager";
import { StoreProvider } from "../../src/useStore";
import "../../src/styles.css";

// Simulated IPC only: no real native views, network, models, or user data.
const browserState = { ready: true, url: "https://fixture.invalid/", title: "Simulated browser", revision: 1 };
function showPlacement(kind, placement) {
  const output = document.querySelector(`[data-placement="${kind}"]`);
  if (output) output.textContent = JSON.stringify(placement);
  return Promise.resolve();
}
window.workstationDesktop = {
  startViewerBrowser: async () => browserState, viewerBrowserState: async () => browserState,
  placeViewerBrowser: placement => showPlacement("browser", placement),
  startMediaManager: async () => ({ ready: true }), mediaManagerStatus: async () => ({ ready: true }),
  placeMediaManager: placement => showPlacement("media", placement),
};
function Fixture() {
  const [tab, setTab] = useState("browser");
  return <AppLayout activeTab={tab} onRefresh={() => location.reload()} sidebar={() => <div id="sidebar">
    <div id="sidebar-header"><button id="new-chat-btn" onClick={() => setTab("chats")}>Chat</button></div>
    <div id="sidebar-content"><button onClick={() => setTab("browser")}>Browser fixture</button><button onClick={() => setTab("media-manager")}>Media fixture</button>
      <p>Simulated native placement:</p><pre data-placement="browser"/><pre data-placement="media"/></div>
  </div>}>
    <div className="pane" data-capture-tab="browser" hidden={tab !== "browser"}><ViewerBrowser active={tab === "browser"}/></div>
    <div className="pane" data-capture-tab="media-manager" hidden={tab !== "media-manager"}><MediaManager active={tab === "media-manager"}/></div>
    <div className="pane" data-capture-tab="chats" hidden={tab !== "chats"}><textarea aria-label="Chat draft"/></div>
  </AppLayout>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><StoreProvider><Fixture /></StoreProvider></React.StrictMode>);
