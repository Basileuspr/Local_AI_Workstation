import { useEffect, useState } from "react";
import "./SidebarNavigation.css";

const groups = [
  { id: "workspace", label: "Workspace", icon: "chat", items: [
    { id: "chats", label: "Chats" },
    { id: "library", label: "Prompt Index" },
    { id: "knowledge", label: "Knowledge" },
    { id: "canvas", label: "Canvas" },
    { id: "converter", label: "File Converter" },
  ] },
  { id: "images", label: "Images", icon: "image", items: [
    { id: "images", label: "Gallery", title: "Image Gallery" },
    { id: "generate", label: "Generate", title: "Generate Images" },
    { id: "review", label: "Review", title: "Image Review" },
    { id: "image-editor", label: "Editor", title: "Image Editor" },
    { id: "workflows", label: "Workflows", title: "Image Workflows" },
    { id: "media-manager", label: "Media Manager" },
  ] },
  { id: "characters", label: "Characters & Training", icon: "person", items: [
    { id: "faces", label: "Faces" },
    { id: "character-parts", label: "Character Parts" },
    { id: "lora", label: "LoRA" },
  ] },
  { id: "viewers", label: "Viewers", icon: "chat", items: [
    { id: "markdown", label: "Markdown Viewer" },
    { id: "html-viewer", label: "HTML Viewer" },
    { id: "css-viewer", label: "CSS / Styling" },
    { id: "spreadsheets", label: "Spreadsheets" },
  ] },
];

function NavIcon({ kind }) {
  return <svg className="sidebar-nav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "chat" && <path d="M20 4H4v13h5l3 3 3-3h5V4ZM8 9h8M8 13h5" />}
    {kind === "image" && <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>}
    {kind === "person" && <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>}
  </svg>;
}

export default function SidebarNavigation({ activeTab, onSelect }) {
  const selectedGroup = groups.find(group => group.items.some(item => item.id === activeTab))?.id || null;
  const [openGroup, setOpenGroup] = useState(selectedGroup);
  // Navigation from New Chat, image destinations, or the Dashboard notice must
  // reveal the selected tool just like a click in this menu does.
  useEffect(() => { setOpenGroup(selectedGroup); }, [activeTab, selectedGroup]);

  function itemButton(item) {
    return <button key={item.id} type="button" className="sidebar-nav-item"
      data-sidebar-route={item.id} data-media-manager-tab={item.id === "media-manager" ? "" : undefined}
      aria-current={activeTab === item.id ? "page" : undefined} title={item.title}
      onClick={() => onSelect(item.id)}>{item.label}</button>;
  }

  return <nav className="sidebar-navigation" aria-label="Workstation tools">
    <div className="sidebar-utilities">
      {itemButton({ id: "dashboard", label: "Dashboard" })}
      {itemButton({ id: "queue", label: "Prompt Queue" })}
    </div>
    <div className="sidebar-nav-groups">
      {groups.map(group => {
        const open = openGroup === group.id;
        const selected = group.items.find(item => item.id === activeTab);
        return <div className={`sidebar-nav-group${selected ? " contains-current" : ""}`} key={group.id}>
          <button type="button" className="sidebar-group-toggle" aria-expanded={open} aria-controls={`sidebar-group-${group.id}`}
            onClick={() => setOpenGroup(open ? null : group.id)}>
            <NavIcon kind={group.icon} />
            <span className="sidebar-group-label">{group.label}{selected && !open && <span className="sidebar-group-current">{selected.label}</span>}</span>
            <svg className="sidebar-group-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>
          </button>
          <div id={`sidebar-group-${group.id}`} className="sidebar-group-items" hidden={!open}>
            {group.items.map(itemButton)}
          </div>
        </div>;
      })}
    </div>
    <div className="sidebar-functions">
      {itemButton({ id: "tools", label: "Functions" })}
    </div>
  </nav>;
}
