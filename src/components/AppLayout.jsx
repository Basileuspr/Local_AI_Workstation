import { createContext, useEffect, useRef, useState } from "react";
import "./AppLayout.css";

const compactLayout = "(max-width: 900px)";
export const NavigationOpenContext = createContext(false);
const titles = { "image-editor": "Image Editor", "media-manager": "Media Manager", dashboard: "Dashboard", queue: "Prompt Queue", review: "Image Review", workflows: "Image Workflows", lora: "LoRA", faces: "Faces", "character-parts": "Character Parts", chats: "Chats", images: "Image Gallery", generate: "Generate Images", library: "Prompt Index", knowledge: "Knowledge", tools: "Functions" };

export default function AppLayout({ activeTab, sidebar, children, onRefresh, refreshing = false }) {
  const [compact, setCompact] = useState(() => window.matchMedia(compactLayout).matches);
  const [open, setOpen] = useState(false);
  const menuButton = useRef(null);
  const navigation = useRef(null);
  const closeButton = useRef(null);
  const wasOpen = useRef(false);
  const drawerOpen = compact && open;

  useEffect(() => {
    // Hidden elements report zero scroll offsets. Retain the last visible
    // position for inert background captures without scrolling the real pane.
    const rememberScroll = event => {
      const node = event.target;
      if (!node?.closest?.("#app") || !node.getClientRects().length) return;
      node.dataset.captureScrollTop = node.scrollTop;
      node.dataset.captureScrollLeft = node.scrollLeft;
    };
    document.addEventListener("scroll", rememberScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", rememberScroll, true);
  }, []);

  useEffect(() => window.workstationDesktop?.onMediaManagerNavigation?.(() => {
    if (compact) menuButton.current?.focus();
    else {
      const target = navigation.current?.querySelector('[data-media-manager-tab]');
      const collapsed = target?.closest('[hidden]');
      if (collapsed?.id) navigation.current?.querySelector(`[aria-controls="${collapsed.id}"]`)?.click();
      requestAnimationFrame(() => target?.focus());
    }
  }), [compact]);

  useEffect(() => {
    const query = window.matchMedia(compactLayout);
    const resize = () => { setCompact(query.matches); setOpen(false); };
    query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);

  function closeNavigation() {
    setOpen(false);
  }

  useEffect(() => {
    // Chats use the sidebar collection; other workspaces have their own pane.
    if (activeTab !== "chats") closeNavigation();
  }, [activeTab]);

  useEffect(() => {
    if (drawerOpen) closeButton.current?.focus();
    else if (wasOpen.current) {
      // Wait until React removes inert before restoring keyboard focus.
      if (compact) menuButton.current?.focus();
      else navigation.current?.querySelector("#new-chat-btn")?.focus();
    } else if (compact && navigation.current?.contains(document.activeElement)) {
      menuButton.current?.focus();
    }
    wasOpen.current = drawerOpen;
  }, [drawerOpen, compact]);

  function handleNavigationKey(event) {
    if (!drawerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeNavigation();
    } else if (event.key === "Tab") {
      const controls = [...navigation.current.querySelectorAll("button, a[href], input, select, textarea, summary, [tabindex]")]
        .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  return <div id="app" className={drawerOpen ? "navigation-open" : ""}>
    <div className="sidebar-shell" ref={navigation} inert={compact && !open}
      role={compact ? "dialog" : "navigation"} aria-label="App navigation" aria-modal={drawerOpen || undefined}
      onKeyDown={handleNavigationKey}>
      <button ref={closeButton} type="button" className="navigation-close" onClick={closeNavigation}>Close menu</button>
      {sidebar(closeNavigation)}
    </div>
    {drawerOpen && <div className="navigation-backdrop" aria-hidden="true" onClick={closeNavigation} />}
    <div id="main" inert={drawerOpen}>
      <div className="workspace-navigation">
        <button className="compact-menu-button" ref={menuButton} type="button" aria-controls="sidebar" aria-expanded={drawerOpen} onClick={() => setOpen(true)}>☰ Menu</button>
        <span>{titles[activeTab] || "Local AI Workstation"}</span>
        <button className="workspace-refresh" type="button" onClick={onRefresh} disabled={refreshing}
          title="Reload the app and stay in this workspace" aria-label={`Refresh ${titles[activeTab] || "workspace"}`}>
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>
      <NavigationOpenContext.Provider value={drawerOpen}>{children}</NavigationOpenContext.Provider>
    </div>
  </div>;
}
