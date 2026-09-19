import { useEffect, useRef, useState } from "react";

export default function CharacterNameDialog({ title, initialName = "", description, onSave, onClose }) {
  const dialog = useRef(null);
  const submitting = useRef(false);
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const node = dialog.current;
    node.showModal();
    return () => node.close();
  }, []);

  async function save(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (submitting.current || !trimmed) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(trimmed);
      onClose();
    } catch (failure) {
      setError(failure.message || "Could not save the character. Please try again.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="collection-dialog" aria-label={title} onCancel={event => {
    event.preventDefault();
    if (!submitting.current) onClose();
  }}>
    <form onSubmit={save}>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      <label>Character name<input autoFocus required maxLength={120} value={name} disabled={saving} onChange={event => setName(event.target.value)} /></label>
      {error && <p className="face-alert" role="alert">{error}</p>}
      <footer>
        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save character"}</button>
      </footer>
    </form>
  </dialog>;
}
