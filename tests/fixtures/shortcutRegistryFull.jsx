import React from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import "../../src/styles.css";

// Exercise the real app shell and routing without contacting live app services.
window.fetch = async () => new Response(JSON.stringify({ detail: "Backend unavailable in isolated registry checks." }), { status: 503, headers: { "Content-Type": "application/json" } });
createRoot(document.getElementById("root")).render(<App />);
