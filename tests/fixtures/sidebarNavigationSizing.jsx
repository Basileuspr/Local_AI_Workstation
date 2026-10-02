import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider } from "../../src/useStore";
import AppLayout from "../../src/components/AppLayout";
import SidebarNavigation from "../../src/components/SidebarNavigation";
import { appTabs, appTabLabels } from "../../src/navigation";
import "../../src/styles.css";

function Fixture() {
  const [tab, setTab] = useState("chats"), [short, setShort] = useState(false);
  return <>
    <div style={{height:42,padding:6}}><button onClick={() => setShort(value => !value)}>Toggle short window</button><span style={{marginLeft:12}}>Local preview; no user data or backend requests.</span></div>
    <div className="sidebar-sizing-fixture" style={{height:short ? 440 : "calc(100dvh - 42px)"}}>
      <AppLayout activeTab={tab} onRefresh={() => location.reload()} sidebar={() => <div id="sidebar">
        <div id="sidebar-header"><button id="new-chat-btn" onClick={() => setTab("chats")}>+ New Chat</button></div>
        <SidebarNavigation activeTab={tab} onSelect={setTab} />
        <div id="sidebar-content"><h2 className="sidebar-content-heading">Preview chats</h2>{Array.from({length:20},(_,i)=><button className="session-item" key={i}>Preview conversation {i+1}</button>)}</div>
        <div id="sidebar-footer"><span>GPU/model runtimes idle</span><button className="runtime-reset-btn" disabled>Reset / Unload</button></div>
      </div>}>
        {appTabs.map(id => <div key={id} data-capture-tab={id} className="tab-content" style={{display:id === tab ? "flex" : "none",padding:24}}><h1>{appTabLabels[id]}</h1><textarea aria-label={`${id} draft`} placeholder="Draft remains when navigating" /></div>)}
      </AppLayout>
    </div>
    <style>{`.sidebar-sizing-fixture > #app {height:100%;}.sidebar-sizing-fixture #sidebar-content .session-item {display:block;width:100%;}`}</style>
  </>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><StoreProvider><Fixture /></StoreProvider></React.StrictMode>);
