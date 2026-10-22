import React from "react";
import { createRoot } from "react-dom/client";
import Companion from "./Companion";
import "./style.css";
import { consumePairingLink } from './pairing';

const pairingCode = consumePairingLink();
createRoot(document.getElementById("root")).render(<Companion pairingCode={pairingCode} />);
// The one-time cache bypass is no longer needed after the new shell loads.
// Restore the normal URL so subsequent offline navigation can use its shell.
if (/^[a-f0-9]{24}$/.test(new URLSearchParams(location.search).get('client-update') || '')) {
  history.replaceState(null, '', '/');
}
if ("serviceWorker" in navigator && window.isSecureContext && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js", {updateViaCache: 'none'}).catch(() => {});
}
