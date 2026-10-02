import { Children, cloneElement, isValidElement, createContext, useEffect, useRef, useState } from "react";
import { DesktopCapabilitiesProvider, StartupNotice, WorkspaceBoundary } from "./Compatibility";
import "./AppLayout.css";
import { ChatPinControls } from "../ChatWorkspace";
import { useStore } from "../useStore";
import ResizableDivider from "./ResizableDivider";
import { clampLayoutValue, DIVIDER_SIZE, loadWorkspaceLayout, saveWorkspaceLayout, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX, SPLIT_DEFAULTS, splitLimits } from "../workspaceLayout";
import "./ChatWorkspace.css";

const compactLayout = "(max-width: 900px)";
export const NavigationOpenContext = createContext(false);
const titles = { shortcuts: "Shortcut Registry", audio: "Audio", spreadsheets: "Spreadsheets", canvas: "Canvas", converter: "File Converter", packager: "Packager", "gif-maker": "GIF Maker", browser: "Browser", "js-viewer": "JavaScript Viewer", markdown: "Markdown Viewer", "html-viewer": "HTML Viewer", "css-viewer": "CSS / Styling", "image-editor": "Image Editor", "media-manager": "Media Manager", dashboard: "Dashboard", queue: "Prompt Queue", review: "Image Review", workflows: "Image Workflows", lora: "LoRA", faces: "Faces", characters: "Character Creator", "character-parts": "Character Parts", chats: "Chats", images: "Image Gallery", generate: "Generate Images", library: "Prompt Index", knowledge: "Knowledge", tools: "Functions" };

export default function AppLayout({ activeTab, sidebar, children, onRefresh, refreshing = false, pinnedTab = null, pinnedTitle, onUnpin, pinNotice }) {
  const sessionId = useStore()?.currentSessionId || "draft";
  const [layout, setLayout] = useState(loadWorkspaceLayout);
  const [compact, setCompact] = useState(() => window.matchMedia(compactLayout).matches);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const panes = useRef(null);
  const previousSession = useRef(sessionId);
  const menuButton = useRef(null);
  const navigation = useRef(null);
  const closeButton = useRef(null);
  const wasOpen = useRef(false);
  const drawerOpen = compact && open;
  const navigationHidden = compact ? !open : layout.sidebarCollapsed;
  const split = activeTab === "chats" && !!pinnedTab;
  const stacked = paneSize.width > 0 && paneSize.width <= 820;
  const axis = stacked ? "vertical" : "horizontal";
  const limits = splitLimits(stacked ? paneSize.height : paneSize.width, axis);
  const ratio = clampLayoutValue(layout.splits[sessionId]?.[axis] ?? SPLIT_DEFAULTS[axis], limits.min, limits.max);

  useEffect(() => saveWorkspaceLayout(layout), [layout]);
  useEffect(() => {
    if (previousSession.current === "draft" && sessionId !== "draft") {
      setLayout(current => current.splits.draft && !current.splits[sessionId]
        ? { ...current, splits: { ...current.splits, [sessionId]: current.splits.draft } } : current);
    }
    previousSession.current = sessionId;
  }, [sessionId]);
  useEffect(() => {
    const update = () => {
      const { width, height } = panes.current.getBoundingClientRect();
      setPaneSize(current => current.width === width && current.height === height ? current : { width, height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(panes.current); update();
    return () => observer.disconnect();
  }, []);

  function changeRatio(next) {
    setLayout(current => ({ ...current, splits: { ...current.splits,
      [sessionId]: { ...current.splits[sessionId], [axis]: next } } }));
  }
  function toggleNavigation() {
    if (compact) setOpen(current => !current);
    else setLayout(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));
  }

  useEffect(() => {
    // Native Browser/Media Manager surfaces must not cover a dialog opened in chat.
    const update = () => setModalOpen(!!document.querySelector("dialog[open]"));
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    update();
    return () => observer.disconnect();
  }, []);

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
      setLayout(current => current.sidebarCollapsed ? { ...current, sidebarCollapsed: false } : current);
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
      if (compact || navigationHidden) menuButton.current?.focus();
      else navigation.current?.querySelector("#new-chat-btn")?.focus();
    } else if (navigationHidden && navigation.current?.contains(document.activeElement)) {
      menuButton.current?.focus();
    }
    wasOpen.current = drawerOpen;
  }, [drawerOpen, compact, navigationHidden]);

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

  return <DesktopCapabilitiesProvider><div id="app"
    className={`${drawerOpen ? "navigation-open " : ""}${!compact && layout.sidebarCollapsed ? "sidebar-collapsed " : ""}${resizing ? "layout-resizing" : ""}`.trim()}
    style={{ "--sidebar-width": `${layout.sidebarWidth}px` }}>
    <div id="app-navigation" className="sidebar-shell" ref={navigation} inert={navigationHidden} aria-hidden={navigationHidden || undefined}
      role={compact ? "dialog" : "navigation"} aria-label="App navigation" aria-modal={drawerOpen || undefined}
      onKeyDown={handleNavigationKey}>
      <button ref={closeButton} type="button" className="navigation-close" onClick={closeNavigation}>Close menu</button>
      {sidebar(closeNavigation)}
    </div>
    <ResizableDivider label="Resize navigation and main workspace" className="sidebar-divider" controls="app-navigation main"
      hidden={compact || layout.sidebarCollapsed} value={layout.sidebarWidth} min={SIDEBAR_MIN} max={SIDEBAR_MAX}
      defaultValue={SIDEBAR_DEFAULT} step={10} valueText={`${Math.round(layout.sidebarWidth)} pixels`}
      onChange={sidebarWidth => setLayout(current => ({ ...current, sidebarWidth }))} onDragging={setResizing}
      pointerValue={event => event.clientX - DIVIDER_SIZE / 2} />
    {drawerOpen && <div className="navigation-backdrop" aria-hidden="true" onClick={closeNavigation} />}
    <div id="main" inert={drawerOpen}>
      <div className="workspace-navigation">
        <button className="navigation-toggle" ref={menuButton} type="button" aria-controls="app-navigation" aria-expanded={!navigationHidden}
          aria-label={navigationHidden ? "Show navigation" : "Hide navigation"} title={navigationHidden ? "Show navigation" : "Hide navigation"}
          onClick={toggleNavigation}>☰</button>
        <span>{titles[activeTab] || "Local AI Workstation"}</span>
        <ChatPinControls activeTab={activeTab} />
        <button className="workspace-refresh" type="button" onClick={onRefresh} disabled={refreshing}
          title="Reload the app and stay in this workspace" aria-label={`Refresh ${titles[activeTab] || "workspace"}`}>
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>
      <StartupNotice />
      {pinNotice && <p className="chat-pin-notice" role="status">{pinNotice}</p>}
      <NavigationOpenContext.Provider value={drawerOpen || modalOpen || resizing}><div ref={panes}
        id="app-workspace-panes" className={`workspace-panes${split ? " split-chat" : ""}${split && stacked ? " split-stacked" : ""}`}
        style={{ "--chat-share": `${ratio}fr`, "--pinned-share": `${100 - ratio}fr` }}>
        {Children.map(children, child => {
          if (!isValidElement(child) || !child.props["data-capture-tab"]) return child;
          const pinned = activeTab === "chats" && child.props["data-capture-tab"] === pinnedTab;
          // Keep each pane in the same DOM/React position, preserving drafts and native surfaces.
          return cloneElement(child, { className: `${child.props.className || ""}${pinned ? " pinned-workspace" : ""}` },
            pinned && <div className="pinned-pane-heading" key="pin-heading"><strong>{pinnedTitle}</strong>
              <button type="button" onClick={() => { onUnpin?.(); requestAnimationFrame(() => document.querySelector('[aria-label="Pin tool beside chat"]')?.focus()); }} aria-label="Close side pane">Unpin ×</button></div>,
            child.props.children && <WorkspaceBoundary key="workspace-content">{child.props.children}</WorkspaceBoundary>);
        })}
        <ResizableDivider label="Resize chat and pinned pane" className="chat-pane-divider" controls="app-workspace-panes"
          hidden={!split} orientation={stacked ? "horizontal" : "vertical"} value={ratio} min={limits.min} max={limits.max}
          defaultValue={SPLIT_DEFAULTS[axis]} valueText={`Chat ${Math.round(ratio)} percent, pinned pane ${Math.round(100 - ratio)} percent`}
          onChange={changeRatio} onDragging={setResizing}
          pointerValue={event => {
            const rect = panes.current.getBoundingClientRect();
            return ((stacked ? event.clientY - rect.top : event.clientX - rect.left) - DIVIDER_SIZE / 2) / limits.available * 100;
          }} />
      </div></NavigationOpenContext.Provider>
    </div>
  </div></DesktopCapabilitiesProvider>;
}
