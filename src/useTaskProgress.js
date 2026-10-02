import { useEffect, useState } from "react";
import { apiUrl } from "./api";
import { taskElapsedSeconds, taskProgressCache } from "./taskProgress";
import { sharedPollingObserver, readPollingJson } from "./polling";

export default function useTaskProgress(taskKey, path, pollInterval = 750, enabled = true) {
  const [view, setView] = useState(() => ({ taskKey, snapshot: taskProgressCache.read(taskKey), now: performance.now() }));

  useEffect(() => {
    if (!enabled) return;

    function refresh() {
      setView({ taskKey, snapshot: taskProgressCache.read(taskKey), now: performance.now() });
    }

    const observer = sharedPollingObserver(`progress:${path}`, {
      read: options => readPollingJson(apiUrl(path), options), active: data => Boolean(data?.progress),
      interval: (_, { failures }) => failures ? Math.min(30000, 2000 * 2 ** Math.min(4, failures - 1)) : pollInterval,
    });
    refresh();
    const detach = observer.subscribe({ data: data => {
      taskProgressCache.record(taskKey, data.progress, taskProgressCache.beginPoll()); refresh();
    }, error: () => { taskProgressCache.markUnavailable(taskKey, taskProgressCache.beginPoll()); refresh(); } });
    const clock = setInterval(refresh, 250);
    return () => {
      detach();
      clearInterval(clock);
    };
  }, [taskKey, path, pollInterval, enabled]);

  // A changed task must never render the previous task's state, even before
  // its effect has run (for example, switching between analysis projects).
  const snapshot = enabled ? view.taskKey === taskKey ? view.snapshot : taskProgressCache.read(taskKey) : null;
  return {
    progress: snapshot?.progress || null,
    elapsed: taskElapsedSeconds(snapshot, view.taskKey === taskKey ? view.now : performance.now()),
    unavailable: snapshot?.unavailable || false,
  };
}
