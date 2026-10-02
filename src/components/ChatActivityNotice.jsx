import { useState, useSyncExternalStore } from "react";
import { chatSubmissionQueue } from "../chatSubmissionQueue";
import { chatActivities } from "../chatActivity";
import { useChatWorkspace } from "../ChatWorkspace";
import { useStore } from "../useStore";
import { usePromptQueue } from "./PromptQueue";
import "./DualChat.css";

export function useChatActivities() {
  const submissions = useSyncExternalStore(chatSubmissionQueue.subscribe, chatSubmissionQueue.getSnapshot, chatSubmissionQueue.getSnapshot);
  const { jobs } = usePromptQueue();
  return chatActivities(submissions, jobs);
}

export default function ChatActivityNotice() {
  const workspace = useChatWorkspace(), { activeSidebarTab } = useStore();
  const activities = useChatActivities();
  const [dismissed, setDismissed] = useState([]);
  const hidden = activities.length && activities.every(job => dismissed.includes(job.id));
  if (activeSidebarTab !== "chats" || workspace?.pin?.kind !== "chat" || !activities.length) return null;
  if (hidden) return <button className="chat-activity-reopen" type="button" onClick={() => setDismissed([])}
    aria-label="Show request status">Requests · {activities.length}</button>;
  return <aside className="chat-activity-notice" aria-label="Live chat request status">
    <header><strong>Chat requests · {activities.length}</strong>
      <button type="button" aria-label="Dismiss request status" title="Hide this notice; requests continue"
        onClick={() => setDismissed(activities.map(job => job.id))}>×</button></header>
    <div className="chat-activity-list" role="status" aria-live="polite" aria-atomic="true">
      {activities.map(job => <div key={job.id} className="chat-activity-row">
        <strong>{job.pane_label} · {job.statusLabel}</strong>
        <span>{job.session_title} · {job.model}</span><small>{job.detail}</small>
      </div>)}
    </div>
  </aside>;
}
