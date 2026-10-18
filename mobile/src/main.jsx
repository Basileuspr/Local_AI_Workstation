import React from "react";
import { createRoot } from "react-dom/client";
import Companion from "./Companion";
import "./style.css";

createRoot(document.getElementById("root")).render(<Companion />);
if ("serviceWorker" in navigator && window.isSecureContext && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
