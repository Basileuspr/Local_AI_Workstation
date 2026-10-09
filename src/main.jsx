import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./components/WorkspaceControls.css";
import { installWindowLayout, installWindowRepaint } from './windowRendering';

const removeWindowLayout = installWindowLayout(window);
const removeWindowRepaint = installWindowRepaint(window);
if (import.meta.hot) import.meta.hot.dispose(() => { removeWindowLayout(); removeWindowRepaint(); });

// The Browser-only preload marks this host. It never mounts the main app or
// starts its API polling, generation controls or backend connection.
const Root = React.lazy(() => window.workstationDesktop?.browserWindow
  ? import('./components/BrowserWindow') : import('./App'));

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <React.Suspense fallback={<p>Opening workspace…</p>}><Root /></React.Suspense>
  </React.StrictMode>
);
