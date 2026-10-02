import React from "react";
import { createRoot } from "react-dom/client";
import App from "../../src/App";
import { NAVIGATION_STORAGE_KEY } from "../../src/navigation";
import { PREFERENCES_STORAGE_KEY } from "../../src/preferences";
import "../../src/styles.css";

// The real app and StrictMode, with isolated fake services. Never contact live data.
localStorage.setItem(NAVIGATION_STORAGE_KEY, JSON.stringify({ tab: "shortcuts", sessionId: "previous-chat" }));
const testParams = new URLSearchParams(location.search);
if (testParams.has('startup')) localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ startupBehavior:testParams.get('startup') === 'resume' ? 'resume' : 'new' }));
const sessionsKey = "chat-startup-fixture-sessions" + (testParams.has('noHistory') ? '-empty' : '');
const previous = { id: "previous-chat", title: "Previous conversation", revision: 1, model: "fixture-chat", messages: [{ id: "old-user", role: "user", content: "Previously saved prompt" }, { id: "old-reply", role: "assistant", content: "Previously saved reply" }] };
const sessions = JSON.parse(sessionStorage.getItem(sessionsKey) || "null") || (testParams.has('noHistory') ? [] : [previous]);
let creations = 0, loads = 0, requests = 0;
let webJob = null;
function report() { document.getElementById("startup-checks").textContent = `Isolated test services · Sessions created: ${creations} · Conversation loads: ${loads} · Model requests: ${requests}`; }
function persist() { sessionStorage.setItem(sessionsKey, JSON.stringify(sessions)); report(); }
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const models = [{ name: "fixture-chat", capabilities: ["completion"], context_length: 8192 }];
window.fetch = async (url, options = {}) => {
  const path = new URL(url, location.href).pathname;
  if (path === "/models") return json({ models });
  if (path === "/status") return json({ backend: { ok: true }, ollama: { reachable: true }, models: { installed: models, chat_count: 1, embedding_ready: true }, knowledge_base: { ok: true, documents: 0 } });
  if (path === "/sessions/list") return json({ sessions });
  if (path === "/web/active") return json({ job: webJob?.status === "fetching" ? webJob : null });
  if (path === "/web/jobs" && options.method === "POST") {
    webJob = { id: "fixture-import", status: "fetching", message: "Fetching fixture page" };
    return json(webJob);
  }
  if (path === "/web/jobs/fixture-import/stop") { webJob = { ...webJob, status: "cancelled", message: "Fixture import cancelled" }; return json(webJob); }
  if (path === "/web/jobs/fixture-import") return json(webJob);
  if (path === "/thinking/trace") return json({ content: "Isolated fixture thinking output.", offset: 0, next_offset: 33, revision: "fixture", more: false });
  const metadata = path.match(/^\/sessions\/([^/]+)\/metadata$/);
  if (metadata) {
    const session = sessions.find(item => item.id === metadata[1]);
    if (!session) return new Response("{}", { status: 404 });
    const data = JSON.parse(options.body);
    if (typeof data.title === "string") session.title = data.title;
    session.revision++; persist(); return json(session);
  }
  if (path === "/sessions/new") {
    creations++;
    const session = { id: `fixture-${sessions.length}`, title: "New Chat", revision: 0, messages: [], model: "fixture-chat" };
    sessions.unshift(session); persist(); return json(session);
  }
  const match = path.match(/^\/sessions\/([^/]+)(\/messages\/append)?$/);
  if (match) {
    const session = sessions.find(item => item.id === match[1]);
    if (!session) return new Response("{}", { status: 404 });
    if (match[2]) {
      const data = JSON.parse(options.body);
      session.messages.push(...data.messages); session.revision++;
      session.title = session.messages.find(message => message.role === "user")?.content || "New Chat";
      persist();
    } else { loads++; report(); }
    return json(session);
  }
  if (path === "/chat") {
    requests++; report();
    return new Response('data: {"token":"Fixture reply completed."}\n\ndata: {"done":true}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  }
  return json({ jobs: [], paused: false, tasks: [], requests: [], items: [], images: [], documents: [], models: [], loras: [], projects: [], folders: [], collections: [] });
};
report();
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
