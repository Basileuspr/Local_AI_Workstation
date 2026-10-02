import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { installWindowLayout, installWindowRepaint } from './windowRendering';

const removeWindowLayout = installWindowLayout(window);
const removeWindowRepaint = installWindowRepaint(window);
if (import.meta.hot) import.meta.hot.dispose(() => { removeWindowLayout(); removeWindowRepaint(); });

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
