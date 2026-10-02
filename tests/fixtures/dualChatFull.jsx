import React from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import "../../src/styles.css";
localStorage.setItem("local-ai-workstation-preferences-v1", JSON.stringify({ selectedModel: "alpha:latest", roleplay: { useDurableMemory: false } }));
createRoot(document.getElementById("root")).render(<App />);
