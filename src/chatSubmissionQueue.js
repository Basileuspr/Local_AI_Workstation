// Follow-up prompts wait for earlier replies so their context includes those
// replies. Once ready, each request joins the backend's shared model queue.
export class ChatSubmissionQueue {
  jobs = [];
  listeners = new Set();
  snapshot = [];
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;
  publish() {
    this.snapshot = this.jobs.map(({ run, onError, controller, ...job }) => job);
    this.listeners.forEach(listener => listener());
  }
  enqueue({ id, label, session_id = null, session_title = "New Chat", model = "", pane_id = "primary", pane_label = "Chat A", run, onError = console.error }) {
    this.jobs.push({ id, label, session_id, session_title, model, pane_id, pane_label, run, onError, controller: new AbortController(), status: "waiting", stage: "queued", created_at: new Date().toISOString() });
    this.publish();
    void this.advance();
  }
  cancel(id) {
    this.jobs = this.jobs.filter(job => job.id !== id || job.status === "running");
    this.publish();
  }
  setSession(id, sessionId) {
    const job = this.jobs.find(item => item.id === id);
    if (job) { job.session_id = sessionId; this.publish(); }
  }
  update(id, changes) {
    const job = this.jobs.find(item => item.id === id);
    if (job) {
      for (const key of ["stage", "stage_detail", "request_id", "session_title"]) if (key in changes) job[key] = changes[key];
      this.publish();
    }
  }
  clearWaiting() {
    this.jobs = this.jobs.filter(job => job.status === "running");
    this.publish();
  }
  cancelAll() {
    for (const job of this.jobs) job.controller.abort();
    this.clearWaiting();
  }
  async advance() {
    if (this.jobs.some(job => job.status === "running")) return;
    const next = this.jobs[0];
    if (!next) return;
    next.status = "running";
    next.stage = "preparing";
    this.publish();
    try { await next.run(next.controller.signal); }
    catch (error) { next.onError(error); }
    finally {
      this.jobs = this.jobs.filter(job => job.id !== next.id);
      this.publish();
      void this.advance();
    }
  }
}
export const chatSubmissionQueue = new ChatSubmissionQueue();
