import { useRef, useState } from "react";
import { NODE_ICONS, nodeOptions } from "../knowledgeNodeOptions";

export default function KnowledgeNodeSymbol({ node, onSave, disabled }) {
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [message, setMessage] = useState(""), lock = useRef(false);
  const icon = nodeOptions(node).icon;
  async function change(event) {
    const next = event.target.value;
    if (lock.current || disabled || next === icon) return;
    lock.current = true; setSaving(true); setError(""); setMessage("");
    try { await onSave(next); setMessage("Symbol saved."); }
    catch (failure) { setError(failure.message); }
    finally { lock.current = false; setSaving(false); }
  }
  return <div className="vault-node-symbol">
    <span className="vault-symbol-preview" aria-hidden="true">{NODE_ICONS[icon] || "○"}</span>
    <label>Node symbol<select value={icon} disabled={saving || disabled} onChange={change}>{Object.entries(NODE_ICONS).map(([name, symbol]) => <option key={name} value={name}>{symbol} {name === "none" ? "No symbol" : name[0].toUpperCase() + name.slice(1)}</option>)}</select></label>
    <small role="status">{saving ? "Saving symbol…" : message || "Saves automatically"}</small>
    {error && <p role="alert">{error}</p>}
  </div>;
}
