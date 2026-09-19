import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function insertEmoji(target, emoji, start, end) {
  if (!target?.isConnected || target.disabled || target.readOnly) return false;
  const value = target.value.slice(0, start) + emoji + target.value.slice(end);
  if (target.maxLength >= 0 && value.length > target.maxLength) return false;
  const prototype = target.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(target, value);
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.focus(); target.setSelectionRange(start + emoji.length, start + emoji.length);
  return true;
}

export default function EmojiPicker() {
  const [target, setTarget] = useState(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(120);
  const [error, setError] = useState("");
  const selection = useRef({ start: 0, end: 0 });
  const dialog = useRef(null);
  useEffect(() => {
    const focus = event => {
      const node = event.target;
      if (node.closest?.(".emoji-dialog, .emoji-launch")) return;
      if ((node.tagName === "TEXTAREA" || (node.tagName === "INPUT" && ["text", ""].includes(node.type))) && !node.disabled && !node.readOnly && !node.dataset.noEmoji) setTarget(node);
    };
    document.addEventListener("focusin", focus);
    return () => document.removeEventListener("focusin", focus);
  }, []);
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    import("../emojiCatalog.json").then(module => setData(module.default)).catch(() => setError("Could not load the emoji list."));
  }, [open]);
  const visibleTarget = target?.isConnected && !target.disabled && !target.readOnly && target.getClientRects().length > 0;
  const chatSlot = target?.closest("#input-row")?.querySelector(".chat-emoji-slot");
  function launch() {
    selection.current = { start: target.selectionStart ?? target.value.length, end: target.selectionEnd ?? target.value.length };
    setError(""); setOpen(true);
  }
  const matches = data.filter(item => (!category || item.group === category) && `${item.name} ${item.keywords}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    {visibleTarget && createPortal(<button className="emoji-launch" type="button" aria-label="Open emoji picker" title="Insert emoji into the last text field" onMouseDown={event => event.preventDefault()} onClick={launch}>{chatSlot ? "😀" : "😀 Emoji"}</button>, chatSlot || target.closest("dialog") || document.body)}
    <dialog ref={dialog} className="emoji-dialog" aria-label="Emoji picker" onClose={() => setOpen(false)}>
      <header><h2>Emoji</h2><button type="button" onClick={() => setOpen(false)}>Close emoji picker</button></header>
      <input type="search" autoFocus aria-label="Search emoji" placeholder="Search faces, animals, hearts…" value={query} onChange={event => { setQuery(event.target.value); setLimit(120); }} />
      <select aria-label="Emoji category" value={category} onChange={event => { setCategory(event.target.value); setLimit(120); }}><option value="">All categories</option>{[...new Set(data.map(item => item.group))].map(group => <option key={group}>{group}</option>)}</select>
      {error && <p role="alert">{error}</p>}
      <div className="emoji-grid">{matches.slice(0, limit).map(item => <button type="button" key={item.emoji} title={item.name} aria-label={item.name} onClick={() => {
        if (!target?.isConnected || target.disabled || target.readOnly || (target.maxLength >= 0 && target.value.length - (selection.current.end - selection.current.start) + item.emoji.length > target.maxLength)) {
          setError("This field is unavailable or has reached its length limit."); return;
        }
        dialog.current.close();
        insertEmoji(target, item.emoji, selection.current.start, selection.current.end);
        setOpen(false);
      }}>{item.emoji}</button>)}</div>
      {!matches.length && <p>No matching emoji.</p>}
      {matches.length > limit && <button type="button" onClick={() => setLimit(value => value + 120)}>Show more emoji</button>}
      <small>Search includes skin-tone variants. Newer emoji depend on your system font.</small>
    </dialog>
  </>;
}
