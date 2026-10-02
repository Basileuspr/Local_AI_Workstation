import React, { useContext, useState } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider } from "../../src/useStore";
import AppLayout, { NavigationOpenContext } from "../../src/components/AppLayout";
import ShortcutRegistry from "../../src/components/ShortcutRegistry";
import { appTabs, appTabLabels } from "../../src/navigation";
import { useLoraInfo } from "../../src/workspaceInfoContext";
import "../../src/styles.css";

function ExamplePane({ tab }) {
  const [rate, setRate] = useState(0.00005);
  const covered = useContext(NavigationOpenContext);
  useLoraInfo(tab === "lora" ? rate : undefined);
  return <section style={{padding:24}}><h1>{appTabLabels[tab]}</h1>
    <textarea aria-label={`${tab} draft`} placeholder="A draft to keep while opening Info" />
    {tab === "lora" && <label>Learning rate<input aria-label="Learning rate" type="number" value={rate} onChange={event => setRate(Number(event.target.value))} /></label>}
    {tab === "media-manager" && <p role="status">{covered ? "Embedded view covered by dialog" : "Embedded view visible"}</p>}
  </section>;
}
// Only the LoRA pane registers live values; other fixture panes are plain drafts.
function PlainPane({ tab }) {
  const covered = useContext(NavigationOpenContext);
  return <section style={{padding:24}}><h1>{appTabLabels[tab]}</h1><textarea aria-label={`${tab} draft`} placeholder="A draft to keep while opening Info" />
    {tab === "media-manager" && <p role="status">{covered ? "Embedded view covered by dialog" : "Embedded view visible"}</p>}
  </section>;
}
function Fixture() {
  const [tab, setTab] = useState("shortcuts"), [pinned, setPinned] = useState(null);
  return <AppLayout activeTab={tab} pinnedTab={pinned} pinnedTitle={appTabLabels[pinned]} onUnpin={() => setPinned(null)} onRefresh={() => {}}
    sidebar={() => <nav style={{padding:12,overflowY:"auto",height:"100%"}} aria-label="Preview workspaces">
      {appTabs.map(id => <button key={id} type="button" style={{display:"block",marginBottom:5}} onClick={() => setTab(id)}>{appTabLabels[id]}</button>)}
      <button type="button" onClick={() => {setPinned("shortcuts");setTab("chats");}}>Pin reference in preview</button>
    </nav>}>
    {appTabs.map(id => <div key={id} data-capture-tab={id} className="tab-content" style={{display:id === tab || (tab === "chats" && pinned === id) ? "flex" : "none",overflow:"auto"}}>
      {id === "shortcuts" ? <ShortcutRegistry /> : id === "lora" ? <ExamplePane tab={id} /> : <PlainPane tab={id} />}
    </div>)}
  </AppLayout>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><StoreProvider><Fixture /></StoreProvider></React.StrictMode>);
