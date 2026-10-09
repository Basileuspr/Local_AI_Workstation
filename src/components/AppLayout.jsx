import { Children, cloneElement, isValidElement, createContext, useEffect, useRef, useState } from "react";
import { DesktopCapabilitiesProvider, StartupNotice, WorkspaceBoundary } from "./Compatibility";
import "./AppLayout.css";
import { ChatPinControls, WorkspacePinControls } from "../ChatWorkspace";
import { useStore } from "../useStore";
import ResizableDivider from "./ResizableDivider";
import { AppearanceDialog } from "./AppearanceSettings";
import DisclosurePanel from "./DisclosurePanel";
import AppUpdateCheck from './AppUpdateCheck';
import WorkspaceInfo from "./WorkspaceInfo";
import { WorkspaceInfoContext } from "../workspaceInfoContext";
import { appTabLabels } from "../navigation";
import { ThumbnailRetryButton } from "./ImageThumbnail";
import { clampLayoutValue, DIVIDER_SIZE, loadWorkspaceLayout, saveWorkspaceLayout, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX, SPLIT_DEFAULTS, splitLimits } from "../workspaceLayout";
import "./ChatWorkspace.css";
import { WINDOW_LAYOUT_EVENT } from '../windowRendering';
import WorkstationTime from './WorkstationTime';
import SoundMixerActivity from './SoundMixerActivity';
import WorkspaceFind from './WorkspaceFind';
import { FloatingToolBoundsContext } from '../floatingToolBounds';
import { useDismissiblePopup } from '../useDismissiblePopup';
import { useWorkspaceModalOpen } from '../useWorkspaceModalOpen';

const compactLayout = "(max-width: 900px)";
export const NavigationOpenContext = createContext(false);
const titles = { ...appTabLabels, chats: "Chats", generate: "Generate Images" };

export default function AppLayout({ activeTab, sidebar, children, onRefresh, refreshing = false, pinnedTab = null, pinnedTitle, onUnpin, pinNotice }) {
  const sessionId = useStore()?.currentSessionId || "draft";
  const [layout, setLayout] = useState(loadWorkspaceLayout);
  const [compact, setCompact] = useState(() => window.matchMedia(compactLayout).matches);
  const [open, setOpen] = useState(false);
  const modalOpen = useWorkspaceModalOpen();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [loraLearningRate, setLoraLearningRate] = useState(undefined);
  const [resizing, setResizing] = useState(false);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0, appWidth: 0 });
  const [floatingToolBounds, setFloatingToolBounds] = useState(null);
  const panes = useRef(null);
  const previousSession = useRef(sessionId);
  const menuButton = useRef(null);
  const navigation = useRef(null);
  const closeButton = useRef(null);
  const wasOpen = useRef(false);
  const drawerOpen = compact && open;
  useDismissiblePopup({ open: drawerOpen, container: navigation, onDismiss: () => setOpen(false), returnFocus: menuButton });
  const navigationHidden = compact ? !open : layout.sidebarCollapsed;
  const sidebarMax = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, (paneSize.appWidth || window.innerWidth || 1280) - 330));
  const sidebarWidth = Math.min(layout.sidebarWidth, sidebarMax);
  const split = !!pinnedTab && pinnedTab !== activeTab;
  const layoutKey = activeTab === "chats" ? sessionId : `workspace:${activeTab}`;
  const stacked = paneSize.width > 0 && paneSize.width <= 820;
  const axis = stacked ? "vertical" : "horizontal";
  const secondChat = pinnedTab === "second-chat";
  const limits = splitLimits(stacked ? paneSize.height : paneSize.width, axis, secondChat);
  const ratio = clampLayoutValue(layout.splits[layoutKey]?.[axis] ?? SPLIT_DEFAULTS[axis], limits.min, limits.max);

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
      const appWidth = panes.current.closest('#app').clientWidth;
      setPaneSize(current => current.width === width && current.height === height && current.appWidth === appWidth ? current : { width, height, appWidth });
    };
    const observer = new ResizeObserver(update);
    observer.observe(panes.current); update();
    window.addEventListener(WINDOW_LAYOUT_EVENT, update);
    return () => { observer.disconnect(); window.removeEventListener(WINDOW_LAYOUT_EVENT, update); };
  }, []);

  function changeRatio(next) {
    setLayout(current => ({ ...current, splits: { ...current.splits,
      [layoutKey]: { ...current.splits[layoutKey], [axis]: next } } }));
  }
  function toggleNavigation() {
    if (compact) setOpen(current => !current);
    else setLayout(current => ({ ...current, sidebarCollapsed: !current.sidebarCollapsed }));
  }

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
    if (event.key === "Tab") {
      const controls = [...navigation.current.querySelectorAll("button, a[href], input, select, textarea, summary, [tabindex]")]
        .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  return <DesktopCapabilitiesProvider><WorkspaceInfoContext.Provider value={setLoraLearningRate}><div id="app"
    className={`${drawerOpen ? "navigation-open " : ""}${!compact && layout.sidebarCollapsed ? "sidebar-collapsed " : ""}${resizing ? "layout-resizing" : ""}`.trim()}
    style={{ "--sidebar-width": `${sidebarWidth}px` }}>
    <div id="app-navigation" className="sidebar-shell" ref={navigation} inert={navigationHidden} aria-hidden={navigationHidden || undefined}
      role={compact ? "dialog" : "navigation"} aria-label="App navigation" aria-modal={drawerOpen || undefined}
      onKeyDown={handleNavigationKey}>
      <button ref={closeButton} type="button" className="navigation-close" onClick={closeNavigation}>Close menu</button>
      {sidebar(closeNavigation)}
    </div>
    <ResizableDivider label="Resize navigation and main workspace" className="sidebar-divider" controls="app-navigation main"
      hidden={compact || layout.sidebarCollapsed} value={sidebarWidth} min={SIDEBAR_MIN} max={sidebarMax}
      defaultValue={SIDEBAR_DEFAULT} step={10} valueText={`${Math.round(sidebarWidth)} pixels`}
      onChange={sidebarWidth => setLayout(current => ({ ...current, sidebarWidth }))} onDragging={setResizing}
      pointerValue={event => event.clientX - DIVIDER_SIZE / 2} />
    {drawerOpen && <div className="navigation-backdrop" aria-hidden="true" onClick={closeNavigation} />}
    <div id="main" inert={drawerOpen}>
      <div className="workspace-navigation">
        <button className="navigation-toggle" ref={menuButton} type="button" aria-controls="app-navigation" aria-expanded={!navigationHidden}
          aria-label={navigationHidden ? "Show navigation" : "Hide navigation"} title={navigationHidden ? "Show navigation" : "Hide navigation"}
          onClick={toggleNavigation}>☰</button>
        <span>{titles[activeTab] || "Local AI Workstation"}</span>
        <WorkstationTime onOverlayChange={setFloatingToolBounds} inert={drawerOpen} />
        <WorkspacePinControls activeTab={activeTab} />
        <SoundMixerActivity activeTab={activeTab}/>
        <WorkspaceFind activeTab={activeTab} pinnedTab={pinnedTab} onOpen={closeNavigation}/>
        <DisclosurePanel label="Workspace options" className="workspace-options" title="Side pane, appearance, and refresh">
          {close => <>
            <ChatPinControls activeTab={activeTab} />
            <button className="workspace-appearance" type="button" onClick={() => { close(); setAppearanceOpen(true); }} aria-haspopup="dialog" title="Change application fonts and colors">Appearance</button>
            <ThumbnailRetryButton />
            {globalThis.window?.workstationDesktop?.repaintWindow && <button className="workspace-redraw" type="button" title="Redraw the window without reloading or losing drafts" onClick={() => { close(); window.workstationDesktop.repaintWindow(); }}>Redraw window</button>}
            <button className="workspace-refresh" type="button" onClick={onRefresh} disabled={refreshing}
              title="Reload the app and stay in this workspace" aria-label={`Refresh ${titles[activeTab] || "workspace"}`}>
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
          </>}
        </DisclosurePanel>
        <WorkspaceInfo tab={activeTab} learningRate={loraLearningRate} />
        <AppUpdateCheck />
      </div>
      <div id="workspace-find-slot" />
      <StartupNotice />
      {pinNotice && <p className="chat-pin-notice" role="status">{pinNotice}</p>}
      <FloatingToolBoundsContext.Provider value={floatingToolBounds}><NavigationOpenContext.Provider value={drawerOpen || modalOpen || resizing}><div ref={panes}
        id="app-workspace-panes" className={`workspace-panes${split ? " split-chat" : ""}${split && stacked ? " split-stacked" : ""}`}
        style={{ "--chat-share": `${ratio}fr`, "--pinned-share": `${100 - ratio}fr`,
          "--chat-min-height": secondChat ? "320px" : "280px", "--pinned-min-height": secondChat ? "400px" : "200px" }}>
        {Children.map(children, child => {
          if (!isValidElement(child) || !child.props["data-capture-tab"]) return child;
          const pinned = split && child.props["data-capture-tab"] === pinnedTab;
          const primary = split && child.props["data-capture-tab"] === activeTab;
          // Keep each pane in the same DOM/React position, preserving drafts and native surfaces.
          return cloneElement(child, { className: `${child.props.className || ""}${primary ? " primary-workspace" : ""}${pinned ? " pinned-workspace" : ""}` },
            pinned && <div className="pinned-pane-heading" key="pin-heading"><strong>{pinnedTitle}</strong>
              <WorkspaceInfo tab={pinnedTab === "second-chat" ? "chats" : pinnedTab} learningRate={loraLearningRate} />
              <button type="button" onClick={() => { onUnpin?.(); requestAnimationFrame(() => document.querySelector('[aria-label="Workspace options"]')?.focus()); }} aria-label="Close side pane">{pinnedTab === "second-chat" ? "Close ×" : "Unpin ×"}</button></div>,
            child.props.children && <WorkspaceBoundary key="workspace-content">{child.props.children}</WorkspaceBoundary>);
        })}
        <ResizableDivider label={secondChat ? "Resize Chat A and Chat B" : activeTab === "chats" ? "Resize chat and pinned pane" : `Resize ${titles[activeTab]} and ${pinnedTitle || "side pane"}`} className="chat-pane-divider" controls="app-workspace-panes"
          hidden={!split} orientation={stacked ? "horizontal" : "vertical"} value={ratio} min={limits.min} max={limits.max}
          defaultValue={SPLIT_DEFAULTS[axis]} valueText={secondChat ? `Chat A ${Math.round(ratio)} percent, Chat B ${Math.round(100 - ratio)} percent` : `${titles[activeTab]} ${Math.round(ratio)} percent, side pane ${Math.round(100 - ratio)} percent`}
          onChange={changeRatio} onDragging={setResizing}
          pointerValue={event => {
            const rect = panes.current.getBoundingClientRect();
            return ((stacked ? event.clientY - rect.top : event.clientX - rect.left) - DIVIDER_SIZE / 2) / limits.available * 100;
          }} />
      </div></NavigationOpenContext.Provider></FloatingToolBoundsContext.Provider>
    </div>
    {appearanceOpen && <AppearanceDialog onClose={() => setAppearanceOpen(false)} />}
  </div></WorkspaceInfoContext.Provider></DesktopCapabilitiesProvider>;
}
