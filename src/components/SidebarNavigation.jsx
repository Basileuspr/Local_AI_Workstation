import { useEffect, useRef, useState } from "react";
import "./SidebarNavigation.css";
import { filterNavigationSections, loadNavigationOrder, orderedSections, NAVIGATION_ORDER_KEY } from "../navigationOrder";
import TabOrderEditor from "./TabOrderEditor";
import ResizableDivider from "./ResizableDivider";
import { loadSidebarMenuSizes, saveSidebarMenuSizes, SIDEBAR_MENU_SIZE_KEY, SIDEBAR_MENU_DEFAULT, SIDEBAR_MENU_MIN, SIDEBAR_MENU_MAX } from "../sidebarNavigationSizing";

function NavIcon({ kind }) {
  return <svg className="sidebar-nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "chat" && <path d="M20 4H4v13h5l3 3 3-3h5V4ZM8 9h8M8 13h5" />}
    {kind === "image" && <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>}
    {kind === "person" && <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>}
  </svg>;
}

export default function SidebarNavigation({ activeTab, onSelect }) {
  const [order, setOrder] = useState(loadNavigationOrder);
  const [arranging, setArranging] = useState(false);
  const [query, setQuery] = useState("");
  const [menuSizes, setMenuSizes] = useState(loadSidebarMenuSizes);
  const [resizing, setResizing] = useState(false);
  const [menuLimit, setMenuLimit] = useState(SIDEBAR_MENU_MAX);
  const [navigationLimit, setNavigationLimit] = useState(640);
  const navigation = useRef(null);
  const searchInput = useRef(null);
  const arrangeButton = useRef(null);
  const lists = useRef({});
  const sections = orderedSections(order);
  const groups = sections.filter(section => section.icon);
  const searching = !!query.trim();
  const visibleSections = searching ? filterNavigationSections(sections, query) : sections;
  const resultCount = visibleSections.reduce((count, section) => count + section.items.length, 0);
  useEffect(() => {
    const refresh = event => { if (!event.key || event.key === NAVIGATION_ORDER_KEY) setOrder(loadNavigationOrder()); };
    window.addEventListener("storage", refresh); window.addEventListener("navigation-order-changed", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("navigation-order-changed", refresh); };
  }, []);
  const selectedGroup = groups.find(group => group.items.some(item => item.id === activeTab))?.id || null;
  const [openGroup, setOpenGroup] = useState(selectedGroup);
  useEffect(() => {
    const nav = navigation.current, parent = nav?.parentElement;
    if (!nav || !parent) return;
    const measure = () => {
      const otherHeight = [...parent.children].filter(node => node !== nav && node.id !== "sidebar-content")
        .reduce((height, node) => height + node.getBoundingClientRect().height, 0);
      // Leave the conversation collection usable even when navigation itself
      // needs to scroll in a short window.
      const reserve = parent.querySelector('#sidebar-content') ? Math.min(120, parent.clientHeight * .2) : 0;
      const budget = Math.max(120, Math.floor(Math.min(640, window.innerHeight * .6,
        parent.id === "sidebar" ? parent.clientHeight - otherHeight - reserve : Infinity)));
      setNavigationLimit(current => current === budget ? current : budget);
      const list = lists.current[openGroup];
      if (!list) { setMenuLimit(SIDEBAR_MENU_MAX); return; }
      const fixedHeight = nav.scrollHeight - list.clientHeight;
      const limit = Math.max(32, Math.min(SIDEBAR_MENU_MAX, Math.floor(budget - fixedHeight)));
      setMenuLimit(current => current === limit ? current : limit);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav); observer.observe(parent);
    [...parent.children].filter(node => node !== nav && node.id !== "sidebar-content").forEach(node => observer.observe(node));
    measure();
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [openGroup, searching]);
  useEffect(() => saveSidebarMenuSizes(menuSizes), [menuSizes]);
  useEffect(() => {
    const refresh = event => { if (!event.key || event.key === SIDEBAR_MENU_SIZE_KEY) setMenuSizes(loadSidebarMenuSizes()); };
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  // Navigation from New Chat, image destinations, or the Dashboard notice must
  // reveal the selected tool just like a click in this menu does.
  useEffect(() => { setOpenGroup(selectedGroup); setQuery(""); }, [activeTab, selectedGroup]);
  useEffect(() => {
    const list = lists.current[openGroup], current = list?.querySelector('[aria-current="page"]');
    if (!current) return;
    // Reveal only inside this menu; do not move the chat or the outer sidebar.
    const item = current.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }, [activeTab, openGroup, searching, menuLimit]);

  function selectItem(id) {
    const focusResult = searching && navigation.current?.querySelector('.sidebar-nav-sections')?.contains(document.activeElement);
    setQuery("");
    setOpenGroup(groups.find(group => group.items.some(item => item.id === id))?.id || null);
    onSelect(id);
    if (focusResult) requestAnimationFrame(() => {
      if (!navigation.current?.closest('[inert]')) navigation.current?.querySelector(`[data-sidebar-route="${id}"]`)?.focus();
    });
  }
  function closeArrangement() {
    setArranging(false);
    requestAnimationFrame(() => arrangeButton.current?.focus());
  }

  function itemButton(item) {
    return <button key={item.id} type="button" className="sidebar-nav-item"
      data-sidebar-route={item.id} data-media-manager-tab={item.id === "media-manager" ? "" : undefined}
      aria-current={activeTab === item.id ? "page" : undefined} title={item.title || item.label}
      onClick={() => selectItem(item.id)}>{item.label}</button>;
  }

  return <nav ref={navigation} className={`sidebar-navigation${resizing ? " sidebar-menu-resizing" : ""}`} aria-label="Workstation tools" style={{ maxHeight: `${navigationLimit}px` }}
    onKeyDown={event => {
      if (event.key === "Escape" && query && !arranging) { event.preventDefault(); event.stopPropagation(); setQuery(""); searchInput.current?.focus(); }
    }}>
    <div className="sidebar-nav-toolbar"><div className="sidebar-tab-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></svg>
      <input ref={searchInput} type="text" aria-label="Find a tab" placeholder="Find a tab…" value={query} autoComplete="off" spellCheck={false}
        aria-controls="sidebar-tab-sections" onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (searching && event.key === "Enter" && resultCount) { event.preventDefault(); selectItem(visibleSections[0].items[0].id); }
          else if (searching && event.key === "ArrowDown" && resultCount) { event.preventDefault(); navigation.current.querySelector('.sidebar-nav-sections .sidebar-nav-item')?.focus(); }
        }} />
      {query && <button type="button" aria-label="Clear tab search" onClick={() => { setQuery(""); searchInput.current?.focus(); }}>×</button>}
    </div><button ref={arrangeButton} className="sidebar-arrange-tabs" type="button" aria-label="Arrange tabs" title="Arrange tabs" onClick={() => setArranging(true)}>Arrange</button></div>
    <span className="sidebar-search-status" role="status">{searching ? `${resultCount} ${resultCount === 1 ? "tab" : "tabs"} found` : ""}</span>
    {searching && !resultCount && <p className="sidebar-no-tabs">No tabs found. Try another name.</p>}
    <div id="sidebar-tab-sections" className={`sidebar-nav-sections${searching ? " is-searching" : ""}`}>{visibleSections.map(group => {
      if (searching) return <div className="sidebar-search-group" key={group.id}>
        <div className="sidebar-search-heading">{group.label}</div>{group.items.map(itemButton)}
      </div>;
      if (!group.icon) return <div key={group.id} className={group.id === 'utilities' ? 'sidebar-utilities' : 'sidebar-functions'}>{group.items.map(itemButton)}</div>;
      const open = openGroup === group.id;
      const height = open ? Math.min(menuSizes[group.id], menuLimit) : menuSizes[group.id];
      const selected = group.items.find(item => item.id === activeTab);
      return <div className={`sidebar-nav-group${open ? " is-open" : ""}${selected ? " contains-current" : ""}`} key={group.id}>
        <button type="button" className="sidebar-group-toggle" aria-expanded={open} aria-controls={`sidebar-group-${group.id}`} title={selected && !open ? `${group.label}: ${selected.label}` : group.label}
          onClick={() => setOpenGroup(open ? null : group.id)}>
          <NavIcon kind={group.icon} />
          <span className="sidebar-group-label">{group.label}</span>
          <svg className="sidebar-group-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
        </button>
        <div id={`sidebar-group-${group.id}`} className="sidebar-group-items" hidden={!open}>
          <div id={`sidebar-group-list-${group.id}`} className="sidebar-group-list" ref={node => { lists.current[group.id] = node; }}
            style={{ maxHeight: `${height}px` }}>{group.items.map(itemButton)}</div>
          <ResizableDivider label={`Resize ${group.label} menu`} orientation="horizontal" className="sidebar-group-divider"
            hidden={!open} controls={`sidebar-group-list-${group.id}`} value={height} min={Math.min(SIDEBAR_MENU_MIN, menuLimit)} max={menuLimit}
            defaultValue={SIDEBAR_MENU_DEFAULT} step={8} valueText={`${height} pixels`}
            onChange={height => setMenuSizes(current => ({ ...current, [group.id]: Math.max(SIDEBAR_MENU_MIN, Math.round(height)) }))} onDragging={setResizing}
            pointerValue={event => event.clientY - lists.current[group.id].getBoundingClientRect().top - 8} />
        </div>
      </div>;
    })}</div>
    {arranging && <TabOrderEditor value={order} onClose={closeArrangement} onSave={value => { setOrder(value); closeArrangement(); }} />}

  </nav>;
}
