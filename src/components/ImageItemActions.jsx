import { useState } from "react";
import { useImageDestinations } from "../ImageDestinations";
import { rotateImage } from "../mediaRotation";

export default function ImageItemActions({ image, chat = false, onChatEdit }) {
  const destinations = useImageDestinations();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function act(destination) {
    if (busy) return;
    setBusy(true); setError("");
    try { await destinations.take(image, destination); if (destination === "chat-edit") onChatEdit?.(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <div className="image-item-actions" aria-label={`Actions for ${image.name || "image"}`}>
    <button title="Rotate view left; original unchanged" onClick={() => { try { rotateImage(image.url, -1); } catch { setError("Could not save viewing rotation."); } }}>↶ Rotate</button>
    <button title="Rotate view right; original unchanged" onClick={() => { try { rotateImage(image.url); } catch { setError("Could not save viewing rotation."); } }}>Rotate ↷</button>
    {destinations && <><button disabled={busy} onClick={() => act("folder")}>Place in folder</button><button disabled={busy} onClick={() => act("new-folder")}>Start Folder with item</button>
      {chat && <button disabled={busy} onClick={() => act("chat-edit")}>Use with /Edit</button>}</>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
