import { useEffect, useState } from "react";
import { apiUrl } from "./api";
import { taskElapsedSeconds, taskProgressCache } from "./taskProgress";

export default function useTaskProgress(taskKey, path, pollInterval = 750) {
  const [view, setView] = useState(() => ({ taskKey, snapshot: taskProgressCache.read(taskKey), now: performance.now() }));

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let pollTimer;

    function refresh() {
      setView({ taskKey, snapshot: taskProgressCache.read(taskKey), now: performance.now() });
    }

    async function poll() {
      const pollId = taskProgressCache.beginPoll();
      try {
        const response = await fetch(apiUrl(path), { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Progress unavailable");
        const data = await response.json();
        if (!disposed) {
          taskProgressCache.record(taskKey, data.progress, pollId);
          refresh();
        }
      } catch {
        if (!disposed) {
          taskProgressCache.markUnavailable(taskKey, pollId);
          refresh();
        }
      } finally {
        if (!disposed) pollTimer = setTimeout(poll, pollInterval);
      }
    }

    refresh();
    poll();
    const clock = setInterval(refresh, 250);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(clock);
      clearTimeout(pollTimer);
    };
  }, [taskKey, path, pollInterval]);

  // A changed task must never render the previous task's state, even before
  // its effect has run (for example, switching between analysis projects).
  const snapshot = view.taskKey === taskKey ? view.snapshot : taskProgressCache.read(taskKey);
  return {
    progress: snapshot?.progress || null,
    elapsed: taskElapsedSeconds(snapshot, view.taskKey === taskKey ? view.now : performance.now()),
    unavailable: snapshot?.unavailable || false,
  };
}
