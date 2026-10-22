import { useEffect, useState } from 'react';
import { ApiError, request } from './api';

// One request at a time. A response belongs to one visible, connected lifetime;
// an old request cannot restore private content after sleep, logout or a switch.
export default function useFreshResource(path, { enabled = true, interval = 2000, refreshKey = 0, delay = 0, timeout = 8000 } = {}) {
  const [snapshot, setSnapshot] = useState({ path, value: null, error: null, loading: false });
  useEffect(() => {
    let alive = true, timer, controller, generation = 0, failures = 0, suspended = false;
    const available = () => enabled && !suspended && document.visibilityState !== 'hidden' && navigator.onLine !== false;
    function clear(error = null) {
      generation++; controller?.abort(); clearTimeout(timer);
      if (alive) setSnapshot({ path, value: null, error, loading: false });
    }
    async function sync() {
      if (!available()) { clear(); return; }
      const current = ++generation;
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal;
      setSnapshot(previous => ({ ...previous, path, loading: true }));
      try {
        const value = await request(path, { signal, timeout });
        if (!alive || signal.aborted || current !== generation) return;
        failures = 0; setSnapshot({ path, value, error: null, loading: false });
      } catch (error) {
        if (!alive || signal.aborted || current !== generation) return;
        failures++; setSnapshot({ path, value: null, error, loading: false });
      } finally {
        if (alive && current === generation && available()) timer = setTimeout(sync, Math.min(30000, interval * 2 ** Math.min(failures, 4)));
      }
    }
    function resume() { suspended = false; clear(); if (available()) sync(); }
    function background() { suspended = true; clear(); }
    function lost() { clear(new ApiError('Pair this device with your desktop', 401)); }
    clear(); if (available()) {
      setSnapshot({ path, value: null, error: null, loading: true });
      if (delay) timer = setTimeout(sync, delay); else sync();
    }
    window.addEventListener('online', resume); window.addEventListener('offline', resume);
    window.addEventListener('pageshow', resume); window.addEventListener('law-auth-lost', lost);
    window.addEventListener('law-background', background);
    document.addEventListener('visibilitychange', resume);
    return () => {
      alive = false; clear();
      window.removeEventListener('online', resume); window.removeEventListener('offline', resume);
      window.removeEventListener('pageshow', resume); window.removeEventListener('law-auth-lost', lost);
      window.removeEventListener('law-background', background);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [path, enabled, interval, refreshKey, delay, timeout]);
  return enabled && snapshot.path === path ? snapshot : { value: null, error: null, loading: false };
}
