import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider, useDispatch, useStore } from "../../src/useStore";
import AppLayout from "../../src/components/AppLayout";
import SidebarNavigation from "../../src/components/SidebarNavigation";
import PromptIndex from "../../src/components/PromptIndex";
import KnowledgeVault from "../../src/components/KnowledgeVault";
import "../../src/styles.css";

function Fixture() {
  const state = useStore(), dispatch = useDispatch();
  useEffect(() => { dispatch({ type: "SET_SIDEBAR_TAB", payload: "library" }); }, []);
  window.indexKnowledgeQA = { state, dispatch };
  return <AppLayout activeTab={state.activeSidebarTab} sidebar={() => <aside id="sidebar"><SidebarNavigation activeTab={state.activeSidebarTab} onSelect={tab => dispatch({ type: "SET_SIDEBAR_TAB", payload: tab })} /></aside>}>
    <div className="pane" data-capture-tab="library" hidden={state.activeSidebarTab !== "library"}><PromptIndex active={state.activeSidebarTab === "library"} /></div>
    <div className="pane" data-capture-tab="knowledge" hidden={state.activeSidebarTab !== "knowledge"}><KnowledgeVault active={state.activeSidebarTab === "knowledge"} /></div>
  </AppLayout>;
}
createRoot(document.getElementById("root")).render(<StoreProvider><Fixture /></StoreProvider>);
